const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/clip.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const clipIdParam = z.object({ params: z.object({ clipCandidateId: z.string().uuid() }) });

router.get('/clips/:clipCandidateId/download', requireAuth, validate(clipIdParam), controller.download);

// Playback: the app asks (authenticated) for short-lived signed links, then the <video>
// and <img> load them directly. The two GET routes carry no Authorization header (a media
// element can't send one); the signed `t` token is what authorizes them.
router.post('/clips/:clipCandidateId/playback', requireAuth, validate(clipIdParam), controller.playback);
router.get('/clips/:clipCandidateId/stream', validate(clipIdParam), controller.stream);
router.get('/clips/:clipCandidateId/thumbnail', validate(clipIdParam), controller.thumbnail);

module.exports = router;
