const logger = require('../../logger');
const processingJobRepository = require('../../repositories/processingJob.repository');

/**
 * Deterministic aggregation step (docs/PIPELINE.md §3.10) — no AI or
 * media work here, just marking the job COMPLETED. Kept as its own queue
 * stage (rather than folded into content.generate) so it's independently
 * retryable and so the job history clearly shows a distinct finalize
 * event.
 */
async function processJobFinalize(job) {
  const { processingJobId } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'CONTENT_GENERATED',
    toState: 'COMPLETED',
    progressPercent: 100,
  });

  logger.info({ processingJobId }, 'job.finalize completed — pipeline done');
}

module.exports = processJobFinalize;
