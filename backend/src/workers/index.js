const { Worker } = require('bullmq');
const connection = require('../redis/client');
const config = require('../config');
const logger = require('../logger');
const metrics = require('../metrics');
const db = require('../db/client');
const processingJobRepository = require('../repositories/processingJob.repository');
const { QUEUE_NAMES } = require('../queue/queues');

const processVideoValidate = require('./processors/videoValidate.processor');
const processAudioExtract = require('./processors/audioExtract.processor');
const processTranscription = require('./processors/transcriptionProcess.processor');
const processContentAnalyze = require('./processors/contentAnalyze.processor');
const processClipsDetect = require('./processors/clipsDetect.processor');
const processClipRender = require('./processors/clipRender.processor');
const processContentGenerate = require('./processors/contentGenerate.processor');
const processJobFinalize = require('./processors/jobFinalize.processor');

/**
 * All pipeline stages through job.finalize are registered. Written
 * content generation is chained after clip rendering rather than run as
 * a true parallel branch — see the comment in contentAnalyze.processor.js
 * for why.
 */
const STAGE_PROCESSORS = [
  { queue: QUEUE_NAMES.VIDEO_VALIDATE, handler: processVideoValidate, concurrency: config.queue.concurrencyDefault },
  { queue: QUEUE_NAMES.AUDIO_EXTRACT, handler: processAudioExtract, concurrency: config.queue.concurrencyDefault },
  {
    queue: QUEUE_NAMES.TRANSCRIPTION_PROCESS,
    handler: processTranscription,
    concurrency: config.queue.concurrencyTranscription,
  },
  { queue: QUEUE_NAMES.CONTENT_ANALYZE, handler: processContentAnalyze, concurrency: config.queue.concurrencyDefault },
  { queue: QUEUE_NAMES.CLIPS_DETECT, handler: processClipsDetect, concurrency: config.queue.concurrencyDefault },
  { queue: QUEUE_NAMES.CLIP_RENDER, handler: processClipRender, concurrency: config.queue.concurrencyDefault },
  { queue: QUEUE_NAMES.CONTENT_GENERATE, handler: processContentGenerate, concurrency: config.queue.concurrencyDefault },
  { queue: QUEUE_NAMES.JOB_FINALIZE, handler: processJobFinalize, concurrency: config.queue.concurrencyDefault },
];

function startWorkers() {
  const workers = STAGE_PROCESSORS.map(({ queue, handler, concurrency }) => {
    const worker = new Worker(queue, wrapWithErrorPersistence(queue, handler), { connection, concurrency });

    worker.on('completed', (job) => {
      logger.info({ queue, jobId: job.id }, 'job completed');
    });

    worker.on('failed', (job, err) => {
      logger.error({ queue, jobId: job?.id, err: err.message, attemptsMade: job?.attemptsMade }, 'job failed');
    });

    return worker;
  });

  logger.info(`Worker started, handling ${workers.length} queues`);
  return workers;
}

/**
 * Wraps every processor with:
 *  - structured start/complete/fail logging carrying processingJobId,
 *    stage, and duration on every line (docs/OPERATIONS.md logging spec)
 *  - metrics counters/duration samples (src/metrics)
 *  - persistence of a terminal failure to processing_errors + FAILED
 *    state, so the DB (not the Redis failed set) is the durable source
 *    of truth a user's job actually needs (docs/QUEUE.md §4)
 */
function wrapWithErrorPersistence(queueName, handler) {
  return async (job) => {
    const { processingJobId } = job.data;
    const stageLogger = logger.child({ stage: queueName, jobId: job.id, processingJobId });
    const startedAt = Date.now();

    stageLogger.info('stage started');

    try {
      await handler(job);
      const durationMs = Date.now() - startedAt;
      metrics.recordDuration(queueName, durationMs);
      metrics.increment('stage_completed', { stage: queueName });
      stageLogger.info({ durationMs }, 'stage completed');
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      metrics.recordDuration(queueName, durationMs);
      metrics.increment('stage_failed', { stage: queueName });
      stageLogger.error({ durationMs, err: err.message, attemptsMade: job.attemptsMade }, 'stage failed');

      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 1);
      if (isLastAttempt) {
        if (processingJobId) {
          await db('processing_errors').insert({
            processing_job_id: processingJobId,
            stage: queueName,
            message: err.message,
            detail: JSON.stringify({ stack: err.stack }),
            retry_count: job.attemptsMade,
          });
          const current = await db('processing_jobs').where({ id: processingJobId }).first();
          if (current && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.state)) {
            await processingJobRepository.transitionState(processingJobId, {
              fromState: current.state,
              toState: 'FAILED',
              failureStage: queueName,
              errorMessage: 'Processing failed after multiple attempts. Please try again or contact support.',
            });
          }
        }
        metrics.increment('job_failed_terminal', { stage: queueName });
      }
      throw err; // rethrow so BullMQ still records the failure/retry correctly
    }
  };
}

module.exports = { startWorkers };
