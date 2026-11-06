const clipViewService = require('../services/clipView.service');
const clipPlaybackService = require('../services/clipPlayback.service');
const asyncHandler = require('../utils/asyncHandler');
const { sendMedia: sendMediaResponse } = require('../utils/sendMedia');
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

// Playback links carry their own authorization; the media itself is private to the viewer.
const sendMedia = (req, res, result, { cache }) =>
  sendMediaResponse(req, res, result, { cache, logContext: { clipCandidateId: req.params.clipCandidateId } });

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
