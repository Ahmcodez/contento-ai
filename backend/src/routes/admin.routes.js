const express = require('express');
const requireAdminKey = require('../middleware/requireAdminKey');
const adminController = require('../controllers/admin.controller');

const router = express.Router();

router.use(requireAdminKey);
router.get('/queues', adminController.getQueueSummary);

module.exports = router;
