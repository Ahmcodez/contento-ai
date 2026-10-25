const AppError = require('../utils/AppError');
const processingJobRepository = require('../repositories/processingJob.repository');
const workspaceService = require('./workspace.service');
const quotaService = require('./quota.service');
const db = require('../db/client');
const { PIPELINE_STATE_TO_STAGE, buildPipelinePayload, enqueueStage } = require('../queue/stageResume');

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

function serializeJob(job) {
  return {
    id: job.id,
    state: job.state,
    stateGroup: STATE_GROUPS[job.state] || 'unknown',
    progressPercent: job.progress_percent,
    requestedClipCount: job.requested_clip_count,
    failureStage: job.failure_stage,
    errorMessage: job.error_message,
    createdAt: job.created_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
  };
}

async function getJob(userId, jobId) {
  const job = await processingJobRepository.findByIdForUser(jobId, userId);
  if (!job) throw AppError.notFound('Processing job not found');
  return serializeJob(job);
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

/**
 * Retry a FAILED job from the stage it failed in, not from scratch: everything
 * already produced (audio, transcript, analysis, ...) is reused, so a retry
 * after e.g. a provider outage only pays for the work that didn't finish.
 *
 * Not retryable: jobs that are not FAILED, jobs whose media was rejected at
 * validation (too long, no audio, over quota -- retrying would just bypass
 * those checks), and jobs whose failing stage can't be determined.
 *
 * If enqueueing fails after the job is reopened (Redis down), the row is left
 * in the in-progress state and the stuck-job reaper picks it up.
 */
async function retryJob(userId, jobId) {
  const job = await assertJobAccess(userId, jobId);
  if (job.state !== 'FAILED') {
    throw AppError.conflict('Only a failed job can be retried', 'NOT_RETRYABLE');
  }

  const asset = await db('media_assets').where({ id: job.media_asset_id }).first();
  if (!asset || asset.status === 'rejected') {
    throw AppError.conflict(
      asset ? `This video was rejected and cannot be retried: ${asset.rejection_reason}` : 'The source video no longer exists',
      'NOT_RETRYABLE',
    );
  }

  const resumeState = await processingJobRepository.findLastFailureState(jobId);
  const stage = PIPELINE_STATE_TO_STAGE[resumeState];
  if (!stage) {
    throw AppError.conflict('This job cannot be resumed. Please upload the video again.', 'NOT_RETRYABLE');
  }

  await quotaService.assertCanStartNewJob(userId);

  const reopened = await processingJobRepository.reopenFailed(jobId, resumeState);
  if (!reopened) {
    throw AppError.conflict('This job is already being retried', 'NOT_RETRYABLE'); // lost a race with another retry
  }

  await enqueueStage(stage, await buildPipelinePayload(stage, reopened));
  return serializeJob(reopened);
}

module.exports = { getJob, getJobEvents, cancelJob, retryJob, assertJobAccess, STATE_GROUPS, TERMINAL_STATES };
