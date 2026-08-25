const AppError = require('../utils/AppError');
const processingJobRepository = require('../repositories/processingJob.repository');
const workspaceService = require('./workspace.service');

const STATE_GROUPS = {
  UPLOADING: 'uploading',
  UPLOADED: 'uploading',
  VALIDATING: 'preparing',
  VALIDATED: 'preparing',
  EXTRACTING_AUDIO: 'preparing',
  AUDIO_EXTRACTED: 'preparing',
  TRANSCRIBING: 'transcribing',
  TRANSCRIBED: 'transcribing',
  ANALYZING: 'analyzing',
  ANALYZED: 'analyzing',
  FINDING_CLIPS: 'analyzing',
  CLIPS_FOUND: 'analyzing',
  SCORING_CLIPS: 'analyzing',
  CLIPS_SCORED: 'analyzing',
  RENDERING_CLIPS: 'rendering',
  CLIPS_RENDERED: 'rendering',
  GENERATING_CONTENT: 'writing',
  CONTENT_GENERATED: 'writing',
  FINALIZING: 'finishing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

async function getJob(userId, jobId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const job = await processingJobRepository.findByIdScoped(jobId, workspaceIds);
  if (!job) throw AppError.notFound('Processing job not found');
  return {
    id: job.id,
    state: job.state,
    stateGroup: STATE_GROUPS[job.state] || 'unknown',
    progressPercent: job.progress_percent,
    failureStage: job.failure_stage,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  };
}

/**
 * Resolves and ownership-checks a job in one step — shared by every
 * jobs-scoped sub-resource (transcript, clips, content) so each doesn't
 * repeat the same workspace lookup + 404 logic.
 */
async function assertJobAccess(userId, jobId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const job = await processingJobRepository.findByIdScoped(jobId, workspaceIds);
  if (!job) throw AppError.notFound('Processing job not found');
  return job;
}

async function getJobEvents(userId, jobId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const job = await processingJobRepository.findByIdScoped(jobId, workspaceIds);
  if (!job) throw AppError.notFound('Processing job not found');
  const events = await processingJobRepository.listEvents(jobId);
  return events.map((e) => ({
    fromState: e.from_state,
    toState: e.to_state,
    metadata: e.metadata,
    createdAt: e.created_at,
  }));
}

async function cancelJob(userId, jobId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const job = await processingJobRepository.findByIdScoped(jobId, workspaceIds);
  if (!job) throw AppError.notFound('Processing job not found');
  if (TERMINAL_STATES.has(job.state)) {
    throw AppError.conflict('Job has already finished and cannot be cancelled', 'ALREADY_TERMINAL');
  }
  const updated = await processingJobRepository.transitionState(jobId, {
    fromState: job.state,
    toState: 'CANCELLED',
  });
  return { id: updated.id, state: updated.state };
}

module.exports = { getJob, getJobEvents, cancelJob, assertJobAccess, STATE_GROUPS, TERMINAL_STATES };
