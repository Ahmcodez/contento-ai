const crypto = require('crypto');
const path = require('path');
const db = require('../db/client');
const redis = require('../redis/client');
const config = require('../config');
const logger = require('../logger');
const metrics = require('../metrics');
const processingJobRepository = require('../repositories/processingJob.repository');
const mediaImportRepository = require('../repositories/mediaImport.repository');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue, getPhysicalQueue, STAGE_TO_QUEUE } = require('../queue/queues');

/**
 * Stuck-job reaper.
 *
 * Postgres is the source of truth for what a job's state is; BullMQ/Redis is
 * what actually moves it forward. They can disagree:
 *
 *  - a worker or the API dies between "state changed" and "next job added"
 *    (e.g. AUDIO_EXTRACTED written, transcription job never enqueued)
 *  - Redis is flushed/restored from an old snapshot
 *  - BullMQ gives up on a job as stalled too many times (that failure never
 *    runs our processor, so nothing updates the row)
 *
 * In all of those the row sits in a non-terminal state forever and the user
 * just sees a spinner. BullMQ's own stalled-job recovery covers a *crashed
 * worker with a live job*; this covers rows with no live job at all.
 *
 * A sweep: (1) cheap Postgres query for non-terminal rows untouched for
 * REAPER_STUCK_AFTER_MS, (2) only if there are any, check Redis for a live
 * BullMQ job for each, (3) for the ones with none, re-enqueue the stage (up to
 * REAPER_MAX_REQUEUES_PER_STAGE times) and then fail the job with an honest
 * message. If Redis can't be read the sweep does nothing: "unknown" must never
 * be treated as "dead".
 */

const LIVE_JOB_TYPES = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children', 'paused'];

const LOCK_KEY = 'reaper:lock';
const LOCK_TTL_MS = 5 * 60 * 1000;

const INTERRUPTED_MESSAGE = 'Processing was interrupted and could not be recovered. Please try again.';

/** Non-terminal processing_jobs states -> the stage whose queue job should exist. */
const PIPELINE_STATE_TO_STAGE = {
  UPLOADED: QUEUE_NAMES.VIDEO_VALIDATE,
  VALIDATING: QUEUE_NAMES.VIDEO_VALIDATE,
  VALIDATED: QUEUE_NAMES.AUDIO_EXTRACT,
  EXTRACTING_AUDIO: QUEUE_NAMES.AUDIO_EXTRACT,
  AUDIO_EXTRACTED: QUEUE_NAMES.TRANSCRIPTION_PROCESS,
  TRANSCRIBING: QUEUE_NAMES.TRANSCRIPTION_PROCESS,
  TRANSCRIBED: QUEUE_NAMES.CONTENT_ANALYZE,
  ANALYZING: QUEUE_NAMES.CONTENT_ANALYZE,
  ANALYZED: QUEUE_NAMES.CLIPS_DETECT,
  FINDING_CLIPS: QUEUE_NAMES.CLIPS_DETECT,
  CLIPS_FOUND: QUEUE_NAMES.CLIPS_DETECT,
  SCORING_CLIPS: QUEUE_NAMES.CLIPS_DETECT,
  CLIPS_SCORED: QUEUE_NAMES.CLIP_RENDER,
  RENDERING_CLIPS: QUEUE_NAMES.CLIP_RENDER,
  CLIPS_RENDERED: QUEUE_NAMES.CONTENT_GENERATE,
  GENERATING_CONTENT: QUEUE_NAMES.CONTENT_GENERATE,
  CONTENT_GENERATED: QUEUE_NAMES.JOB_FINALIZE,
  FINALIZING: QUEUE_NAMES.JOB_FINALIZE,
};

/**
 * Non-terminal media_imports states that are driven by a queue job. Not here
 * on purpose: WAITING_CONFIRMATION (waiting on the user, no job expected) and
 * VALIDATING_MEDIA (the download job already finished its work; whether the
 * media asset got created is unknowable from here, so it is failed, never re-run).
 */
const IMPORT_STATE_TO_STAGE = {
  DETECTING_PROVIDER: QUEUE_NAMES.URL_IMPORT_RESOLVE,
  FETCHING_METADATA: QUEUE_NAMES.URL_IMPORT_RESOLVE,
  DOWNLOADING: QUEUE_NAMES.URL_IMPORT_DOWNLOAD,
};
const IMPORT_FAIL_ONLY_STATES = ['VALIDATING_MEDIA'];

const STAGE_JOB_NAMES = {
  [QUEUE_NAMES.URL_IMPORT_RESOLVE]: 'url-import.resolve',
  [QUEUE_NAMES.URL_IMPORT_DOWNLOAD]: 'url-import.download',
  [QUEUE_NAMES.VIDEO_VALIDATE]: 'video.validate',
  [QUEUE_NAMES.AUDIO_EXTRACT]: 'audio.extract',
  [QUEUE_NAMES.TRANSCRIPTION_PROCESS]: 'transcription.process',
  [QUEUE_NAMES.CONTENT_ANALYZE]: 'content.analyze',
  [QUEUE_NAMES.CLIPS_DETECT]: 'clips.detect',
  [QUEUE_NAMES.CLIP_RENDER]: 'clip.render',
  [QUEUE_NAMES.CONTENT_GENERATE]: 'content.generate',
  [QUEUE_NAMES.JOB_FINALIZE]: 'job.finalize',
};

