const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const path = require('path');
const { fromFile } = require('file-type');
const { ulid } = require('ulid');

const db = require('../db/client');
const AppError = require('../utils/AppError');
const { sanitizeDisplayFilename, extensionFromFilename } = require('../utils/sanitize');
const { ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS } = require('../validation/uploadSchemas');
const { getStorageDriver } = require('../storage');
const projectRepository = require('../repositories/project.repository');
const mediaAssetRepository = require('../repositories/mediaAsset.repository');
const processingJobRepository = require('../repositories/processingJob.repository');
const workspaceService = require('./workspace.service');
const quotaService = require('./quota.service');
const { enqueueVideoValidate } = require('../queue/producers');

async function computeChecksum(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function uploadMedia(userId, projectId, file) {
  if (!file) {
    throw AppError.badRequest('No file uploaded', 'FILE_REQUIRED');
  }

  const cleanup = () => fsp.rm(file.path, { force: true }).catch(() => {});

  try {
    const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
    const project = await projectRepository.findByIdForWorkspaces(projectId, workspaceIds);
    if (!project) {
      throw AppError.notFound('Project not found');
    }

    await quotaService.assertCanStartNewJob(userId);

    // Extension check (client-declared, first pass).
    const originalName = sanitizeDisplayFilename(file.originalname);
    const ext = extensionFromFilename(originalName);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw AppError.unsupportedMediaType(`File extension "${ext}" is not supported`);
    }

    // Real content check: sniff the actual file bytes, never trust the
    // client-supplied Content-Type header alone.
    const detected = await fromFile(file.path);
    const detectedMime = detected?.mime;
    if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
      throw AppError.unsupportedMediaType(
        `File content does not match a supported video format (detected: ${detectedMime || 'unknown'})`,
      );
    }

    const checksum = await computeChecksum(file.path);

    const duplicate = await mediaAssetRepository.findByChecksum(projectId, checksum);
    if (duplicate) {
      throw AppError.conflict('This exact video has already been uploaded to this project', 'DUPLICATE_UPLOAD');
    }

    const storageKey = `${project.workspace_id}/${projectId}/${ulid()}${ext}`;
    const storageDriver = getStorageDriver();
    await storageDriver.saveFromPath(storageKey, file.path);

    const { mediaAsset, processingJob } = await db.transaction(async (trx) => {
      const [asset] = await trx('media_assets')
        .insert({
          project_id: projectId,
          uploaded_by: userId,
          original_filename: originalName,
          storage_key: storageKey,
          mime_type: detectedMime,
          size_bytes: file.size,
          checksum_sha256: checksum,
          status: 'uploaded',
        })
        .returning('*');

      const job = await processingJobRepository.create(trx, {
        mediaAssetId: asset.id,
        state: 'UPLOADED',
      });

      return { mediaAsset: asset, processingJob: job };
    });

    await enqueueVideoValidate({ processingJobId: processingJob.id, mediaAssetId: mediaAsset.id });

    return { mediaAsset, processingJob };
  } catch (err) {
    // On any failure after the file landed in storage/DB we still want the
    // temp upload cleaned up; a partially-created storage object without a
    // DB row is a documented acceptable orphan in V1 (no cleanup job yet).
    throw err;
  } finally {
    await cleanup();
  }
}

async function getMediaAsset(userId, mediaAssetId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const asset = await mediaAssetRepository.findByIdScoped(mediaAssetId, workspaceIds);
  if (!asset) throw AppError.notFound('Media asset not found');
  return asset;
}

module.exports = { uploadMedia, getMediaAsset };
