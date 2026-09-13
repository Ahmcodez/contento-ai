const db = require('../../db/client');
const config = require('../../config');
const mediaImportRepository = require('../../repositories/mediaImport.repository');
const { resolveProvider } = require('../../providers/ProviderResolver');
const { ProviderError } = require('../../providers/URLProvider');

/**
 * DETECTING_PROVIDER -> FETCHING_METADATA -> WAITING_CONFIRMATION|FAILED.
 * This is the "show the user a preview before spending any real cost"
 * half of URL import — see urlImportDownload.processor.js for what
 * happens after the user clicks Import & Analyze. Never downloads the
 * media itself (every provider's getMetadata is documented to avoid
 * that); the only network/subprocess cost here is one HEAD request or
 * one `yt-dlp -J --skip-download` call.
 */
module.exports = async function processUrlImportResolve(job) {
  const { mediaImportId } = job.data;
  const mediaImport = await db('media_imports').where({ id: mediaImportId }).first();
  if (!mediaImport) return; // deleted/cancelled before the job ran

  let provider;
  try {
    provider = resolveProvider(mediaImport.source_url);
  } catch (err) {
    await mediaImportRepository.transitionState(mediaImportId, {
      fromState: 'DETECTING_PROVIDER',
      toState: 'FAILED',
      failureStage: 'DETECTING_PROVIDER',
      errorMessage: err.message,
    });
    return; // unsupported URL is never going to resolve on retry
  }

  await mediaImportRepository.transitionState(mediaImportId, {
    fromState: 'DETECTING_PROVIDER',
    toState: 'FETCHING_METADATA',
    progressPercent: 25,
    extra: { provider: provider.name },
  });

  let metadata;
  try {
    metadata = await provider.getMetadata(mediaImport.source_url);
  } catch (err) {
    if (err instanceof ProviderError && !err.retryable) {
      await mediaImportRepository.transitionState(mediaImportId, {
        fromState: 'FETCHING_METADATA',
        toState: 'FAILED',
        failureStage: 'FETCHING_METADATA',
        errorMessage: err.message,
      });
      return;
    }
    throw err; // retryable (network blip, subprocess timeout) — let BullMQ retry
  }

  // Reject outright, before ever showing a preview, if the duration is
  // already known and over the hard cap — matches the upload flow's
  // own ffprobe-time duration rejection, and spec's "duration check
  // before confirmation" ordering (per-user monthly-minutes quota is
  // checked again at actual confirm time in urlImport.service.js,
  // since that's a per-account limit that can change between preview
  // and confirmation, not a fixed system-wide ceiling like this one).
  if (metadata.durationSeconds && metadata.durationSeconds > config.limits.maxVideoDurationSeconds) {
    await mediaImportRepository.transitionState(mediaImportId, {
      fromState: 'FETCHING_METADATA',
      toState: 'FAILED',
      failureStage: 'FETCHING_METADATA',
      errorMessage: `This video is ${Math.round(metadata.durationSeconds / 60)} minutes long, which exceeds the ${Math.round(config.limits.maxVideoDurationSeconds / 60)}-minute limit.`,
    });
    return;
  }

  await mediaImportRepository.transitionState(mediaImportId, {
    fromState: 'FETCHING_METADATA',
    toState: 'WAITING_CONFIRMATION',
    progressPercent: 50,
    extra: {
      title: metadata.title,
      thumbnail_url: metadata.thumbnailUrl,
      duration_seconds: metadata.durationSeconds,
      width: metadata.width,
      height: metadata.height,
      source_id: metadata.sourceId,
    },
  });
};
