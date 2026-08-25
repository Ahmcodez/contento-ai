const mediaService = require('../services/media.service');
const asyncHandler = require('../utils/asyncHandler');

const upload = asyncHandler(async (req, res) => {
  const { mediaAsset, processingJob } = await mediaService.uploadMedia(req.user.id, req.params.id, req.file);
  res.status(202).json({
    mediaAsset: { id: mediaAsset.id, status: mediaAsset.status },
    processingJob: { id: processingJob.id, state: processingJob.state },
  });
});

const getOne = asyncHandler(async (req, res) => {
  const asset = await mediaService.getMediaAsset(req.user.id, req.params.mediaAssetId);
  res.status(200).json({
    mediaAsset: {
      id: asset.id,
      status: asset.status,
      originalFilename: asset.original_filename,
      durationSeconds: asset.duration_seconds,
      rejectionReason: asset.rejection_reason,
      createdAt: asset.created_at,
    },
  });
});

module.exports = { upload, getOne };
