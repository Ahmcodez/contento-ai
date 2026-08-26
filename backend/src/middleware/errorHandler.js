const AppError = require('../utils/AppError');
const logger = require('../logger');
const metrics = require('../metrics');

function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;

  // Errors thrown by Express/body-parser itself (e.g. payload-too-large,
  // malformed JSON) aren't AppError instances but do carry a real,
  // meaningful HTTP status — trust that instead of collapsing everything
  // unrecognized into a 500.
  const expressStatus = !isAppError && Number.isInteger(err.status || err.statusCode)
    ? (err.status || err.statusCode)
    : null;

  const statusCode = isAppError ? err.statusCode : expressStatus || 500;
  const code = isAppError ? err.code : expressStatus ? 'BAD_REQUEST' : 'INTERNAL_ERROR';
  const message = isAppError
    ? err.message
    : expressStatus
      ? err.message || 'Request could not be processed'
      : 'Internal server error';

  // Full detail (stack trace, provider payloads) is logged server-side
  // only — never returned to the client.
  const logPayload = { err, statusCode, code, requestId: req.id };
  if (statusCode >= 500) {
    logger.error(logPayload, 'Unhandled error');
  } else {
    logger.warn(logPayload, 'Request error');
  }
  metrics.increment('api_error', { statusCode, code });

  const body = { error: { code, message } };
  if (isAppError && err.detail && statusCode < 500) {
    body.error.details = err.detail;
  }

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
