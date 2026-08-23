const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/job.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const jobIdParam = z.object({ params: z.object({ jobId: z.string().uuid() }) });

// See media.routes.js for why requireAuth is applied per-route here
// instead of via router.use() at this shared /api/v1 mount point.
router.get('/jobs/:jobId', requireAuth, validate(jobIdParam), controller.getOne);
router.get('/jobs/:jobId/events', requireAuth, validate(jobIdParam), controller.getEvents);
router.post('/jobs/:jobId/cancel', requireAuth, validate(jobIdParam), controller.cancel);

module.exports = router;
