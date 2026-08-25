const express = require('express');
const controller = require('../controllers/media.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const AppError = require('../utils/AppError');
const { idParam } = require('../validation/projectSchemas');
const { mediaIdParam } = require('../validation/uploadSchemas');

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

// requireAuth is applied per-route, not via router.use(), because this
// router is mounted at the bare /api/v1 prefix (its paths don't share a
// single sub-prefix). A blanket router.use(requireAuth) here would
// intercept every unmatched /api/v1/* request with a 401 before it ever
// reaches the 404 handler.
router.post('/projects/:id/media', requireAuth, validate(idParam), handleUploadErrors, controller.upload);
router.get('/media/:mediaAssetId', requireAuth, validate(mediaIdParam), controller.getOne);

module.exports = router;
