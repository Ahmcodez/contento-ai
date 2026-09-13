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

/**
 * Enqueues provider detection + metadata preview for a just-created
 * media_imports row (state DETECTING_PROVIDER) — the URL-import
 * equivalent of enqueueVideoValidate, kicked off right after the user
 * pastes a URL. See urlImportResolve.processor.js.
 */
async function enqueueUrlImportResolve({ mediaImportId }) {
  const queue = getQueue(QUEUE_NAMES.URL_IMPORT_RESOLVE);
  return queue.add(
    'url-import.resolve',
    { mediaImportId },
    { ...RETRY_CONFIG[QUEUE_NAMES.URL_IMPORT_RESOLVE], removeOnComplete: 100, removeOnFail: 500 },
  );
}

/**
 * Enqueues the actual download, only ever called after the user has
 * confirmed a WAITING_CONFIRMATION preview (see urlImport.service.js's
 * confirmImport). See urlImportDownload.processor.js.
 */
async function enqueueUrlImportDownload({ mediaImportId }) {
  const queue = getQueue(QUEUE_NAMES.URL_IMPORT_DOWNLOAD);
  return queue.add(
    'url-import.download',
    { mediaImportId },
    { ...RETRY_CONFIG[QUEUE_NAMES.URL_IMPORT_DOWNLOAD], removeOnComplete: 100, removeOnFail: 500 },
  );
}

module.exports = { enqueueVideoValidate, enqueueUrlImportResolve, enqueueUrlImportDownload };
