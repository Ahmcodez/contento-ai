const usageViewService = require('../services/usageView.service');
const asyncHandler = require('../utils/asyncHandler');

const getUsage = asyncHandler(async (req, res) => {
  const summary = await usageViewService.getUsageSummary(req.user.id);
  res.status(200).json(summary);
});

module.exports = { getUsage };
