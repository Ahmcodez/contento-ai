const crypto = require('crypto');
const config = require('../../config');
const AppError = require('../../utils/AppError');
const { getStorageDriver } = require('../../storage');
const { parseByteRange } = require('../../utils/byteRange');
const { resolveProvider } = require('../../providers/ProviderResolver');
const { ProviderError } = require('../../providers/URLProvider');
const ytdlpRunner = require('../../providers/YtDlpRunner');
const { QUEUE_NAMES, RETRY_CONFIG, getQueue, getPhysicalQueue, PHYSICAL_QUEUES } = require('../../queue/queues');
const store = require('./jobStore');
const { buildOptions, parseOptionId } = require('./options');
const { contentDisposition } = require('./filename');
const { messageFor } = require('./messages');

const settings = () => config.tools.downloader;

// Sites the public tool will fetch from. A strict allowlist: a no-login endpoint that fetches
// arbitrary URLs would be an open proxy, so nothing outside this list is ever contacted.
const TOOL_PROVIDERS = new Set(['youtube', 'vimeo', 'tiktok', 'facebook', 'instagram', 'twitter', 'dailymotion', 'reddit']);
const SUPPORTED_LABEL = 'YouTube, TikTok, Vimeo, Facebook, Instagram, X (Twitter), Dailymotion and Reddit';
const MAX_URL_LENGTH = 2048;

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
/** Visitors are identified by a hash of their IP, so the raw address is never stored with a download. */
const visitorKey = (ip) => sha(`tool-visitor:${ip}`).slice(0, 32);

/**
 * ProviderError (extractor/site problems) becomes a clean 4xx the page can show, in wording written for
 * visitors. A server-side setup problem (yt-dlp missing) is a 503 and never describes the setup.
 */
function toAppError(err) {
  if (err instanceof ProviderError) {
    const status = err.reason === 'not_configured' ? 503 : err.statusCode || 422;
    return new AppError(String(err.reason || 'download_failed').toUpperCase(), messageFor(err.reason), status);
  }
  return err;
}

function assertEnabled() {
  if (!settings().enabled) {
    throw new AppError('TOOL_DISABLED', 'The video downloader is temporarily unavailable. Please try again later.', 503);
  }
}

function assertSupportedUrl(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url || url.length > MAX_URL_LENGTH) throw AppError.badRequest('Paste a valid video link', 'INVALID_URL');

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw AppError.badRequest('That doesn\u2019t look like a link. Paste the full address of the video.', 'INVALID_URL');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw AppError.badRequest('Only http and https links are supported', 'INVALID_URL');

  // YouTube Music is a commercial music catalogue; it is deliberately not offered here.
  if (parsed.hostname.toLowerCase() === 'music.youtube.com') {
    throw new AppError('UNSUPPORTED_SOURCE', 'YouTube Music links are not supported. Try a regular YouTube video link.', 422);
  }

  // The shared resolver also knows Dropbox and direct file links; this tool only offers the sites below,
  // and says so in its own words (the resolver's message lists sources it won't accept here).
  let provider = null;
  try {
    provider = resolveProvider(url);
  } catch {
    provider = null;
  }
  if (!provider || !TOOL_PROVIDERS.has(provider.name)) {
    throw new AppError('UNSUPPORTED_SOURCE', `This link isn\u2019t from a supported site. Supported: ${SUPPORTED_LABEL}.`, 422);
  }
  return { url, provider };
}

/** Looks the video up (cached for a few minutes) and applies the limits that make it downloadable here. */
async function lookup(url, provider) {
  const cacheKey = sha(url);
  const cached = await store.getCachedInfo(cacheKey);
  if (cached) return cached;

  let info;
  try {
    info = await ytdlpRunner.getMetadataJson(url);
  } catch (err) {
    throw toAppError(err);
  }

  if (info.is_live || info.live_status === 'is_live') {
    throw new AppError('LIVE_STREAM', 'Live streams can\u2019t be downloaded. Try again once the stream has ended and been published as a video.', 422);
  }
  const duration = typeof info.duration === 'number' ? info.duration : null;
  if (duration && duration > settings().maxDurationSeconds) {
    const minutes = Math.floor(settings().maxDurationSeconds / 60);
    throw new AppError('TOO_LONG', `This video is longer than the ${minutes}-minute limit for the free downloader.`, 422);
  }

  const result = {
    provider: provider.name,
    title: info.title || 'Video',
    thumbnailUrl: typeof info.thumbnail === 'string' && info.thumbnail.startsWith('https://') ? info.thumbnail : null,
    durationSeconds: duration,
    uploader: info.uploader || info.channel || null,
    options: buildOptions(info, { maxHeight: settings().maxHeight }),
  };
  await store.setCachedInfo(cacheKey, result);
  return result;
}

