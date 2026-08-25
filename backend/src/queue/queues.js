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
    queues[name] = new Queue(name, { connection });
  }
  return queues[name];
}

module.exports = { QUEUE_NAMES, RETRY_CONFIG, getQueue };
