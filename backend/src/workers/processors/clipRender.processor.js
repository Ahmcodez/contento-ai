const logger = require('../../logger');
const db = require('../../db/client');
const processingJobRepository = require('../../repositories/processingJob.repository');
const transcriptRepository = require('../../repositories/transcript.repository');
const clipRenderService = require('../../services/clipRender.service');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

/**
 * Renders every clip candidate for this job, sequentially (bounds
 * concurrent FFmpeg processes per job — docs/COST.md §4, docs/QUEUE.md
 * §5). A single clip failing to render does not fail the whole stage
 * (docs/PIPELINE.md §3.8) — each render is independently caught and
 * recorded, and the stage only fails outright if every clip fails.
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

  let successCount = 0;
  const failures = [];

  for (const clipCandidate of clipCandidates) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await clipRenderService.renderClip({ mediaAsset, transcriptSegments: normalizedSegments, clipCandidate });
      successCount += 1;
    } catch (err) {
      failures.push({ clipCandidateId: clipCandidate.id, message: err.message });
      logger.error({ processingJobId, clipCandidateId: clipCandidate.id, err: err.message }, 'clip render failed');
    }
  }

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
