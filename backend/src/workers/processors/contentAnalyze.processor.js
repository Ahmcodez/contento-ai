const logger = require('../../logger');
const db = require('../../db/client');
const processingJobRepository = require('../../repositories/processingJob.repository');
const transcriptService = require('../../services/transcript.service');
const contentAnalysisService = require('../../services/contentAnalysis.service');
const { getAIProvider } = require('../../ai');
const { AIProviderError } = require('../../ai/AIProvider');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

async function processContentAnalyze(job) {
  const { processingJobId, mediaAssetId } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'TRANSCRIBED',
    toState: 'ANALYZING',
  });

  const mediaAsset = await db('media_assets').where({ id: mediaAssetId }).first();
  const userId = mediaAsset.uploaded_by;
  const transcript = await transcriptService.getNormalizedTranscript(mediaAssetId);
  const provider = getAIProvider();

  let analysis;
  try {
    analysis = await contentAnalysisService.analyzeTranscript({ provider, transcript, userId, processingJobId });
  } catch (err) {
    if (err instanceof AIProviderError && !err.retryable) {
      await processingJobRepository.transitionState(processingJobId, {
        fromState: 'ANALYZING',
        toState: 'FAILED',
        failureStage: 'ANALYZING',
        errorMessage: err.message,
      });
      logger.warn({ processingJobId, mediaAssetId, reason: err.reason }, 'AI provider not configured, job failed cleanly');
      return;
    }
    throw err;
  }

  await contentAnalysisService.persistAnalysis({ processingJobId, analysis, aiProvider: provider.constructor.name });

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'ANALYZING',
    toState: 'ANALYZED',
    progressPercent: 55,
    metadata: { topicCount: analysis.topics?.length || 0 },
  });

  // Written-content generation is chained after clip rendering rather
  // than run as a true parallel branch (docs/QUEUE.md §2 describes the
  // ideal fan-out) — both branches would otherwise race writes to the
  // same processing_jobs.state column. Sequential chaining keeps the
  // state machine race-free without needing a join/lock mechanism this
  // milestone doesn't need yet; clip.render enqueues content.generate
  // once it finishes.
  await getQueue(QUEUE_NAMES.CLIPS_DETECT).add(
    'clips.detect',
    { processingJobId, mediaAssetId },
    { ...RETRY_CONFIG[QUEUE_NAMES.CLIPS_DETECT], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, mediaAssetId }, 'content.analyze completed');
}

module.exports = processContentAnalyze;
