const AppError = require('../utils/AppError');
const jobService = require('./job.service');
const workspaceService = require('./workspace.service');
const db = require('../db/client');
const { getStorageDriver } = require('../storage');
const clipCandidateRepository = require('../repositories/clipCandidate.repository');

function rowToClip(row, generatedClip) {
  return {
    id: row.id,
    startMs: row.start_ms,
    endMs: row.end_ms,
    title: row.title,
    hook: row.hook,
    summary: row.summary,
    reason: row.reason,
    topic: row.topic,
    qualityScore: row.final_score !== null ? Number(row.final_score) : null,
    scoreBreakdown: row.score_breakdown,
    status: row.status,
    render: generatedClip
      ? {
          status: generatedClip.render_status,
          durationSeconds: generatedClip.duration_seconds !== null ? Number(generatedClip.duration_seconds) : null,
          error: generatedClip.render_error,
        }
      : { status: 'pending', durationSeconds: null, error: null },
  };
}

async function listClipsForJob(userId, jobId) {
  const job = await jobService.assertJobAccess(userId, jobId);

  const candidates = await db('clip_candidates').where({ processing_job_id: job.id }).orderBy('rank', 'asc');
  const generatedClips = await db('generated_clips').whereIn(
    'clip_candidate_id',
    candidates.map((c) => c.id),
  );
  const byCandidateId = new Map(generatedClips.map((g) => [g.clip_candidate_id, g]));

  return candidates.map((c) => rowToClip(c, byCandidateId.get(c.id)));
}

async function getClipDownloadStream(userId, clipCandidateId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);

  const candidate = await clipCandidateRepository.findByIdScoped(clipCandidateId, workspaceIds);
  if (!candidate) throw AppError.notFound('Clip not found');

  const generatedClip = await db('generated_clips').where({ clip_candidate_id: clipCandidateId }).first();
  if (!generatedClip || generatedClip.render_status !== 'rendered' || !generatedClip.storage_key) {
    throw AppError.conflict('This clip has not finished rendering yet', 'NOT_RENDERED');
  }

  const storageDriver = getStorageDriver();
  const stream = await storageDriver.getReadStream(generatedClip.storage_key);
  return { stream, filename: `${candidate.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.mp4` };
}

module.exports = { listClipsForJob, getClipDownloadStream };
