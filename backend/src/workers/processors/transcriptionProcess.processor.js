const logger = require('../../logger');
const processingJobRepository = require('../../repositories/processingJob.repository');
const { getStorageDriver } = require('../../storage');
const { getTranscriptionProvider } = require('../../transcription');
const { TranscriptionProviderError } = require('../../transcription/TranscriptionProvider');
const transcriptService = require('../../services/transcript.service');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

async function processTranscription(job) {
  const { processingJobId, mediaAssetId, audioStorageKey } = job.data;
  const storageDriver = getStorageDriver();

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'AUDIO_EXTRACTED',
    toState: 'TRANSCRIBING',
  });

  const audioPath = await storageDriver.getAbsolutePath(audioStorageKey);
  const provider = getTranscriptionProvider();

  let result;
  try {
    result = await provider.transcribe(audioPath);
  } catch (err) {
    if (err instanceof TranscriptionProviderError && !err.retryable) {
      await processingJobRepository.transitionState(processingJobId, {
        fromState: 'TRANSCRIBING',
        toState: 'FAILED',
        failureStage: 'TRANSCRIBING',
        errorMessage: err.message,
      });
      logger.warn(
        { processingJobId, mediaAssetId, reason: err.reason },
        'transcription not configured, job failed cleanly',
      );
      return; // non-retryable, deliberately not rethrown
    }
    throw err; // retryable — let BullMQ's backoff/retry handle it
  }

  const providerName = provider.constructor.name;
  await transcriptService.persistTranscript({ mediaAssetId, rawResult: result, provider: providerName });

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'TRANSCRIBING',
    toState: 'TRANSCRIBED',
    progressPercent: 45,
    metadata: { language: result.language, segmentCount: result.segments.length },
  });

  await getQueue(QUEUE_NAMES.CONTENT_ANALYZE).add(
    'content.analyze',
    { processingJobId, mediaAssetId },
    { ...RETRY_CONFIG[QUEUE_NAMES.CONTENT_ANALYZE], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, mediaAssetId }, 'transcription.process completed');
}

module.exports = processTranscription;
