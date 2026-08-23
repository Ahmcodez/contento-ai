const AppError = require('../utils/AppError');

/**
 * Validates req.{body,params,query} against a zod schema shaped as
 * z.object({ body, params, query }) (any subset). Replaces the request
 * fields with the parsed/coerced values so downstream code can trust them.
 */
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      return next(AppError.badRequest('Request validation failed', 'VALIDATION_ERROR', details));
    }

    if (result.data.body !== undefined) req.body = result.data.body;
    if (result.data.params !== undefined) req.params = result.data.params;
    if (result.data.query !== undefined) req.query = result.data.query;

    return next();
  };
}

module.exports = validate;
