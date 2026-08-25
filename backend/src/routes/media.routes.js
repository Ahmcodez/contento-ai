const express = require('express');
const controller = require('../controllers/media.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const AppError = require('../utils/AppError');
const { idParam } = require('../validation/projectSchemas');
const { mediaIdParam } = require('../validation/uploadSchemas');

const router = express.Router();

router.use(requireAuth);

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

router.post('/projects/:id/media', validate(idParam), handleUploadErrors, controller.upload);
router.get('/media/:mediaAssetId', validate(mediaIdParam), controller.getOne);

module.exports = router;
