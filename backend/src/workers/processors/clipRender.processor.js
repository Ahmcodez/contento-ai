const logger = require('../../logger');
const db = require('../../db/client');
const config = require('../../config');
const processingJobRepository = require('../../repositories/processingJob.repository');
const transcriptRepository = require('../../repositories/transcript.repository');
const clipRenderService = require('../../services/clipRender.service');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

/**
 * Runs `tasks` through `worker` with at most `limit` in flight at once.
 * Plain Promise-pool, no library needed for something this small. Each
 * task's outcome (value or error) is captured independently — one
 * rejecting never aborts or skips the others, matching the previous
 * sequential for-loop's error-isolation behavior exactly.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runNext() {
    const i = nextIndex;
    nextIndex += 1;
    if (i >= items.length) return;
    try {
      results[i] = { status: 'fulfilled', value: await worker(items[i], i) };
    } catch (err) {
      results[i] = { status: 'rejected', reason: err };
    }
    await runNext();
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

/**
 * Renders every clip candidate for this job through a small bounded-
 * concurrency pool (CLIP_RENDER_CONCURRENCY_PER_JOB — docs/COST.md §4,
 * docs/QUEUE.md §5; was fully sequential, which at up to 10 clips/video
 * made this stage the dominant share of total job time). A single clip
 * failing to render does not fail the whole stage (docs/PIPELINE.md
 * §3.8) — each render is independently caught and recorded, and the
 * stage only fails outright if every clip fails.
 */
async function processClipRender(job) {
  const { processingJobId, mediaAssetId, clipCandidateIds } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'CLIPS_SCORED',
    toState: 'RENDERING_CLIPS',
  });

  const mediaAsset = await db('media_assets').where({ id: mediaAssetId }).first();
  const transcript = await transcriptRepository.findByMediaAssetId(mediaAssetId);
  const transcriptSegments = transcript ? await transcriptRepository.findSegments(transcript.id) : [];
  const normalizedSegments = transcriptSegments.map((s) => ({
    startMs: s.start_ms,
    endMs: s.end_ms,
    text: s.text,
  }));

  const clipCandidates = await db('clip_candidates').whereIn('id', clipCandidateIds);

  const outcomes = await mapWithConcurrency(
    clipCandidates,
    config.limits.clipRenderConcurrencyPerJob,
    (clipCandidate) => clipRenderService.renderClip({ mediaAsset, transcriptSegments: normalizedSegments, clipCandidate }),
  );

  let successCount = 0;
  const failures = [];
  outcomes.forEach((outcome, i) => {
    if (outcome.status === 'fulfilled') {
      successCount += 1;
    } else {
      const clipCandidate = clipCandidates[i];
      failures.push({ clipCandidateId: clipCandidate.id, message: outcome.reason.message });
      logger.error({ processingJobId, clipCandidateId: clipCandidate.id, err: outcome.reason.message }, 'clip render failed');
    }
  });

  if (successCount === 0 && clipCandidates.length > 0) {
    await processingJobRepository.transitionState(processingJobId, {
      fromState: 'RENDERING_CLIPS',
      toState: 'FAILED',
      failureStage: 'RENDERING_CLIPS',
      errorMessage: 'All clip renders failed',
      metadata: { failures },
    });
    return;
  }

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'RENDERING_CLIPS',
    toState: 'CLIPS_RENDERED',
    progressPercent: 80,
    metadata: { successCount, failedCount: failures.length },
  });

  await getQueue(QUEUE_NAMES.CONTENT_GENERATE).add(
    'content.generate',
    { processingJobId, mediaAssetId },
    { ...RETRY_CONFIG[QUEUE_NAMES.CONTENT_GENERATE], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, successCount, failedCount: failures.length }, 'clip.render completed');
}

module.exports = processClipRender;
module.exports.mapWithConcurrency = mapWithConcurrency;
