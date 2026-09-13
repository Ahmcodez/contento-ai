const express = require('express');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const controller = require('../controllers/media.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const AppError = require('../utils/AppError');
const config = require('../config');
const redis = require('../redis/client');
const { idParam } = require('../validation/projectSchemas');
const { mediaIdParam } = require('../validation/uploadSchemas');
const { pasteUrlBody, mediaImportIdParam } = require('../validation/urlImportSchemas');

const router = express.Router();

function handleUploadErrors(req, res, next) {
  upload.single('video')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(AppError.payloadTooLarge('Video exceeds the maximum allowed upload size'));
      }
      return next(AppError.badRequest(err.message, 'UPLOAD_ERROR'));
    }
    return next();
  });
}

// Stricter than generalLimiter (applied globally in app.js): each paste
// triggers a queued job that itself makes an outbound network/subprocess
// call (a HEAD request or a yt-dlp invocation) on the user's behalf —
// exactly the kind of endpoint spec section 6 ("rate limiting") means to
// guard, distinct from ordinary read/write API traffic.
const urlImportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  // See the identical comment in middleware/rateLimiter.js — a rate
  // limiter should fail open, not take the guarded request down with it.
  passOnStoreError: true,
  store: config.isTest ? undefined : new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: 'rl:url-import:' }),
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : req.ip),
  handler: (req, res, next) => next(AppError.tooManyRequests('Too many URL imports requested, please slow down')),
});

// requireAuth is applied per-route, not via router.use(), because this
// router is mounted at the bare /api/v1 prefix (its paths don't share a
// single sub-prefix). A blanket router.use(requireAuth) here would
// intercept every unmatched /api/v1/* request with a 401 before it ever
// reaches the 404 handler.
router.post('/projects/:id/media', requireAuth, validate(idParam), handleUploadErrors, controller.upload);
router.get('/media/:mediaAssetId', requireAuth, validate(mediaIdParam), controller.getOne);

router.post('/projects/:id/media/url', requireAuth, urlImportLimiter, validate(idParam), validate(pasteUrlBody), controller.createUrlImport);
router.get('/media-imports/:mediaImportId', requireAuth, validate(mediaImportIdParam), controller.getUrlImport);
router.post('/media-imports/:mediaImportId/confirm', requireAuth, validate(mediaImportIdParam), controller.confirmUrlImport);

module.exports = router;
