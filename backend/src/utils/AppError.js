/**
 * Structured, user-safe application error.
 * `message` is always safe to return to the client.
 * `detail` (stack traces, provider payloads, etc.) is server-side only —
 * never serialized into an API response.
 */
class AppError extends Error {
  constructor(code, message, statusCode = 400, detail = undefined) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.detail = detail;
    this.isOperational = true; // expected error, not a bug
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, code = 'VALIDATION_ERROR', detail) {
    return new AppError(code, message, 422, detail);
  }

  static unauthorized(message = 'Unauthorized', code = 'UNAUTHORIZED') {
    return new AppError(code, message, 401);
  }

  static forbidden(message = 'Forbidden', code = 'FORBIDDEN') {
    return new AppError(code, message, 403);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new AppError(code, message, 404);
  }

  static conflict(message, code = 'CONFLICT') {
    return new AppError(code, message, 409);
  }

  static tooManyRequests(message = 'Too many requests', code = 'RATE_LIMITED') {
    return new AppError(code, message, 429);
  }

  static payloadTooLarge(message = 'Payload too large', code = 'FILE_TOO_LARGE') {
    return new AppError(code, message, 413);
  }

  static unsupportedMediaType(message = 'Unsupported media type', code = 'UNSUPPORTED_MEDIA_TYPE') {
    return new AppError(code, message, 415);
  }

  static internal(message = 'Internal server error', detail) {
    const err = new AppError('INTERNAL_ERROR', message, 500, detail);
    err.isOperational = false;
    return err;
  }
}

module.exports = AppError;
