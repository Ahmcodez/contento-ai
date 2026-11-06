const logger = require('../logger');
const metrics = require('../metrics');

/**
 * Writes a media response from a { status, size, contentLength, contentType, contentRange?, stream }
 * result (see parseByteRange for the Range side): 200, 206 or 416, HEAD without a body, and the
 * stream closed as soon as the viewer goes away. Shared by clip playback and the public downloader.
 *
 * `crossOrigin` sends Cross-Origin-Resource-Policy: cross-origin. The app and the API are different
 * origins, and helmet's default same-origin policy would stop a <video> or <img> on the app's
 * page from loading the file. `disposition` (optional) is a ready-made Content-Disposition value.
 */
function sendMedia(req, res, result, { cache, disposition, logContext = {} }) {
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
  if (disposition) res.setHeader('Content-Disposition', disposition);
  if (result.contentRange) res.setHeader('Content-Range', result.contentRange);

  if (req.method === 'HEAD') {
    result.stream.destroy();
    return res.end();
  }

  result.stream.on('error', (err) => {
    metrics.increment('storage_error', { operation: 'getReadStream' });
    logger.error({ err: err.message, ...logContext }, 'media stream error');
    res.destroy();
  });
  res.on('close', () => result.stream.destroy());
  return result.stream.pipe(res);
}

module.exports = { sendMedia };
