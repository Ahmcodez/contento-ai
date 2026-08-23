const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/job.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const jobIdParam = z.object({ params: z.object({ jobId: z.string().uuid() }) });

router.use(requireAuth);

router.get('/jobs/:jobId', validate(jobIdParam), controller.getOne);
router.get('/jobs/:jobId/events', validate(jobIdParam), controller.getEvents);
router.post('/jobs/:jobId/cancel', validate(jobIdParam), controller.cancel);

module.exports = router;
