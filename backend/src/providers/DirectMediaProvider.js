const path = require('path');
const { URLProvider, ProviderError } = require('./URLProvider');
const ssrfFetch = require('../security/ssrfSafeFetch');
const { SsrfBlockedError } = ssrfFetch;
const { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } = require('../validation/uploadSchemas');
const { sanitizeDisplayFilename } = require('../utils/sanitize');

/**
 * Handles plain direct-media URLs (a CDN link, a signed download URL,
 * an S3 object URL, etc. ending in a supported video extension) —
 * deliberately the *last* provider ProviderResolver tries, since it's
 * also the most permissive canHandle match. Uses the same
 * ALLOWED_MIME_TYPES/ALLOWED_EXTENSIONS the upload flow enforces, so a
 * pasted URL and an uploaded file are held to the identical format
 * allowlist.
 *
 * Needs no external binary (no yt-dlp) — every request goes through
 * ssrfSafeFetch, which is where the actual security properties (SSRF
 * protection, redirect re-validation, size/time limits) live.
 */
class DirectMediaProvider extends URLProvider {
  get name() {
    return 'direct';
  }

  canHandle(url) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const ext = path.extname(parsed.pathname).toLowerCase();
    return ALLOWED_EXTENSIONS.has(ext);
  }

  async getMetadata(url) {
    let head;
    try {
      head = await ssrfFetch.fetchHeaders(url, { timeoutMs: 10000 });
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new ProviderError(err.message, { retryable: false, reason: err.reason, statusCode: 422 });
      }
      throw new ProviderError(`Could not reach the URL: ${err.message}`, { retryable: true, reason: 'network_error' });
    }

    if (head.statusCode >= 400) {
      throw new ProviderError(
        head.statusCode === 404 ? 'The URL does not point to an existing file (404)' : `The server returned HTTP ${head.statusCode} for this URL`,
        { retryable: false, reason: 'unreachable', statusCode: 422 },
      );
    }

    const contentType = (head.headers['content-type'] || '').split(';')[0].trim();
    if (contentType && !ALLOWED_MIME_TYPES.has(contentType)) {
      throw new ProviderError(
        `The URL's content type ("${contentType}") is not a supported video format`,
        { retryable: false, reason: 'unsupported_media_type', statusCode: 415 },
      );
    }
    // Some servers omit or misreport Content-Type on a HEAD request
    // (common for CDNs configured for GET-only). Absence isn't treated
    // as a rejection here — the real, trustworthy content check
    // (detectVideoContainer, sniffing actual bytes) runs after download,
    // exactly like the upload flow never trusts the client-declared
    // Content-Type either.

    const sizeBytes = Number(head.headers['content-length']);

    return {
      sourceId: null,
      title: sanitizeDisplayFilename(decodeURIComponent(path.basename(new URL(head.finalUrl).pathname)) || 'video'),
      thumbnailUrl: null,
      durationSeconds: null, // unknown until the file is actually downloaded and probed
      width: null,
      height: null,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : null,
    };
  }

  async download(url, destPath, { maxBytes } = {}) {
    try {
      const result = await ssrfFetch.downloadToFile(url, destPath, { maxBytes, timeoutMs: 10 * 60 * 1000 });
      return { filePath: destPath, sizeBytes: result.bytesWritten, durationSeconds: null, width: null, height: null };
    } catch (err) {
      if (err instanceof SsrfBlockedError) {
        throw new ProviderError(err.message, { retryable: err.reason === 'timeout', reason: err.reason, statusCode: 422 });
      }
      throw err;
    }
  }
}

module.exports = DirectMediaProvider;
