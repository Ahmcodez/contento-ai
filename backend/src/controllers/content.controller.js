const contentViewService = require('../services/contentView.service');
const asyncHandler = require('../utils/asyncHandler');

const update = asyncHandler(async (req, res) => {
  const content = await contentViewService.updateContent(req.user.id, req.params.contentId, req.body.body);
  res.status(200).json({ content });
});

module.exports = { update };