/** Same derivation as audioExtract.processor.js, so a re-enqueued job points at the same file. */
function audioKeyFor(storageKey) {
  return storageKey.replace(path.extname(storageKey), '.audio.wav');
}

/**
 * Rebuilds the exact payload the stage's own producer would have enqueued,
 * from what is in the database. Returns null if it can't (asset gone).
 */
async function buildPipelinePayload(stage, row) {
  const asset = await db('media_assets').where({ id: row.media_asset_id }).first();
  if (!asset) return null;

  const base = { processingJobId: row.id, mediaAssetId: asset.id };
  if (stage === QUEUE_NAMES.TRANSCRIPTION_PROCESS) {
    return { ...base, audioStorageKey: audioKeyFor(asset.storage_key) };
  }
  if (stage === QUEUE_NAMES.CLIP_RENDER) {
    const candidates = await db('clip_candidates').where({ processing_job_id: row.id }).orderBy('rank', 'asc').select('id');
    return { ...base, clipCandidateIds: candidates.map((c) => c.id) };
  }
  return base;
}

/** One lookup table per sweep: which (job name, entity id) pairs have a live BullMQ job. */
async function loadLiveJobIndex(physicalQueueName) {
  const jobs = await getPhysicalQueue(physicalQueueName).getJobs(LIVE_JOB_TYPES, 0, -1);
  const live = new Set();
  for (const job of jobs) {
    if (!job) continue;
    const id = job.data?.processingJobId || job.data?.mediaImportId;
    if (id) live.add(`${job.name}:${id}`);
  }
  return live;
}

async function acquireLock() {
  const token = crypto.randomUUID();
  const ok = await redis.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
  return ok === 'OK' ? token : null;
}

async function releaseLock(token) {
  // Only delete the lock if it is still ours (it may have expired and been re-taken).
  await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, LOCK_KEY, token);
}

/**
 * Atomically claims a stuck row by bumping updated_at. The same cutoff in the
 * WHERE clause means two reapers racing on one row cannot both win: the second
 * sees a fresh updated_at and matches nothing.
 */
async function claimRow(table, id, state, cutoff) {
  const claimed = await db(table).where({ id, state }).andWhere('updated_at', '<', cutoff).update({ updated_at: db.fn.now() });
  return claimed === 1;
}

async function countPriorRequeues(eventsTable, fkColumn, id, state) {
  const row = await db(eventsTable)
    .where({ [fkColumn]: id, to_state: state })
    .whereRaw("metadata->>'reaper' = 'requeued'")
    .count('id as count')
    .first();
  return Number(row.count);
}

async function recordRequeue(eventsTable, fkColumn, id, state, stage, attempt) {
  await db(eventsTable).insert({
    [fkColumn]: id,
    from_state: state,
    to_state: state,
    metadata: JSON.stringify({ reaper: 'requeued', stage, attempt }),
  });
}

