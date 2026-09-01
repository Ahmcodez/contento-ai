const { Queue } = require('bullmq');
const connection = require('../redis/client');

const QUEUE_NAMES = {
  VIDEO_VALIDATE: 'video-validate',
  AUDIO_EXTRACT: 'audio-extract',
  TRANSCRIPTION_PROCESS: 'transcription-process',
  CONTENT_ANALYZE: 'content-analyze',
  CLIPS_DETECT: 'clips-detect',
  CLIPS_SCORE: 'clips-score',
  CLIP_RENDER: 'clip-render',
  CONTENT_GENERATE: 'content-generate',
  JOB_FINALIZE: 'job-finalize',
};

const RETRY_CONFIG = {
  [QUEUE_NAMES.VIDEO_VALIDATE]: { attempts: 1 },
  [QUEUE_NAMES.AUDIO_EXTRACT]: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  [QUEUE_NAMES.TRANSCRIPTION_PROCESS]: { attempts: 4, backoff: { type: 'exponential', delay: 5000 } },
  [QUEUE_NAMES.CONTENT_ANALYZE]: { attempts: 4, backoff: { type: 'exponential', delay: 3000 } },
  [QUEUE_NAMES.CLIPS_DETECT]: { attempts: 4, backoff: { type: 'exponential', delay: 3000 } },
  [QUEUE_NAMES.CLIPS_SCORE]: { attempts: 2, backoff: { type: 'fixed', delay: 1000 } },
  [QUEUE_NAMES.CLIP_RENDER]: { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
  [QUEUE_NAMES.CONTENT_GENERATE]: { attempts: 4, backoff: { type: 'exponential', delay: 3000 } },
  [QUEUE_NAMES.JOB_FINALIZE]: { attempts: 3, backoff: { type: 'fixed', delay: 2000 } },
};

const queues = {};

function getQueue(name) {
  if (!queues[name]) {
    // Each Queue gets its own duplicated connection rather than sharing
    // the one base connection across all 9 queues (+ 8 Workers in
    // src/workers/index.js). Sharing a single socket across that many
    // BullMQ consumers is a documented BullMQ anti-pattern and a common,
    // real cause of spontaneous "read ECONNRESET" under load — see the
    // doc comment in src/redis/client.js. .duplicate() reuses the same
    // connection options (retryStrategy, keepAlive, credentials) while
    // giving each queue its own socket.
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

module.exports = { QUEUE_NAMES, RETRY_CONFIG, getQueue, closeAllQueues };
