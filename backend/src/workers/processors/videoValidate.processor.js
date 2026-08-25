const config = require('../../config');
const logger = require('../../logger');
const db = require('../../db/client');
const mediaAssetRepository = require('../../repositories/mediaAsset.repository');
const processingJobRepository = require('../../repositories/processingJob.repository');
const { getStorageDriver } = require('../../storage');
const mediaProcessor = require('../../media/MediaProcessor');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('../../queue/queues');

/**
 * First real pipeline stage: probes the uploaded file with ffprobe and
 * enforces duration/size limits server-side (never trusting client-
 * reported values — docs/SECURITY.md §3). Deterministic: failures here
 * are not retried (see docs/PIPELINE.md §3.2).
 */
async function processVideoValidate(job) {
  const { processingJobId, mediaAssetId } = job.data;
  const storageDriver = getStorageDriver();

  const mediaAsset = await db('media_assets').where({ id: mediaAssetId }).first();
  if (!mediaAsset) {
    throw new Error(`media_assets row not found for id ${mediaAssetId}`);
  }

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'UPLOADED',
    toState: 'VALIDATING',
  });

  const absolutePath = await storageDriver.getAbsolutePath(mediaAsset.storage_key);
  const probeResult = await mediaProcessor.probe(absolutePath);

  if (!probeResult.durationSeconds) {
    await rejectAsset(processingJobId, mediaAssetId, 'Could not determine video duration — file may be corrupt');
    return;
  }

  if (probeResult.durationSeconds > config.limits.maxVideoDurationSeconds) {
    await rejectAsset(
      processingJobId,
      mediaAssetId,
      `Video exceeds the maximum allowed duration of ${Math.round(config.limits.maxVideoDurationSeconds / 60)} minutes`,
    );
    return;
  }

  if (!probeResult.hasAudio) {
    await rejectAsset(processingJobId, mediaAssetId, 'Video has no audio track — an audio track is required for transcription and content generation');
    return;
  }

  await mediaAssetRepository.updateById(mediaAssetId, {
    status: 'validated',
    duration_seconds: probeResult.durationSeconds,
  });

  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'VALIDATING',
    toState: 'VALIDATED',
    progressPercent: 15,
  });

  await getQueue(QUEUE_NAMES.AUDIO_EXTRACT).add(
    'audio.extract',
    { processingJobId, mediaAssetId },
    { ...RETRY_CONFIG[QUEUE_NAMES.AUDIO_EXTRACT], removeOnComplete: 100, removeOnFail: 500 },
  );

  logger.info({ processingJobId, mediaAssetId }, 'video.validate completed');
}

async function rejectAsset(processingJobId, mediaAssetId, reason) {
  await mediaAssetRepository.updateById(mediaAssetId, { status: 'rejected', rejection_reason: reason });
  await processingJobRepository.transitionState(processingJobId, {
    fromState: 'VALIDATING',
    toState: 'FAILED',
    failureStage: 'VALIDATING',
    errorMessage: reason,
  });
}

module.exports = processVideoValidate;
