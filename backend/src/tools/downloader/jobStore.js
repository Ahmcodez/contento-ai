const redis = require('../../redis/client');

/**
 * Public-downloader jobs live in Redis, not Postgres: they belong to no account, are useless
 * after half an hour, and should vanish on their own. A job id is a 128-bit random value and is
 * the only credential for reading its status and fetching its file, so it must never be logged
 * next to anything that would let a third party guess or collect it.
 */

const JOB_PREFIX = 'tool:dl:';
const ACTIVE_PREFIX = 'tool:active:';
const EXPIRY_KEY = 'tool:expiry';
const INFO_PREFIX = 'tool:info:';

const ID_PATTERN = /^[a-f0-9]{32}$/;
const JOB_TTL_SECONDS = 6 * 3600; // upper bound; ready jobs are expired sooner by the sweeper

const isValidId = (id) => typeof id === 'string' && ID_PATTERN.test(id);

async function create(job) {
  await redis.set(`${JOB_PREFIX}${job.id}`, JSON.stringify(job), 'EX', JOB_TTL_SECONDS);
  return job;
}

async function get(id) {
  if (!isValidId(id)) return null;
  const raw = await redis.get(`${JOB_PREFIX}${id}`);
  return raw ? JSON.parse(raw) : null;
}

/** Read-modify-write: each job has exactly one writer at a time (the worker that owns it). */
async function update(id, patch) {
  const current = await get(id);
  if (!current) return null;
  const next = { ...current, ...patch };
  const ttl = await redis.ttl(`${JOB_PREFIX}${id}`);
  await redis.set(`${JOB_PREFIX}${id}`, JSON.stringify(next), 'EX', ttl > 0 ? ttl : JOB_TTL_SECONDS);
  return next;
}

async function remove(id) {
  await redis.del(`${JOB_PREFIX}${id}`);
}

// --- per-visitor active downloads (keyed by a hash of the IP, never the raw address)
async function addActive(ipKey, id) {
  const key = `${ACTIVE_PREFIX}${ipKey}`;
  await redis.sadd(key, id);
  await redis.expire(key, JOB_TTL_SECONDS);
}

async function removeActive(ipKey, id) {
  await redis.srem(`${ACTIVE_PREFIX}${ipKey}`, id);
}

/** Counts a visitor's in-flight downloads, forgetting ids whose job no longer exists (crash, expiry). */
async function countActive(ipKey) {
  const key = `${ACTIVE_PREFIX}${ipKey}`;
  const ids = await redis.smembers(key);
  let live = 0;
  for (const id of ids) {
     
    const job = await get(id);
    if (job && (job.state === 'queued' || job.state === 'downloading')) live += 1;
     
    else await redis.srem(key, id);
  }
  return live;
}

// --- expiry index: which ready files are due for deletion
const scheduleExpiry = (id, atMs) => redis.zadd(EXPIRY_KEY, atMs, id);
const dueForExpiry = (nowMs) => redis.zrangebyscore(EXPIRY_KEY, 0, nowMs);
const clearExpiry = (id) => redis.zrem(EXPIRY_KEY, id);

// --- short-lived cache of metadata lookups, so "show options" then "download" costs one yt-dlp call
async function getCachedInfo(hash) {
  const raw = await redis.get(`${INFO_PREFIX}${hash}`);
  return raw ? JSON.parse(raw) : null;
}
const setCachedInfo = (hash, info, ttlSeconds = 600) => redis.set(`${INFO_PREFIX}${hash}`, JSON.stringify(info), 'EX', ttlSeconds);

module.exports = {
  isValidId,
  create,
  get,
  update,
  remove,
  addActive,
  removeActive,
  countActive,
  scheduleExpiry,
  dueForExpiry,
  clearExpiry,
  getCachedInfo,
  setCachedInfo,
};
