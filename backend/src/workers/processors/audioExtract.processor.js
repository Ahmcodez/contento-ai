const path = require('path');
const config = require('../../config');
const logger = require('../../logger');
const db = require('../../db/client');
const processingJobRepository = require('../../repositories/processingJob.repository');
const { getStorageDriver } = require('../../storage');
const mediaProcessor = require('../../media/MediaProcessor');
const { MediaProcessorError } = mediaProcessor;
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

async function processAudioExtract(job) {
  const { processingJobId, mediaAssetId } = job.data;
  const storageDriver = getStorageDriver();

  const mediaAsset = await db('media_assets').where({ id: mediaAssetId }).first();
  if (!mediaAsset) {
    throw new Error(`media_assets row not found for id ${mediaAssetId}`);
  }

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'VALIDATED',
    toState: 'EXTRACTING_AUDIO',
  });

  const inputPath = await storageDriver.getAbsolutePath(mediaAsset.storage_key);
  const audioKey = mediaAsset.storage_key.replace(path.extname(mediaAsset.storage_key), '.audio.wav');

  const tmpOutputPath = path.join(config.storage.tmpPath, `${mediaAssetId}.wav`);
  try {
    await mediaProcessor.extractAudio(inputPath, tmpOutputPath);
  } catch (err) {
    if (err instanceof MediaProcessorError && !err.retryable) {
      await processingJobRepository.transitionState(processingJobId, {
        fromState: 'EXTRACTING_AUDIO',
        toState: 'FAILED',
        failureStage: 'EXTRACTING_AUDIO',
        errorMessage: err.message,
      });
      logger.warn({ processingJobId, mediaAssetId, reason: err.reason }, 'ffmpeg/ffprobe not configured, job failed cleanly');
      return;
    }
    throw err; // retryable — let BullMQ's backoff/retry handle it
  }
  await storageDriver.saveFromPath(audioKey, tmpOutputPath);

  await db('media_assets').where({ id: mediaAssetId }).update({ updated_at: db.fn.now() });

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'EXTRACTING_AUDIO',
    toState: 'AUDIO_EXTRACTED',
    progressPercent: 30,
    metadata: { audioStorageKey: audioKey },
  });

  await getQueue(QUEUE_NAMES.TRANSCRIPTION_PROCESS).add(
    'transcription.process',
    { processingJobId, mediaAssetId, audioStorageKey: audioKey },
    { ...RETRY_CONFIG[QUEUE_NAMES.TRANSCRIPTION_PROCESS], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, mediaAssetId }, 'audio.extract completed');
}

module.exports = processAudioExtract;
