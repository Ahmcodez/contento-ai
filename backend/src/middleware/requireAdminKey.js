const crypto = require('crypto');
const config = require('../config');
const AppError = require('../utils/AppError');

/**
 * Gates every /api/v1/admin/* route. Two distinct failure modes on
 * purpose:
 *  - No ADMIN_API_KEY configured at all -> 404, as if the route doesn't
 *    exist. Never falls back to "open" just because nothing was set.
 *  - A key is configured but the request's X-Admin-Key header doesn't
 *    match -> 401, same generic shape as the rest of the API's auth
 *    failures (no hint about which check failed).
 */
/**
 * Constant-time comparison. Both sides are hashed first so the buffers are always
 * the same length (timingSafeEqual throws on unequal lengths, and checking length
 * first would leak it), and a plain !== would leak how many leading characters
 * of a guess were right.
 */
function keysMatch(provided, expected) {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireAdminKey(req, res, next) {
  if (!config.adminApiKey) {
    return next(AppError.notFound());
  }
  const provided = req.get('x-admin-key');
  if (!provided || !keysMatch(provided, config.adminApiKey)) {
    return next(AppError.unauthorized());
  }
  return next();
}

module.exports = requireAdminKey;
