const clipViewService = require('../services/clipView.service');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../logger');

const download = asyncHandler(async (req, res) => {
  const { stream, filename } = await clipViewService.getClipDownloadStream(req.user.id, req.params.clipCandidateId);

  stream.on('error', (err) => {
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

module.exports = { download };
