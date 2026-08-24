const logger = require('../../logger');
const db = require('../../db/client');
const processingJobRepository = require('../../repositories/processingJob.repository');
const contentAnalysisRepository = require('../../repositories/contentAnalysis.repository');
const transcriptService = require('../../services/transcript.service');
const contentGenerationService = require('../../services/contentGeneration.service');
const { getAIProvider } = require('../../ai');
const { AIProviderError } = require('../../ai/AIProvider');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

function rowToAnalysis(row) {
  return { summary: row.summary, topics: row.topics };
}

/**
 * Generates every written content type (blog, LinkedIn, X/Twitter,
 * Instagram caption, YouTube description) sequentially — bounded,
 * deterministic count (docs/COST.md: exactly
 * config.limits.maxGeneratedContentTypes fixed types, not user-arbitrary).
 * One type failing does not fail the whole stage.
 */
async function processContentGenerate(job) {
  const { processingJobId, mediaAssetId } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'CLIPS_RENDERED',
    toState: 'GENERATING_CONTENT',
  });

  const mediaAsset = await db('media_assets').where({ id: mediaAssetId }).first();
  const userId = mediaAsset.uploaded_by;
  const transcript = await transcriptService.getNormalizedTranscript(mediaAssetId);
  const analysisRow = await contentAnalysisRepository.findByProcessingJobId(processingJobId);
  const analysis = rowToAnalysis(analysisRow);
  const provider = getAIProvider();

  let succeeded = 0;
  const failures = [];

  for (const contentType of contentGenerationService.CONTENT_TYPES) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const { body, metadata } = await contentGenerationService.generateContent({
        provider,
        contentType,
        transcript,
        analysis,
        userId,
        processingJobId,
      });
      // eslint-disable-next-line no-await-in-loop
      await contentGenerationService.persistContent({
        processingJobId,
        contentType,
        body,
        metadata,
        aiProvider: provider.constructor.name,
      });
      succeeded += 1;
    } catch (err) {
      if (err instanceof AIProviderError && !err.retryable) {
        // Not configured — no point trying the remaining 4 content types
        // either, they'll fail identically.
        await processingJobRepository.transitionState(processingJobId, {
          fromState: 'GENERATING_CONTENT',
          toState: 'FAILED',
          failureStage: 'GENERATING_CONTENT',
          errorMessage: err.message,
        });
        logger.warn({ processingJobId, mediaAssetId, reason: err.reason }, 'AI provider not configured, job failed cleanly');
        return;
      }
      failures.push({ contentType, message: err.message });
      logger.error({ processingJobId, contentType, err: err.message }, 'content generation failed for one type');
    }
  }

  if (succeeded === 0) {
    await processingJobRepository.transitionState(processingJobId, {
      fromState: 'GENERATING_CONTENT',
      toState: 'FAILED',
      failureStage: 'GENERATING_CONTENT',
      errorMessage: 'All content generation attempts failed',
      metadata: { failures },
    });
    return;
  }

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'GENERATING_CONTENT',
    toState: 'CONTENT_GENERATED',
    progressPercent: 95,
    metadata: { succeeded, failedCount: failures.length },
  });

  await getQueue(QUEUE_NAMES.JOB_FINALIZE).add(
    'job.finalize',
    { processingJobId, mediaAssetId },
    { ...RETRY_CONFIG[QUEUE_NAMES.JOB_FINALIZE], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, succeeded, failedCount: failures.length }, 'content.generate completed');
}

module.exports = processContentGenerate;
