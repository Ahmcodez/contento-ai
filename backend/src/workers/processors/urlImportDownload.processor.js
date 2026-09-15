const fs = require('fs/promises');
const path = require('path');
const config = require('../../config');
const db = require('../../db/client');
const logger = require('../../logger');
const mediaImportRepository = require('../../repositories/mediaImport.repository');
const { getProviderByName, resolveProvider } = require('../../providers/ProviderResolver');
const { ProviderError } = require('../../providers/URLProvider');
const mediaService = require('../../services/media.service');
const AppError = require('../../utils/AppError');

/**
 * DOWNLOADING -> VALIDATING_MEDIA -> COMPLETED|FAILED. Runs only after
 * the user has clicked Import & Analyze (see urlImport.service.js's
 * confirmImport, which is what transitions a media_import to DOWNLOADING
 * and enqueues this job) — never before, per the spec's "no expensive
 * processing before confirmation" requirement.
 *
 * The one job of this processor is: get the source video safely onto
 * local disk (every provider already enforces SSRF-safety/hostname-
 * allowlisting/size-capping — see ssrfSafeFetch.js and YtDlpRunner.js),
 * then hand off to createMediaAssetFromLocalFile
 * (src/services/media.service.js) — the exact same function the plain
 * upload path calls. From that handoff onward there is no URL-import-
 * specific code left in the pipeline at all: real content-type
 * sniffing, checksum dedup, storage, media_assets/processing_jobs
 * creation, and enqueueing video.validate are 100% shared with upload.
 */
module.exports = async function processUrlImportDownload(job) {
  const { mediaImportId } = job.data;
  const mediaImport = await db('media_imports').where({ id: mediaImportId }).first();
  if (!mediaImport) return; // deleted/cancelled before the job ran
  if (mediaImport.state !== 'DOWNLOADING') {
    logger.warn({ mediaImportId, state: mediaImport.state }, 'url-import-download job skipped: not in DOWNLOADING state');
    return;
  }

  const provider = getProviderByName(mediaImport.provider) || resolveProvider(mediaImport.source_url);
  const maxBytes = config.limits.maxUploadSizeMb * 1024 * 1024;
  const requestedPath = path.join(config.storage.tmpPath, `import-${mediaImportId}.mp4`);
  // The file actually used from here on — starts as our best guess
  // (correct for DirectMediaProvider, which always writes to exactly
  // the given path) but is overwritten with provider.download()'s
  // *returned* filePath once we have it, since yt-dlp-backed providers
  // don't guarantee the final post-merge file lands at the requested
  // path (see the doc comment on YtDlpRunner.downloadTo). Cleanup and
  // the createMediaAssetFromLocalFile handoff both use whichever path
  // is actually correct at that point, never the original guess.
  let actualPath = requestedPath;

  const cleanupTmp = async () => {
    await fs.rm(actualPath, { force: true }).catch(() => {});
    if (actualPath !== requestedPath) {
      await fs.rm(requestedPath, { force: true }).catch(() => {});
    }
    await fs.rm(`${requestedPath}.part`, { force: true }).catch(() => {}); // yt-dlp leaves a .part file on interruption
  };

  try {
    await fs.mkdir(config.storage.tmpPath, { recursive: true });
    const downloadResult = await provider.download(mediaImport.source_url, requestedPath, { maxBytes });
    actualPath = downloadResult?.filePath || requestedPath;
  } catch (err) {
    await cleanupTmp();
    if (err instanceof ProviderError && !err.retryable) {
      await mediaImportRepository.transitionState(mediaImportId, {
        fromState: 'DOWNLOADING',
        toState: 'FAILED',
        failureStage: 'DOWNLOADING',
        errorMessage: err.message,
      });
      return;
    }
    throw err; // retryable — let BullMQ's backoff/retry handle it
  }

  await mediaImportRepository.transitionState(mediaImportId, {
    fromState: 'DOWNLOADING',
    toState: 'VALIDATING_MEDIA',
    progressPercent: 90,
  });

  try {
    const { mediaAsset, processingJob } = await mediaService.createMediaAssetFromLocalFile(
      mediaImport.project_id,
      mediaImport.requested_by,
      actualPath,
      {
        displayName: mediaImport.title || `${mediaImport.provider || 'video'}-import`,
        sourceMetadata: {
          provider: mediaImport.provider,
          sourceUrl: mediaImport.source_url,
          sourceId: mediaImport.source_id,
          title: mediaImport.title,
        },
      },
    );

    await mediaImportRepository.transitionState(mediaImportId, {
      fromState: 'VALIDATING_MEDIA',
      toState: 'COMPLETED',
      progressPercent: 100,
      extra: { media_asset_id: mediaAsset.id, processing_job_id: processingJob.id },
    });
  } catch (err) {
    // AppError here (unsupported content, duplicate, project gone) is a
    // deliberate rejection of this specific download — retrying without
    // the source content changing won't help, so it's terminal, exactly
    // like an equivalent upload rejection is terminal rather than
    // retried. Anything else (e.g. a transient DB/storage error) is
    // retryable.
    if (err instanceof AppError) {
      await mediaImportRepository.transitionState(mediaImportId, {
        fromState: 'VALIDATING_MEDIA',
        toState: 'FAILED',
        failureStage: 'VALIDATING_MEDIA',
        errorMessage: err.message,
      });
      return;
    }
    throw err;
  } finally {
    await cleanupTmp();
  }
};
