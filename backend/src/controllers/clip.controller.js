const clipViewService = require('../services/clipView.service');
const clipPlaybackService = require('../services/clipPlayback.service');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../logger');
const metrics = require('../metrics');

const download = asyncHandler(async (req, res) => {
  const { stream, filename } = await clipViewService.getClipDownloadStream(req.user.id, req.params.clipCandidateId);

  stream.on('error', (err) => {
    metrics.increment('storage_error', { operation: 'getReadStream' });
    logger.error({ err: err.message, clipCandidateId: req.params.clipCandidateId }, 'clip download stream error');
    if (!res.headersSent) {
      res.status(500).json({ error: { code: 'DOWNLOAD_FAILED', message: 'Could not read the clip file' } });
    } else {
      res.destroy();
    }
  });

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'video/mp4');
  stream.pipe(res);
});

const playback = asyncHandler(async (req, res) => {
  res.status(200).json(await clipPlaybackService.createPlayback(req.user.id, req.params.clipCandidateId));
});

/** Writes a media response (video or poster) from an openStream/openThumbnail result. */
function sendMedia(req, res, result, { cache }) {
  // The app and the API are different origins; helmet's default same-origin policy would
  // stop the browser from loading this into a <video> or <img> on the app's page.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  if (result.status === 416) {
    res.status(416).setHeader('Content-Range', `bytes */${result.size}`);
    return res.end();
  }

  res.status(result.status);
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Length', String(result.contentLength));
  res.setHeader('Cache-Control', cache);
  if (result.contentRange) res.setHeader('Content-Range', result.contentRange);

  if (req.method === 'HEAD') {
    result.stream.destroy();
    return res.end();
  }

  result.stream.on('error', (err) => {
    metrics.increment('storage_error', { operation: 'getReadStream' });
    logger.error({ err: err.message, clipCandidateId: req.params.clipCandidateId }, 'clip stream error');
    res.destroy();
  });
  // A viewer who seeks or leaves closes the connection; stop reading the file when they do.
  res.on('close', () => result.stream.destroy());
  return result.stream.pipe(res);
}

const stream = asyncHandler(async (req, res) => {
  const result = await clipPlaybackService.openStream(req.params.clipCandidateId, req.query.t, req.headers.range);
  if (result.status === 416) return sendMedia(req, res, result, {});
  return sendMedia(req, res, result, { cache: 'private, max-age=3600' });
});

const thumbnail = asyncHandler(async (req, res) => {
  const result = await clipPlaybackService.openThumbnail(req.params.clipCandidateId, req.query.t);
  return sendMedia(req, res, result, { cache: 'private, max-age=3600' });
});

module.exports = { download, playback, stream, thumbnail };
