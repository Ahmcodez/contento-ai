const { URLProvider } = require('./URLProvider');
const ytdlpRunner = require('./YtDlpRunner');

/**
 * Shared implementation for every provider whose extraction strategy is
 * "hand the URL to yt-dlp" (YouTube, Vimeo, TikTok, Dropbox). Subclasses
 * only need to implement `name` and `canHandle` (a strict hostname
 * allowlist via matchesHost — see URLProvider.js); getMetadata/download
 * are identical across all of them because yt-dlp's output shape is
 * already normalized across the sites it supports.
 */
class YtDlpProvider extends URLProvider {
  async getMetadata(url) {
    const info = await ytdlpRunner.getMetadataJson(url);
    const sizeBytes = info.filesize || info.filesize_approx || null;
    return {
      sourceId: info.id || null,
      title: info.title || null,
      thumbnailUrl: info.thumbnail || null,
      durationSeconds: typeof info.duration === 'number' ? info.duration : null,
      width: typeof info.width === 'number' ? info.width : null,
      height: typeof info.height === 'number' ? info.height : null,
      sizeBytes: typeof sizeBytes === 'number' ? sizeBytes : null,
    };
  }

  async download(url, destPath, { maxBytes } = {}) {
    const result = await ytdlpRunner.downloadTo(url, destPath, { maxBytes });
    // yt-dlp doesn't hand back a clean final size/duration on stdout in
    // a way worth parsing here — the caller (urlImportDownload.processor.js)
    // runs ffprobe on the downloaded file regardless, exactly like the
    // upload flow, so these are left for that authoritative step rather
    // than duplicated/guessed here.
    return { filePath: result.filePath, sizeBytes: null, durationSeconds: null, width: null, height: null };
  }
}

module.exports = YtDlpProvider;
