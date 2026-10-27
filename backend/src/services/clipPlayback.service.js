const crypto = require('crypto');
const config = require('../config');
const db = require('../db/client');
const AppError = require('../utils/AppError');
const { getStorageDriver } = require('../storage');
const { parseByteRange } = require('../utils/byteRange');
const workspaceService = require('./workspace.service');
const clipCandidateRepository = require('../repositories/clipCandidate.repository');

/**
 * In-app clip playback.
 *
 * A <video> element can't send an Authorization header, so the app first asks (as the
 * logged-in user) for a signed link, then points the player at it. The link carries an
 * expiry and an HMAC over (purpose, clip id, expiry): it works for that one clip and
 * that one purpose (video vs poster image), for a limited time, and nothing else.
 * Anyone holding the link can play that clip until it expires, the same trade-off as any
 * signed media URL; it is deliberately short-lived and is never stored.
 */

const key = () => crypto.createHash('sha256').update(`clip-playback:${config.auth.accessSecret}`).digest();

function sign(kind, clipId, exp) {
  return crypto.createHmac('sha256', key()).update(`${kind}:${clipId}:${exp}`).digest('base64url');
}

function makeToken(kind, clipId, nowMs = Date.now()) {
  const exp = Math.floor(nowMs / 1000) + config.playbackUrlTtlSeconds;
  return { token: `${exp}.${sign(kind, clipId, exp)}`, exp };
}

function verifyToken(kind, clipId, token, nowMs = Date.now()) {
  const invalid = () => AppError.forbidden('This playback link is invalid or has expired', 'INVALID_PLAYBACK_LINK');
  const [expRaw, sig, ...rest] = String(token || '').split('.');
  const exp = Number(expRaw);
  if (rest.length > 0 || !sig || !Number.isInteger(exp) || exp * 1000 <= nowMs) throw invalid();

  const expected = Buffer.from(sign(kind, clipId, exp));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw invalid();
}

async function findRenderedClip(clipCandidateId) {
  const generated = await db('generated_clips').where({ clip_candidate_id: clipCandidateId }).first();
  if (!generated || generated.render_status !== 'rendered' || !generated.storage_key) {
    throw AppError.conflict('This clip has not finished rendering yet', 'NOT_RENDERED');
  }
  return generated;
}

/** Asked for by the logged-in app: checks the user can see the clip, then mints links. */
async function createPlayback(userId, clipCandidateId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const candidate = await clipCandidateRepository.findByIdScoped(clipCandidateId, workspaceIds);
  if (!candidate) throw AppError.notFound('Clip not found');

  const generated = await findRenderedClip(clipCandidateId);
  const video = makeToken('video', clipCandidateId);
  const poster = generated.thumbnail_storage_key ? makeToken('poster', clipCandidateId) : null;

  return {
    streamUrl: `/api/v1/clips/${clipCandidateId}/stream?t=${video.token}`,
    posterUrl: poster ? `/api/v1/clips/${clipCandidateId}/thumbnail?t=${poster.token}` : null,
    expiresAt: new Date(video.exp * 1000).toISOString(),
  };
}

async function sizeOrNotFound(driver, storageKey) {
  return driver.size(storageKey).catch(() => {
    throw AppError.notFound('The clip file could not be found');
  });
}

/**
 * Opens the video for a signed link, honouring a Range header so the player can seek
 * and start playing without downloading the whole file. Returns what the controller
 * needs to write the response.
 */
async function openStream(clipCandidateId, token, rangeHeader) {
  verifyToken('video', clipCandidateId, token);
  const generated = await findRenderedClip(clipCandidateId);
  const driver = getStorageDriver();
  const size = await sizeOrNotFound(driver, generated.storage_key);

  const range = parseByteRange(rangeHeader, size);
  if (range === 'unsatisfiable') return { status: 416, size, contentType: 'video/mp4' };
  if (range === null) return { status: 200, size, contentLength: size, contentType: 'video/mp4', stream: await driver.getReadStream(generated.storage_key) };

  return {
    status: 206,
    size,
    contentLength: range.end - range.start + 1,
    contentRange: `bytes ${range.start}-${range.end}/${size}`,
    contentType: 'video/mp4',
    stream: await driver.getReadStream(generated.storage_key, range),
  };
}

async function openThumbnail(clipCandidateId, token) {
  verifyToken('poster', clipCandidateId, token);
  const generated = await findRenderedClip(clipCandidateId);
  if (!generated.thumbnail_storage_key) throw AppError.notFound('This clip has no thumbnail');
  const driver = getStorageDriver();
  const size = await sizeOrNotFound(driver, generated.thumbnail_storage_key);
  return { status: 200, size, contentLength: size, contentType: 'image/jpeg', stream: await driver.getReadStream(generated.thumbnail_storage_key) };
}

module.exports = { createPlayback, openStream, openThumbnail, makeToken, verifyToken };