async function enqueueStage(stage, payload) {
  return getQueue(stage).add(STAGE_JOB_NAMES[stage], payload, {
    ...RETRY_CONFIG[stage],
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

async function failPipelineJob(row, reason) {
  await db('processing_errors').insert({
    processing_job_id: row.id,
    stage: row.state,
    message: `Reaper: ${reason}`,
    detail: JSON.stringify({ reaper: true, state: row.state }),
    retry_count: 0,
  });
  await processingJobRepository.transitionState(row.id, {
    fromState: row.state,
    toState: 'FAILED',
    failureStage: row.state,
    errorMessage: INTERRUPTED_MESSAGE,
    metadata: { reaper: 'failed', reason },
  });
}

async function failImport(row, reason) {
  await mediaImportRepository.transitionState(row.id, {
    fromState: row.state,
    toState: 'FAILED',
    failureStage: row.state,
    errorMessage: INTERRUPTED_MESSAGE,
    metadata: { reaper: 'failed', reason },
  });
}

/**
 * Handles one stuck candidate. `kind` selects which table/state-machine it is.
 * Returns 'requeued' | 'failed' | 'skipped'.
 */
async function recoverOne(kind, row, stage, liveIndexes, cutoff) {
  const isPipeline = kind === 'pipeline';
  const table = isPipeline ? 'processing_jobs' : 'media_imports';
  const eventsTable = isPipeline ? 'processing_job_events' : 'media_import_events';
  const fkColumn = isPipeline ? 'processing_job_id' : 'media_import_id';
  const fail = isPipeline ? failPipelineJob : failImport;

  // Fail-only states have no stage to look for in Redis.
  if (stage) {
    const live = liveIndexes.get(STAGE_TO_QUEUE[stage]);
    if (!live) return 'skipped'; // Redis unreadable for this queue: never guess
    if (live.has(`${STAGE_JOB_NAMES[stage]}:${row.id}`)) return 'skipped'; // someone is on it
  }

  if (!(await claimRow(table, row.id, row.state, cutoff))) return 'skipped'; // changed or claimed since we looked

  if (!stage) {
    await fail(row, 'no queue job can resume this state');
    metrics.increment('reaper_failed', { state: row.state });
    return 'failed';
  }

  const prior = await countPriorRequeues(eventsTable, fkColumn, row.id, row.state);
  if (prior >= config.reaper.maxRequeuesPerStage) {
    await fail(row, `no live queue job after ${prior} re-enqueue(s)`);
    metrics.increment('reaper_failed', { state: row.state });
    return 'failed';
  }

  const payload = isPipeline ? await buildPipelinePayload(stage, row) : { mediaImportId: row.id };
  if (!payload) {
    await fail(row, 'source media no longer exists');
    metrics.increment('reaper_failed', { state: row.state });
    return 'failed';
  }

  await enqueueStage(stage, payload);
  await recordRequeue(eventsTable, fkColumn, row.id, row.state, stage, prior + 1);
  metrics.increment('reaper_requeued', { stage });
  return 'requeued';
}

/**
 * Runs one sweep and returns counts. Safe to call from several processes at
 * once (Redis lock + per-row claim) and safe to call as often as you like.
 */
async function sweep({ now = Date.now() } = {}) {
  const cutoff = new Date(now - config.reaper.stuckAfterMs);
  const result = { examined: 0, requeued: 0, failed: 0, skipped: 0 };

  const pipelineRows = await db('processing_jobs')
    .whereIn('state', Object.keys(PIPELINE_STATE_TO_STAGE))
    .andWhere('updated_at', '<', cutoff)
    .select('id', 'media_asset_id', 'state');
  const importRows = await db('media_imports')
    .whereIn('state', [...Object.keys(IMPORT_STATE_TO_STAGE), ...IMPORT_FAIL_ONLY_STATES])
    .andWhere('updated_at', '<', cutoff)
    .select('id', 'state');

  // The common case: nothing is old enough to be suspicious, so Redis is never touched.
  if (pipelineRows.length === 0 && importRows.length === 0) return result;

  const lockToken = await acquireLock();
  if (!lockToken) return result; // another process is already sweeping

  try {
    const work = [
      ...pipelineRows.map((row) => ({ kind: 'pipeline', row, stage: PIPELINE_STATE_TO_STAGE[row.state] })),
      ...importRows.map((row) => ({ kind: 'import', row, stage: IMPORT_STATE_TO_STAGE[row.state] || null })),
    ];

    // One Redis read per physical queue that has a candidate, not one per job.
    const liveIndexes = new Map();
    const queuesNeeded = new Set(work.filter((w) => w.stage).map((w) => STAGE_TO_QUEUE[w.stage]));
    for (const queueName of queuesNeeded) {
      try {
        liveIndexes.set(queueName, await loadLiveJobIndex(queueName));
      } catch (err) {
        logger.error({ queue: queueName, err: err.message }, 'reaper: cannot read queue, skipping its candidates');
      }
    }

    for (const { kind, row, stage } of work) {
      result.examined += 1;
      let outcome;
      try {
        outcome = await recoverOne(kind, row, stage, liveIndexes, cutoff);
      } catch (err) {
        logger.error({ kind, id: row.id, state: row.state, err: err.message }, 'reaper: recovery failed for one job');
        outcome = 'skipped';
      }
      result[outcome] += 1;
      if (outcome !== 'skipped') {
        logger.warn({ kind, id: row.id, state: row.state, outcome }, 'reaper: recovered a stuck job');
      }
    }
  } finally {
    await releaseLock(lockToken).catch(() => {});
  }

  return result;
}

/**
 * Starts the periodic sweep. First sweep runs shortly after start so a restart
 * after an outage cleans up quickly. Returns { stop } for graceful shutdown.
 */
function startReaper({ intervalMs = config.reaper.intervalMs, firstRunDelayMs = 15000 } = {}) {
  let stopped = false;
  let running = false;

  const run = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const result = await sweep();
      if (result.requeued || result.failed) logger.info(result, 'reaper: sweep finished');
    } catch (err) {
      logger.error({ err: err.message }, 'reaper: sweep failed');
    } finally {
      running = false;
    }
  };

  const first = setTimeout(run, firstRunDelayMs);
  const timer = setInterval(run, intervalMs);
  first.unref();
  timer.unref();
  logger.info({ intervalMs, stuckAfterMs: config.reaper.stuckAfterMs }, 'reaper started');

  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}

module.exports = {
  sweep,
  startReaper,
  PIPELINE_STATE_TO_STAGE,
  IMPORT_STATE_TO_STAGE,
  INTERRUPTED_MESSAGE,
  audioKeyFor,
};
