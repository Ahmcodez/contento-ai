const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../logger');
const metrics = require('../../metrics');
const { getStorageDriver } = require('../../storage');
const { ProviderError } = require('../../providers/URLProvider');
const ytdlpRunner = require('../../providers/YtDlpRunner');
const store = require('../../tools/downloader/jobStore');
const { sanitizeFilename } = require('../../tools/downloader/filename');
const { messageFor, GENERIC } = require('../../tools/downloader/messages');

const MIME = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };

/**
 * Runs one public download: fetch with yt-dlp into a private temp folder, check the real size,
 * move the file into storage, and mark the job ready (or failed). It never throws for an
 * expected failure: the outcome is written to the job for the visitor to read, and a single
 * attempt means BullMQ would not retry it anyway. The temp folder is always removed.
 */
async function processToolDownload(job) {
  const { id } = job.data;
  const record = await store.get(id);
  if (!record || record.state !== 'queued') return; // gone or already handled

  await store.update(id, { state: 'downloading', startedAt: Date.now() });
  const settings = config.tools.downloader;
  const workDir = path.join(config.storage.tmpPath, 'tool-downloads', id);
  const startedAt = Date.now();

  try {
    const { filePath, ext } = await ytdlpRunner.downloadForTool(record.url, workDir, {
      mode: record.mode,
      maxHeight: record.maxHeight,
      maxBytes: settings.maxFilesizeBytes,
    });

    const sizeBytes = fs.statSync(filePath).size;
    if (sizeBytes > settings.maxFilesizeBytes) {
      const mb = Math.floor(settings.maxFilesizeBytes / (1024 * 1024));
      await store.update(id, { state: 'failed', error: `This file is larger than the ${mb} MB limit. Try a lower quality or audio only.` });
      return;
    }

    const storageKey = `tool-downloads/${id}/file${ext}`;
    await getStorageDriver().saveFromPath(storageKey, filePath);

    const expiresAt = Date.now() + settings.fileTtlSeconds * 1000;
    await store.update(id, {
      state: 'ready',
      storageKey,
      mime: MIME[ext] || 'application/octet-stream',
      filename: sanitizeFilename(record.title, ext),
      sizeBytes,
      expiresAt,
      error: null,
    });
    await store.scheduleExpiry(id, expiresAt);
    metrics.increment('tool_download_ready', { provider: record.provider, mode: record.mode });
    logger.info({ provider: record.provider, mode: record.mode, sizeBytes, durationMs: Date.now() - startedAt }, 'public download ready');
  } catch (err) {
    const message = err instanceof ProviderError ? messageFor(err.reason) : GENERIC;
    await store.update(id, { state: 'failed', error: message });
    metrics.increment('tool_download_failed', { provider: record.provider, reason: err.reason || 'unknown' });
    logger.warn({ provider: record.provider, reason: err.reason, err: err.message }, 'public download failed');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
    await store.removeActive(record.visitor, id).catch(() => {});
  }
}

module.exports = processToolDownload;
