const fs = require('fs');
const fsp = require('fs/promises');
const crypto = require('crypto');
const { ulid } = require('ulid');

const db = require('../db/client');
const AppError = require('../utils/AppError');
const { sanitizeDisplayFilename, extensionFromFilename } = require('../utils/sanitize');
const { detectVideoContainer } = require('../utils/detectVideoContainer');
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

/**
 * Shared tail-end of both ingestion paths (upload and URL import): takes
 * a real local file already sitting on disk, validates its actual bytes
 * (never a client- or server-reported extension/Content-Type), dedupes
 * by checksum, moves it into permanent storage, and creates the
 * media_assets + processing_jobs rows that kick off the one shared
 * pipeline. This is the exact point the spec's "same pipeline, not a
 * separate URL-to-clips system" requirement is enforced in code: from
 * here on, upload and URL-import are running the identical function.
 *
 * `sourceMetadata` is optional and only ever set by the URL-import path
 * (see urlImportDownload.processor.js) — it carries the source_type/
 * source_provider/source_url/source_id/title columns added specifically
 * for that flow. Left undefined, every field defaults exactly as it did
 * before URL import existed (source_type: 'upload').
 */
async function createMediaAssetFromLocalFile(projectId, userId, filePath, { displayName, sourceMetadata } = {}) {
  const detected = await detectVideoContainer(filePath);
  const detectedMime = detected?.mime;
  if (!detectedMime || !ALLOWED_MIME_TYPES.has(detectedMime)) {
    throw AppError.unsupportedMediaType(
      `File content does not match a supported video format (detected: ${detectedMime || 'unknown'})`,
    );
  }
  const ext = detected.ext || extensionFromFilename(displayName || '');

  const checksum = await computeChecksum(filePath);

  const duplicate = await mediaAssetRepository.findByChecksum(projectId, checksum);
  if (duplicate) {
    throw AppError.conflict('This exact video has already been added to this project', 'DUPLICATE_UPLOAD');
  }

  const project = await projectRepository.findByIdForWorkspaces(projectId, await workspaceService.getWorkspaceIdsForUser(userId));
  if (!project) {
    throw AppError.notFound('Project not found');
  }

  const { size: sizeBytes } = await fsp.stat(filePath);
  const storageKey = `${project.workspace_id}/${projectId}/${ulid()}${ext}`;
  const storageDriver = getStorageDriver();
  await storageDriver.saveFromPath(storageKey, filePath);

  const { mediaAsset, processingJob } = await db.transaction(async (trx) => {
    const [asset] = await trx('media_assets')
      .insert({
        project_id: projectId,
        uploaded_by: userId,
        original_filename: sanitizeDisplayFilename(displayName || `video${ext}`),
        storage_key: storageKey,
        mime_type: detectedMime,
        size_bytes: sizeBytes,
        checksum_sha256: checksum,
        status: 'uploaded',
        ...(sourceMetadata
          ? {
            source_type: 'url',
            source_provider: sourceMetadata.provider,
            source_url: sourceMetadata.sourceUrl,
            source_id: sourceMetadata.sourceId,
            title: sourceMetadata.title,
          }
          : {}),
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

    return await createMediaAssetFromLocalFile(projectId, userId, file.path, { displayName: originalName });
  } finally {
    // On any failure after the file landed in storage/DB we still want the
    // temp upload cleaned up; a partially-created storage object without a
    // DB row is a documented acceptable orphan in V1 (no cleanup job yet).
    await cleanup();
  }
}

async function getMediaAsset(userId, mediaAssetId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const asset = await mediaAssetRepository.findByIdScoped(mediaAssetId, workspaceIds);
  if (!asset) throw AppError.notFound('Media asset not found');
  return asset;
}

module.exports = { uploadMedia, getMediaAsset, createMediaAssetFromLocalFile };
