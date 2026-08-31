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
function requireAdminKey(req, res, next) {
  if (!config.adminApiKey) {
    return next(AppError.notFound());
  }
  const provided = req.get('x-admin-key');
  if (!provided || provided !== config.adminApiKey) {
    return next(AppError.unauthorized());
  }
  return next();
}

module.exports = requireAdminKey;
