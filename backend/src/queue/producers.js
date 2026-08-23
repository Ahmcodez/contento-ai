const { QUEUE_NAMES, RETRY_CONFIG, getQueue } = require('./queues');

/**
 * Enqueues the first pipeline job (video.validate) for a newly uploaded
 * media asset. Every subsequent stage is enqueued by the processor that
 * completes the prior stage (see src/workers/processors) — the API only
 * ever kicks off the first hop.
 */
async function enqueueVideoValidate({ processingJobId, mediaAssetId }) {
  const queue = getQueue(QUEUE_NAMES.VIDEO_VALIDATE);
  return queue.add(
    'video.validate',
    { processingJobId, mediaAssetId },
    { ...RETRY_CONFIG[QUEUE_NAMES.VIDEO_VALIDATE], removeOnComplete: 100, removeOnFail: 500 },
  );
}

module.exports = { enqueueVideoValidate };
