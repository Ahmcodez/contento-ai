const { Queue } = require('bullmq');
const connection = require('../redis/client');

const QUEUE_NAMES = {
  URL_IMPORT_RESOLVE: 'url-import-resolve',
  URL_IMPORT_DOWNLOAD: 'url-import-download',
  VIDEO_VALIDATE: 'video-validate',
  AUDIO_EXTRACT: 'audio-extract',
  TRANSCRIPTION_PROCESS: 'transcription-process',
  CONTENT_ANALYZE: 'content-analyze',
  CLIPS_DETECT: 'clips-detect',
  CLIP_RENDER: 'clip-render',
  CONTENT_GENERATE: 'content-generate',
  JOB_FINALIZE: 'job-finalize',
};

/**
 * QUEUE_NAMES are *logical stages*: they identify a pipeline stage in
 * logs, metrics, retry policy and the durable `failure_stage` column, and
 * they are what every producer/processor passes to getQueue(). They are
 * NOT one-to-one with Redis queues any more.
 *
 * PHYSICAL_QUEUES are the real BullMQ queues (each = one Worker = one
 * idle polling loop, ~30 Redis commands/min forever). Stages share a
 * physical queue only when their workloads are compatible; see
 * docs/QUEUE.md §1 for the audit behind this grouping:
 *
 *  - LIGHT: ms-to-seconds jobs (ffprobe, audio extract, DB finalize, URL
 *    metadata) — head-of-line blocking and per-stage caps are moot.
 *  - AI: network-bound Gemini calls with identical retry policy that draw
 *    on one shared provider quota, so one shared limit governs them better
 *    than three separate ones.
 *  - DOWNLOAD / TRANSCRIPTION / RENDER: stay alone. Minutes-long, resource-
 *    heavy (disk+untrusted network / RAM+CPU / CPU), and each must be
 *    independently scalable and isolated.
 */
const PHYSICAL_QUEUES = {
  LIGHT: 'pipeline-light',
  AI: 'ai-process',
  DOWNLOAD: 'url-import-download',
  TRANSCRIPTION: 'transcription-process',
  RENDER: 'clip-render',
};

const STAGE_TO_QUEUE = {
  [QUEUE_NAMES.URL_IMPORT_RESOLVE]: PHYSICAL_QUEUES.LIGHT,
  [QUEUE_NAMES.VIDEO_VALIDATE]: PHYSICAL_QUEUES.LIGHT,
  [QUEUE_NAMES.AUDIO_EXTRACT]: PHYSICAL_QUEUES.LIGHT,
  [QUEUE_NAMES.JOB_FINALIZE]: PHYSICAL_QUEUES.LIGHT,
  [QUEUE_NAMES.CONTENT_ANALYZE]: PHYSICAL_QUEUES.AI,
  [QUEUE_NAMES.CLIPS_DETECT]: PHYSICAL_QUEUES.AI,
  [QUEUE_NAMES.CONTENT_GENERATE]: PHYSICAL_QUEUES.AI,
  [QUEUE_NAMES.URL_IMPORT_DOWNLOAD]: PHYSICAL_QUEUES.DOWNLOAD,
  [QUEUE_NAMES.TRANSCRIPTION_PROCESS]: PHYSICAL_QUEUES.TRANSCRIPTION,
  [QUEUE_NAMES.CLIP_RENDER]: PHYSICAL_QUEUES.RENDER,
};

/**
 * Pre-consolidation queue names whose contents must be migrated into
 * their new physical queue (see src/queue/legacyMigration.js). The three
 * standalone queues kept their names, so they need no migration.
 */
const LEGACY_QUEUE_TO_STAGE = {
  'url-import-resolve': QUEUE_NAMES.URL_IMPORT_RESOLVE,
  'video-validate': QUEUE_NAMES.VIDEO_VALIDATE,
  'audio-extract': QUEUE_NAMES.AUDIO_EXTRACT,
  'job-finalize': QUEUE_NAMES.JOB_FINALIZE,
  'content-analyze': QUEUE_NAMES.CONTENT_ANALYZE,
  'clips-detect': QUEUE_NAMES.CLIPS_DETECT,
  'content-generate': QUEUE_NAMES.CONTENT_GENERATE,
};

