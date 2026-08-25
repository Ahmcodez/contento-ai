const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/clip.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const clipIdParam = z.object({ params: z.object({ clipCandidateId: z.string().uuid() }) });

router.get('/clips/:clipCandidateId/download', requireAuth, validate(clipIdParam), controller.download);

module.exports = router;
