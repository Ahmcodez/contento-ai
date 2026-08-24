const express = require('express');
const controller = require('../controllers/usage.controller');
const requireAuth = require('../middleware/auth');

const router = express.Router();

router.get('/usage', requireAuth, controller.getUsage);

module.exports = router;