async function getInfo(rawUrl) {
  assertEnabled();
  const { url, provider } = assertSupportedUrl(rawUrl);
  return lookup(url, provider);
}

async function createDownload(rawUrl, optionId, ip) {
  assertEnabled();
  const { url, provider } = assertSupportedUrl(rawUrl);

  const option = parseOptionId(optionId, { maxHeight: settings().maxHeight });
  if (!option) throw AppError.badRequest('Choose one of the available formats', 'INVALID_OPTION');

  const visitor = visitorKey(ip);
  if ((await store.countActive(visitor)) >= settings().maxActivePerIp) {
    throw AppError.tooManyRequests('You already have downloads in progress. Wait for them to finish, then try again.');
  }
  const waiting = await getPhysicalQueue(PHYSICAL_QUEUES.TOOL).getWaitingCount();
  if (waiting >= settings().maxQueueDepth) {
    throw new AppError('BUSY', 'The downloader is very busy right now. Please try again in a minute.', 503);
  }

  const info = await lookup(url, provider);

  const id = crypto.randomBytes(16).toString('hex');
  await store.create({
    id,
    state: 'queued',
    url,
    provider: provider.name,
    title: info.title,
    mode: option.mode,
    maxHeight: option.maxHeight,
    optionLabel: option.mode === 'audio' ? 'MP3 · audio only' : `MP4 · ${option.maxHeight}p`,
    visitor,
    createdAt: Date.now(),
  });
  await store.addActive(visitor, id);

  await getQueue(QUEUE_NAMES.TOOL_DOWNLOAD).add(
    'tool.download',
    { id },
    { ...RETRY_CONFIG[QUEUE_NAMES.TOOL_DOWNLOAD], removeOnComplete: 20, removeOnFail: 100 },
  );
  return { id };
}

/** What the page may see: never the source URL, the storage key or the visitor hash. */
function publicView(job) {
  return {
    id: job.id,
    state: job.state,
    provider: job.provider,
    title: job.title,
    optionLabel: job.optionLabel,
    filename: job.state === 'ready' ? job.filename : null,
    sizeBytes: job.state === 'ready' ? job.sizeBytes : null,
    expiresAt: job.state === 'ready' && job.expiresAt ? new Date(job.expiresAt).toISOString() : null,
    error: job.state === 'failed' ? job.error : null,
  };
}

async function getStatus(id) {
  const job = await store.get(id);
  if (!job) throw AppError.notFound('This download was not found. It may have expired.', 'DOWNLOAD_NOT_FOUND');
  return publicView(job);
}

/** Opens the finished file for the visitor, honouring Range so browsers can resume and mobile players can seek. */
async function openFile(id, rangeHeader) {
  const job = await store.get(id);
  if (!job) throw AppError.notFound('This download was not found. It may have expired.', 'DOWNLOAD_NOT_FOUND');
  if (job.state === 'expired') throw new AppError('DOWNLOAD_EXPIRED', 'This download has expired. Start it again to get a fresh file.', 410);
  if (job.state !== 'ready') throw AppError.conflict('This file isn\u2019t ready yet', 'NOT_READY');
  if (job.expiresAt && job.expiresAt <= Date.now()) {
    throw new AppError('DOWNLOAD_EXPIRED', 'This download has expired. Start it again to get a fresh file.', 410);
  }

  const driver = getStorageDriver();
  const size = await driver.size(job.storageKey).catch(() => {
    throw new AppError('DOWNLOAD_EXPIRED', 'This download has expired. Start it again to get a fresh file.', 410);
  });

  const range = parseByteRange(rangeHeader, size);
  const base = { size, contentType: job.mime, disposition: contentDisposition(job.filename) };
  if (range === 'unsatisfiable') return { ...base, status: 416 };
  if (range === null) return { ...base, status: 200, contentLength: size, stream: await driver.getReadStream(job.storageKey) };
  return {
    ...base,
    status: 206,
    contentLength: range.end - range.start + 1,
    contentRange: `bytes ${range.start}-${range.end}/${size}`,
    stream: await driver.getReadStream(job.storageKey, range),
  };
}

module.exports = {
  getInfo,
  createDownload,
  getStatus,
  openFile,
  assertSupportedUrl,
  visitorKey,
  SUPPORTED_LABEL,
  TOOL_PROVIDERS,
};
