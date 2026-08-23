const AppError = require('../utils/AppError');
const logger = require('../logger');

function notFoundHandler(req, res, next) {
  next(AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';
  const message = isAppError ? err.message : 'Internal server error';

  // Full detail (stack trace, provider payloads) is logged server-side
  // only — never returned to the client.
  const logPayload = { err, statusCode, code, requestId: req.id };
  if (statusCode >= 500) {
    logger.error(logPayload, 'Unhandled error');
  } else {
    logger.warn(logPayload, 'Request error');
  }

  const body = { error: { code, message } };
  if (isAppError && err.detail && statusCode < 500) {
    body.error.details = err.detail;
  }

  res.status(statusCode).json(body);
}

module.exports = { notFoundHandler, errorHandler };
