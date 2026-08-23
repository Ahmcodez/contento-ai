const express = require('express');
const controller = require('../controllers/auth.controller');
const requireAuth = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimiter');
const { registerSchema, loginSchema } = require('../validation/authSchemas');

const router = express.Router();

router.post('/register', authLimiter, validate(registerSchema), controller.register);
router.post('/login', authLimiter, validate(loginSchema), controller.login);
router.post('/refresh', authLimiter, controller.refresh);
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);

module.exports = router;
