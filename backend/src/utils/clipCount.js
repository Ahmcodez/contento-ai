const config = require('../config');
const AppError = require('./AppError');

/**
 * The number of clips a user asked for, validated against the configured cap.
 * Missing/empty means "use the default", so every caller (upload form field,
 * URL-import body, older clients that send nothing) gets one consistent rule.
 * Accepts numbers or numeric strings, because multipart form fields arrive as
 * strings.
 */
function resolveClipCount(raw) {
  const { defaultClipsPerVideo, maxClipsPerVideo } = config.limits;

  if (raw === undefined || raw === null || raw === '') {
    return Math.min(defaultClipsPerVideo, maxClipsPerVideo);
  }

  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isInteger(n) || n < 1 || n > maxClipsPerVideo) {
    throw AppError.badRequest(`Choose between 1 and ${maxClipsPerVideo} clips`, 'INVALID_CLIP_COUNT');
  }
  return n;
}

module.exports = { resolveClipCount };
