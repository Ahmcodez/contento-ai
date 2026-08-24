const express = require('express');
const { z } = require('zod');
const controller = require('../controllers/content.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();

const updateContentSchema = z.object({
  params: z.object({ contentId: z.string().uuid() }),
  body: z.object({ body: z.string().min(1).max(20000) }),
});

router.patch('/content/:contentId', requireAuth, validate(updateContentSchema), controller.update);

module.exports = router;
