const { Worker, UnrecoverableError } = require('bullmq');
const connection = require('../redis/client');
const config = require('../config');
const logger = require('../logger');
const metrics = require('../metrics');
const db = require('../db/client');
const processingJobRepository = require('../repositories/processingJob.repository');
const mediaImportRepository = require('../repositories/mediaImport.repository');
const { QUEUE_NAMES, PHYSICAL_QUEUES, STAGE_TO_QUEUE } = require('../queue/queues');

const processUrlImportResolve = require('./processors/urlImportResolve.processor');
const processUrlImportDownload = require('./processors/urlImportDownload.processor');
const processVideoValidate = require('./processors/videoValidate.processor');
const processAudioExtract = require('./processors/audioExtract.processor');
const processTranscription = require('./processors/transcriptionProcess.processor');
const processContentAnalyze = require('./processors/contentAnalyze.processor');
const processClipsDetect = require('./processors/clipsDetect.processor');
const processClipRender = require('./processors/clipRender.processor');
const processContentGenerate = require('./processors/contentGenerate.processor');
const processJobFinalize = require('./processors/jobFinalize.processor');

/**
 * Every pipeline stage, keyed by logical stage (QUEUE_NAMES). `jobName` is
 * the BullMQ job name producers already use for that stage — it is what a
 * shared Worker dispatches on. `idField` selects which of the two payload
 * shapes the stage uses ('processingJobId' for pipeline stages,
 * 'mediaImportId' for the two URL-import stages that precede a MediaAsset).
 *
 * Written content generation is chained after clip rendering rather than
 * run as a true parallel branch — see contentAnalyze.processor.js.
 */
const STAGES = {
  [QUEUE_NAMES.URL_IMPORT_RESOLVE]: { jobName: 'url-import.resolve', handler: processUrlImportResolve, idField: 'mediaImportId' },
  [QUEUE_NAMES.URL_IMPORT_DOWNLOAD]: { jobName: 'url-import.download', handler: processUrlImportDownload, idField: 'mediaImportId' },
  [QUEUE_NAMES.VIDEO_VALIDATE]: { jobName: 'video.validate', handler: processVideoValidate },
  [QUEUE_NAMES.AUDIO_EXTRACT]: { jobName: 'audio.extract', handler: processAudioExtract },
  [QUEUE_NAMES.TRANSCRIPTION_PROCESS]: { jobName: 'transcription.process', handler: processTranscription },
  [QUEUE_NAMES.CONTENT_ANALYZE]: { jobName: 'content.analyze', handler: processContentAnalyze },
  [QUEUE_NAMES.CLIPS_DETECT]: { jobName: 'clips.detect', handler: processClipsDetect },
  [QUEUE_NAMES.CLIP_RENDER]: { jobName: 'clip.render', handler: processClipRender },
  [QUEUE_NAMES.CONTENT_GENERATE]: { jobName: 'content.generate', handler: processContentGenerate },
  [QUEUE_NAMES.JOB_FINALIZE]: { jobName: 'job.finalize', handler: processJobFinalize },
};

/**
 * Slots per physical queue. Standalone queues keep their historical values;
 * the two shared queues are sized in src/config (see the notes there).
 */
const QUEUE_CONCURRENCY = {
  [PHYSICAL_QUEUES.LIGHT]: config.queue.concurrencyLight,
  [PHYSICAL_QUEUES.AI]: config.queue.concurrencyAi,
  [PHYSICAL_QUEUES.DOWNLOAD]: config.queue.concurrencyDefault,
  [PHYSICAL_QUEUES.TRANSCRIPTION]: config.queue.concurrencyTranscription,
  [PHYSICAL_QUEUES.RENDER]: config.queue.concurrencyDefault,
};

/** One entry per physical queue: which stages it carries + its concurrency. */
function buildWorkerGroups() {
  return Object.values(PHYSICAL_QUEUES).map((queue) => ({
    queue,
    concurrency: QUEUE_CONCURRENCY[queue],
    stages: Object.entries(STAGE_TO_QUEUE)
      .filter(([, physical]) => physical === queue)
      .map(([stage]) => ({ stage, ...STAGES[stage] })),
  }));
}

/**
 * A shared Worker's processor: routes each job to its stage handler by
 * job.name, wrapped with the same logging/metrics/error-persistence as
 * before (keyed by the LOGICAL stage so logs, metrics and the durable
 * failure_stage column are unchanged by consolidation).
 *
 * An unknown job name can only mean a producer/deploy mismatch. Retrying
 * can never fix that, so it fails immediately (UnrecoverableError) and
 * loudly rather than burning attempts.
 */
function buildDispatcher(queueName, stages) {
  const byJobName = new Map(
    stages.map(({ stage, jobName, handler, idField }) => [jobName, wrapWithErrorPersistence(stage, handler, idField)]),
  );
  return async (job) => {
    const run = byJobName.get(job.name);
    if (!run) {
      logger.error({ queue: queueName, jobId: job.id, jobName: job.name }, 'no handler registered for job name');
      throw new UnrecoverableError(`No handler for job "${job.name}" on queue "${queueName}"`);
    }
    return run(job);
  };
}

