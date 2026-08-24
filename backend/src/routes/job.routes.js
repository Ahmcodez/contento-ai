const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/job.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const jobIdParam = z.object({ params: z.object({ jobId: z.string().uuid() }) });
const contentTypeParam = jobIdParam.extend({
  params: z.object({
    jobId: z.string().uuid(),
    contentType: z.enum(['blog', 'linkedin', 'x_twitter', 'instagram_caption', 'youtube_description']),
  }),
});

// See media.routes.js for why requireAuth is applied per-route here
// instead of via router.use() at this shared /api/v1 mount point.
router.get('/jobs/:jobId', requireAuth, validate(jobIdParam), controller.getOne);
router.get('/jobs/:jobId/events', requireAuth, validate(jobIdParam), controller.getEvents);
router.post('/jobs/:jobId/cancel', requireAuth, validate(jobIdParam), controller.cancel);
router.get('/jobs/:jobId/transcript', requireAuth, validate(jobIdParam), controller.getTranscript);
router.get('/jobs/:jobId/clips', requireAuth, validate(jobIdParam), controller.getClips);
router.get('/jobs/:jobId/content', requireAuth, validate(jobIdParam), controller.getContent);
router.post(
  '/jobs/:jobId/content/:contentType/regenerate',
  requireAuth,
  validate(contentTypeParam),
  controller.regenerateContent,
);

module.exports = router;
