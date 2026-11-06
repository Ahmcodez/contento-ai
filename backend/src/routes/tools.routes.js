const express = require('express');
const controller = require('../controllers/tools.controller');
const validate = require('../middleware/validate');
const { toolInfoLimiter, toolDownloadLimiter, toolStatusLimiter } = require('../middleware/rateLimiter');
const { infoBody, createBody, jobIdParam } = require('../validation/toolSchemas');

const router = express.Router();

// Public, no login: every route here is open to the internet, hence the per-visitor limits
// (src/middleware/rateLimiter.js) and the caps inside the service. See docs/PUBLIC_DOWNLOADER.md.
router.post('/downloader/info', toolInfoLimiter, validate(infoBody), controller.info);
router.post('/downloader/jobs', toolDownloadLimiter, validate(createBody), controller.create);
router.get('/downloader/jobs/:id', toolStatusLimiter, validate(jobIdParam), controller.status);
router.get('/downloader/jobs/:id/file', validate(jobIdParam), controller.file);

module.exports = router;