function startWorkers() {
  const workers = buildWorkerGroups().map(({ queue, concurrency, stages }) => {
    // Each Worker gets its own duplicated connection for the same reason
    // each Queue does (see the comment in src/queue/queues.js) — a
    // Worker holds a blocking command (BZPOPMIN) open on its
    // connection for as long as it's waiting for a job, so sharing one
    // socket across this many of them is exactly the kind of contention
    // that produces spontaneous ECONNRESET under real load.
    const workerConnection = connection.duplicate();
    const worker = new Worker(queue, buildDispatcher(queue, stages), {
      connection: workerConnection,
      concurrency,
      // Idle-cost tuning, verified against the installed BullMQ (5.81):
      // an idle worker blocks for `drainDelay` seconds (uncapped when no
      // delayed jobs exist), and new jobs / due retries wake it early, so
      // raising this cuts idle Redis traffic without adding pickup or
      // retry latency. stalledInterval only bounds how fast a crashed
      // worker's job is recovered (kept at BullMQ's default of 30s, see
      // config). lockDuration is left at BullMQ's default on purpose —
      // that is the actual liveness guarantee.
      drainDelay: config.queue.drainDelaySeconds,
      stalledInterval: config.queue.stalledIntervalMs,
    });
    worker.duplicatedConnection = workerConnection;

    worker.on('completed', (job) => {
      logger.info({ queue, jobId: job.id, jobName: job.name }, 'job completed');
    });

    worker.on('failed', (job, err) => {
      logger.error(
        { queue, jobId: job?.id, jobName: job?.name, err: err.message, attemptsMade: job?.attemptsMade },
        'job failed',
      );
    });

    return worker;
  });

  logger.info(`Worker started: ${workers.length} queues, ${Object.keys(STAGES).length} stages`);
  return workers;
}

/**
 * Closes every worker returned by startWorkers, plus the duplicated
 * connection each one owns. worker.close() alone does not close an
 * externally-provided connection — see the closeAllQueues doc comment in
 * src/queue/queues.js for the same reasoning.
 */
async function stopWorkers(workers) {
  await Promise.all(
    workers.map(async (worker) => {
      await worker.close();
      if (worker.duplicatedConnection) await worker.duplicatedConnection.quit().catch(() => {});
    }),
  );
}

/**
 * Wraps every processor with:
 *  - structured start/complete/fail logging carrying the relevant job id
 *    (processingJobId for pipeline stages, mediaImportId for the two
 *    URL-import stages that precede a MediaAsset existing), stage, and
 *    duration on every line (docs/OPERATIONS.md logging spec)
 *  - metrics counters/duration samples (src/metrics)
 *  - persistence of a terminal failure to the right durable table
 *    (processing_errors + FAILED state for pipeline stages,
 *    media_imports.state = FAILED for the URL-import stages) so the DB
 *    — not the Redis failed set — is the durable source of truth a
 *    user's job actually needs (docs/QUEUE.md §4). Both stages already
 *    fail themselves cleanly and explicitly for every *expected*
 *    failure (bad URL, private video, ffmpeg missing, ...) without
 *    reaching this fallback at all — this only catches whatever's left:
 *    a genuinely exhausted retryable error, or a bug. A stuck-forever
 *    media_imports/processing_jobs row from an error that fell through
 *    every specific handler is exactly the class of bug the ffmpeg-
 *    missing incident was, so this fallback exists specifically so that
 *    can never happen silently again, for either job data shape.
 *
 * `idField` selects which of the two shapes a queue's job.data uses:
 * 'processingJobId' (the default, every pipeline-proper stage) or
 * 'mediaImportId' (the two URL-import stages).
 */
function wrapWithErrorPersistence(queueName, handler, idField = 'processingJobId') {
  return async (job) => {
    const id = job.data[idField];
    const stageLogger = logger.child({ stage: queueName, jobId: job.id, [idField]: id });
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
      if (isLastAttempt && id) {
        if (idField === 'mediaImportId') {
          const current = await db('media_imports').where({ id }).first();
          if (current && !['COMPLETED', 'FAILED'].includes(current.state)) {
            await mediaImportRepository.transitionState(id, {
              fromState: current.state,
              toState: 'FAILED',
              failureStage: queueName,
              errorMessage: 'Import failed after multiple attempts. Please try again.',
            });
          }
        } else {
          await db('processing_errors').insert({
            processing_job_id: id,
            stage: queueName,
            message: err.message,
            detail: JSON.stringify({ stack: err.stack }),
            retry_count: job.attemptsMade,
          });
          const current = await db('processing_jobs').where({ id }).first();
          if (current && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.state)) {
            await processingJobRepository.transitionState(id, {
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

// wrapWithErrorPersistence is exported alongside startWorkers so its
// retry-exhaustion / terminal-failure behavior can be tested directly
// against fake BullMQ job objects, rather than only indirectly through a
// full real Worker+Queue+backoff-timing integration test.
module.exports = { startWorkers, stopWorkers, wrapWithErrorPersistence, buildDispatcher, buildWorkerGroups, STAGES };
