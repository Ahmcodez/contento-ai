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

  // Prefer the request-scoped logger (carries requestId, and userId once
  // authenticated — see middleware/auth.js) over the bare singleton, so
  // error logs have the same context every other request log line does.
  const log = req.log || logger;

  // Full detail (stack trace, provider payloads) is logged server-side
  // only — never returned to the client.
  const logPayload = { err, statusCode, code, requestId: req.id };
  if (statusCode >= 500) {
    log.error(logPayload, 'Unhandled error');
  } else {
    log.warn(logPayload, 'Request error');
  }
  metrics.increment('api_error', { statusCode, code });

  const body = { error: { code, message } };
  if (isAppError && err.detail && statusCode < 500) {
    body.error.details = err.detail;
  }

  res.status(statusCode).json(body);

  // If this request's body was never fully read — the common case being
  // requireAuth rejecting a large multipart upload before multer ever
  // gets a chance to run — the client can be left mid-write into a
  // socket nobody server-side is draining. TCP backpressure then stalls
  // its writes indefinitely: from the browser's side, a video upload
  // just freezes at whatever % had been flushed, with no error ever
  // surfaced (see docs/ for the incident this was found from). Once the
  // response has finished sending, destroy the request so any pending
  // client writes get released with a clear connection error instead of
  // hanging forever.
  if (!req.readableEnded) {
    res.on('finish', () => req.destroy());
  }
}

module.exports = { notFoundHandler, errorHandler };
