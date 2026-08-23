const { Worker } = require('bullmq');
const connection = require('../redis/client');
const config = require('../config');
const logger = require('../logger');
const db = require('../db/client');
const processingJobRepository = require('../repositories/processingJob.repository');
const { QUEUE_NAMES } = require('../queue/queues');

const processVideoValidate = require('./processors/videoValidate.processor');
const processAudioExtract = require('./processors/audioExtract.processor');
const processTranscription = require('./processors/transcriptionProcess.processor');
const processContentAnalyze = require('./processors/contentAnalyze.processor');
const processClipsDetect = require('./processors/clipsDetect.processor');

/**
 * Registered stages for this milestone. clips.score / clip.render /
 * content.generate / job.finalize are queued in docs/QUEUE.md but their
 * processors are deferred to the milestone that adds their schema
 * (transcripts, clip_candidates, generated_clips, generated_content —
 * see docs/SUMMARY.md milestones 5-10). Registering a fake processor for
 * them now would mean fabricating persisted results with no backing
 * table, which is exactly what we're avoiding.
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
 * Wraps every processor so an unhandled/retryable-exhausted failure is
 * always recorded as a processing_errors row and the job flipped to
 * FAILED — the DB, not the Redis failed set, is the durable source of
 * truth a user's job actually needs (docs/QUEUE.md §4).
 */
function wrapWithErrorPersistence(queueName, handler) {
  return async (job) => {
    try {
      await handler(job);
    } catch (err) {
      const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 1);
      if (isLastAttempt) {
        const { processingJobId } = job.data;
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
      }
      throw err; // rethrow so BullMQ still records the failure/retry correctly
    }
  };
}

module.exports = { startWorkers };
