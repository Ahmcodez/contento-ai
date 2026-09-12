/**
 * URLProvider — abstraction over "a video that lives at some URL", the
 * URL-import equivalent of StorageDriver (src/storage/StorageDriver.js)
 * and TranscriptionProvider (src/transcription/TranscriptionProvider.js).
 * Every provider (Direct, YouTube, Vimeo, TikTok, Dropbox, ...) sits
 * behind this exact same interface so ProviderResolver and the rest of
 * the ingestion pipeline never branch on which provider they're talking
 * to — adding a new source is "write a class implementing this
 * interface and register it in ProviderResolver.js", never a new
 * conditional somewhere else in the codebase.
 */
class URLProvider {
  /* eslint-disable no-unused-vars */

  /** Provider identifier stored in media_imports.provider / media_assets.source_provider. */
  get name() {
    throw new Error('URLProvider.name not implemented');
  }

  /** Synchronous, cheap: pattern-match the URL only, no network access. */
  canHandle(url) {
    throw new Error('URLProvider.canHandle not implemented');
  }

  /**
   * Fetches a lightweight preview without downloading the media itself.
   * Returns { sourceId, title, thumbnailUrl, durationSeconds, width, height }
   * — any field the provider can't determine cheaply is null, never
   * guessed. Called from the FETCHING_METADATA stage, before the user
   * has confirmed anything.
   */
  async getMetadata(url) {
    throw new Error('URLProvider.getMetadata not implemented');
  }

  /**
   * Downloads the media to destPath. Returns
   * { filePath, sizeBytes, durationSeconds, width, height } — providers
   * that can determine duration/dimensions more accurately at download
   * time than at metadata time (e.g. yt-dlp reporting the actual chosen
   * format) should return the more accurate values here; the caller
   * (urlImportDownload.processor.js) still runs ffprobe independently
   * before trusting anything, exactly as the plain upload path never
   * trusts a client-reported duration.
   */
  async download(url, destPath, { maxBytes, onProgress } = {}) {
    throw new Error('URLProvider.download not implemented');
  }

  /* eslint-enable no-unused-vars */
}

/**
 * Thrown by any provider for a source-specific, user-facing failure
 * (private video, unsupported URL shape, authentication required, ...).
 * Mirrors TranscriptionProviderError / MediaProcessorError's
 * retryable-flag pattern: a private/DRM-restricted video won't become
 * downloadable on retry, so callers check `.retryable` and fail the
 * import immediately instead of burning through BullMQ's retry/backoff
 * on something retrying can never fix.
 */
class ProviderError extends Error {
  constructor(message, { retryable = false, reason = 'unknown', statusCode = 422 } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

/**
 * Shared hostname-allowlist matcher used by every yt-dlp-backed provider
 * (YouTube/Vimeo/TikTok/Dropbox). Deliberately an exact-hostname
 * allowlist, not a substring/regex match on the full URL — checking
 * `url.includes('youtube.com')` would also match
 * `https://evil.com/?redirect=youtube.com` or
 * `https://youtube.com.evil.com/`, both of which would then hand an
 * attacker-controlled URL to the yt-dlp subprocess. Comparing
 * `new URL(url).hostname` against an exact list closes that.
 */
function matchesHost(url, allowedHosts) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return allowedHosts.includes(parsed.hostname.toLowerCase());
}

module.exports = { URLProvider, ProviderError, matchesHost };
