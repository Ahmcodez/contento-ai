const logger = require('../../logger');
const processingJobRepository = require('../../repositories/processingJob.repository');
const { getAIProvider } = require('../../ai');
const { AIProviderError } = require('../../ai/AIProvider');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

async function processContentAnalyze(job) {
  const { processingJobId, mediaAssetId, fullText } = job.data;

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'TRANSCRIBED',
    toState: 'ANALYZING',
  });

  const provider = getAIProvider();

  let analysis;
  try {
    analysis = await provider.analyzeContent({ transcript: fullText });
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

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'ANALYZING',
    toState: 'ANALYZED',
    progressPercent: 55,
    metadata: { topicCount: analysis.topics?.length || 0 },
  });

  await getQueue(QUEUE_NAMES.CLIPS_DETECT).add(
    'clips.detect',
    { processingJobId, mediaAssetId, fullText, analysis },
    { ...RETRY_CONFIG[QUEUE_NAMES.CLIPS_DETECT], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, mediaAssetId }, 'content.analyze completed');
}

module.exports = processContentAnalyze;
