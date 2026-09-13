const mediaService = require('../services/media.service');
const urlImportService = require('../services/urlImport.service');
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

const createUrlImport = asyncHandler(async (req, res) => {
  const mediaImport = await urlImportService.createImport(req.user.id, req.params.id, req.body.url);
  res.status(202).json({ mediaImport });
});

const getUrlImport = asyncHandler(async (req, res) => {
  const mediaImport = await urlImportService.getImport(req.user.id, req.params.mediaImportId);
  res.status(200).json({ mediaImport });
});

const confirmUrlImport = asyncHandler(async (req, res) => {
  const mediaImport = await urlImportService.confirmImport(req.user.id, req.params.mediaImportId);
  res.status(200).json({ mediaImport });
});

module.exports = { upload, getOne, createUrlImport, getUrlImport, confirmUrlImport };
