const AppError = require('../utils/AppError');
const projectRepository = require('../repositories/project.repository');
const mediaImportRepository = require('../repositories/mediaImport.repository');
const workspaceService = require('./workspace.service');
const quotaService = require('./quota.service');
const { enqueueUrlImportResolve, enqueueUrlImportDownload } = require('../queue/producers');

/**
 * Shapes a media_imports row for the API — never returns the raw DB row
 * (snake_case columns, internal-only fields) directly to a client.
 */
function serialize(row) {
  return {
    id: row.id,
    state: row.state,
    provider: row.provider,
    sourceUrl: row.source_url,
    progressPercent: row.progress_percent,
    title: row.title,
    thumbnailUrl: row.thumbnail_url,
    durationSeconds: row.duration_seconds === null ? null : Number(row.duration_seconds),
    width: row.width,
    height: row.height,
    mediaAssetId: row.media_asset_id,
    errorMessage: row.error_message,
    failureStage: row.failure_stage,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Kicks off the "Paste Video URL" flow: creates a media_imports row in
 * DETECTING_PROVIDER and enqueues the resolve job. Deliberately does
 * almost no validation itself beyond confirming project access — the
 * URL's own validity (provider support, DNS/SSRF safety, reachability)
 * is entirely urlImportResolve.processor.js's job, run asynchronously,
 * so this returns immediately rather than making the user's request
 * wait on a network round-trip to their pasted URL.
 */
async function createImport(userId, projectId, sourceUrl) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const project = await projectRepository.findByIdForWorkspaces(projectId, workspaceIds);
  if (!project) {
    throw AppError.notFound('Project not found');
  }

  const mediaImport = await mediaImportRepository.create({ projectId, requestedBy: userId, sourceUrl });
  await enqueueUrlImportResolve({ mediaImportId: mediaImport.id });
  return serialize(mediaImport);
}

/**
 * Polled by the frontend preview UI while waiting for
 * DETECTING_PROVIDER/FETCHING_METADATA to resolve, and again after
 * confirming while DOWNLOADING/VALIDATING_MEDIA run.
 */
async function getImport(userId, mediaImportId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const mediaImport = await mediaImportRepository.findByIdScoped(mediaImportId, workspaceIds);
  if (!mediaImport) {
    throw AppError.notFound('Import not found');
  }
  return serialize(mediaImport);
}

/**
 * "Import & Analyze" — the one place the spec's cost-protection ordering
 * (metadata -> duration check -> quota check -> confirmation -> download)
 * is actually enforced synchronously in a request, rather than inside a
 * queued job: the whole point of a confirmation step is that nothing
 * expensive (the download) has happened yet, so a rejected quota check
 * here costs nothing to undo. urlImportResolve.processor.js already
 * rejected anything over the hard system-wide duration cap before this
 * point was ever reachable; this repeats the *account-specific* monthly
 * quota check because time may have passed (and other jobs may have
 * run) between the preview being shown and the user clicking confirm.
 */
async function confirmImport(userId, mediaImportId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const mediaImport = await mediaImportRepository.findByIdScoped(mediaImportId, workspaceIds);
  if (!mediaImport) {
    throw AppError.notFound('Import not found');
  }
  if (mediaImport.state !== 'WAITING_CONFIRMATION') {
    throw AppError.conflict(
      `This import is in "${mediaImport.state}" state and cannot be confirmed right now`,
      'NOT_READY',
    );
  }

  await quotaService.assertCanStartNewJob(userId);
  if (mediaImport.duration_seconds) {
    await quotaService.assertWithinMonthlyProcessingMinutes(userId, Number(mediaImport.duration_seconds) / 60);
  }

  const updated = await mediaImportRepository.transitionState(mediaImportId, {
    fromState: 'WAITING_CONFIRMATION',
    toState: 'DOWNLOADING',
    progressPercent: 60,
  });
  await enqueueUrlImportDownload({ mediaImportId });
  return serialize(updated);
}

module.exports = { createImport, getImport, confirmImport, serialize };