const RETRY_CONFIG = {
  // Resolving the provider + fetching a metadata preview is a single
  // lightweight network call (or subprocess call, for yt-dlp-backed
  // providers) — a couple of retries covers a transient blip without
  // making the user wait too long for a preview that's about to fail
  // anyway if the URL is genuinely bad.
  [QUEUE_NAMES.URL_IMPORT_RESOLVE]: { attempts: 2, backoff: { type: 'exponential', delay: 3000 } },
  // The actual download is the long-running, network-heavy step —
  // more attempts, longer backoff, matching AUDIO_EXTRACT/TRANSCRIPTION_
  // PROCESS's reasoning for similarly substantial operations.
  [QUEUE_NAMES.URL_IMPORT_DOWNLOAD]: { attempts: 3, backoff: { type: 'exponential', delay: 5000 } },
  [QUEUE_NAMES.VIDEO_VALIDATE]: { attempts: 1 },
  [QUEUE_NAMES.AUDIO_EXTRACT]: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  [QUEUE_NAMES.TRANSCRIPTION_PROCESS]: { attempts: 4, backoff: { type: 'exponential', delay: 5000 } },
  [QUEUE_NAMES.CONTENT_ANALYZE]: { attempts: 4, backoff: { type: 'exponential', delay: 3000 } },
  [QUEUE_NAMES.CLIPS_DETECT]: { attempts: 4, backoff: { type: 'exponential', delay: 3000 } },
  [QUEUE_NAMES.CLIP_RENDER]: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  [QUEUE_NAMES.CONTENT_GENERATE]: { attempts: 4, backoff: { type: 'exponential', delay: 3000 } },
  [QUEUE_NAMES.JOB_FINALIZE]: { attempts: 3, backoff: { type: 'fixed', delay: 2000 } },
};

const queues = {};

/**
 * Returns the physical Queue that carries the given logical stage. Every
 * producer keeps calling getQueue(QUEUE_NAMES.SOME_STAGE).add(jobName, ...)
 * exactly as before; job names and per-job retry options are unchanged, so
 * only the Redis key the job lands in differs.
 */
function getQueue(stage) {
  const physical = STAGE_TO_QUEUE[stage];
  if (!physical) throw new Error(`Unknown queue stage: ${stage}`);
  return getPhysicalQueue(physical);
}

function getPhysicalQueue(name) {
  if (!queues[name]) {
    // Each Queue gets its own duplicated connection rather than sharing
    // the one base connection across every queue (+ a matching Worker
    // for each, in src/workers/index.js). Sharing a single socket across
    // that many BullMQ consumers is a documented BullMQ anti-pattern and
    // a common, real cause of spontaneous "read ECONNRESET" under load —
    // see the doc comment in src/redis/client.js. .duplicate() reuses
    // the same connection options (retryStrategy, keepAlive, credentials)
    // while giving each queue its own socket.
    queues[name] = new Queue(name, { connection: connection.duplicate() });
  }
  return queues[name];
}

/**
 * Closes every Queue created via getQueue, and the duplicated connection
 * each one owns. Queue.close() does not close an externally-provided
 * ioredis connection on its own — BullMQ assumes the caller owns
 * connections it didn't create internally, so this has to be explicit or
 * every duplicated connection leaks on shutdown.
 */
async function closeAllQueues() {
  await Promise.all(
    Object.values(queues).map(async (queue) => {
      const dup = queue.opts.connection;
      await queue.close();
      if (dup && dup !== connection) await dup.quit().catch(() => {});
    }),
  );
}

module.exports = {
  QUEUE_NAMES,
  PHYSICAL_QUEUES,
  STAGE_TO_QUEUE,
  LEGACY_QUEUE_TO_STAGE,
  RETRY_CONFIG,
  getQueue,
  getPhysicalQueue,
  closeAllQueues,
};
