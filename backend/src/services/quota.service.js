const AppError = require('../utils/AppError');
const config = require('../config');
const db = require('../db/client');
const processingJobRepository = require('../repositories/processingJob.repository');

/**
 * V1 quota check: concurrent active job limit. Plan-level upload size /
 * duration / clip-count limits are enforced at their respective
 * validation points (upload size at multer + validate stage, duration at
 * ffprobe validation, clip count at clip-detection post-processing).
 */
async function assertCanStartNewJob(userId) {
  const activeCount = await processingJobRepository.countActiveForUser(userId);
  if (activeCount >= config.limits.maxProcessingJobsPerUserConcurrent) {
    throw AppError.tooManyRequests(
      `You have reached your limit of ${config.limits.maxProcessingJobsPerUserConcurrent} concurrent processing jobs. Wait for one to finish before starting another.`,
      'QUOTA_EXCEEDED',
    );
  }
}

/**
 * Caps total projects per user — a coarse, cheap guard against unbounded
 * account growth (docs/COST.md). Counts active + archived, since archived
 * projects still occupy DB rows and (until a hard-delete path exists)
 * their media/storage.
 */
async function assertCanCreateProject(userId) {
  const result = await db('projects')
    .join('workspaces', 'workspaces.id', 'projects.workspace_id')
    .where('workspaces.owner_id', userId)
    .count('projects.id as count')
    .first();

  const count = Number(result.count);
  if (count >= config.limits.maxProjectsPerUser) {
    throw AppError.tooManyRequests(
      `You have reached your limit of ${config.limits.maxProjectsPerUser} projects.`,
      'QUOTA_EXCEEDED',
    );
  }
}

/**
 * Caps total video-minutes processed per user per calendar month —
 * checked against the real usage_records ledger (docs/COST.md §3), the
 * same "never a separately maintained counter" pattern used everywhere
 * else. This is the concrete enforcement behind MAX_PROCESSING_MINUTES.
 */
async function assertWithinMonthlyProcessingMinutes(userId, additionalMinutes = 0) {
  const monthStart = `${new Date().toISOString().slice(0, 7)}-01`;
  const result = await db('usage_records')
    .where({ user_id: userId, category: 'upload_minutes' })
    .andWhere('occurred_on', '>=', monthStart)
    .sum('amount as total')
    .first();

  const usedMinutes = Number(result.total) || 0;
  if (usedMinutes + additionalMinutes > config.limits.maxProcessingMinutesPerUserPerMonth) {
    throw AppError.tooManyRequests(
      `This would exceed your monthly limit of ${config.limits.maxProcessingMinutesPerUserPerMonth} processing minutes (${Math.round(usedMinutes)} used so far this month).`,
      'QUOTA_EXCEEDED',
    );
  }
}

async function recordProcessingMinutes(userId, processingJobId, minutes) {
  await db('usage_records').insert({
    user_id: userId,
    category: 'upload_minutes',
    amount: minutes,
    processing_job_id: processingJobId,
    occurred_on: new Date().toISOString().slice(0, 10),
  });
}

async function recordClipRendered(userId, processingJobId) {
  await db('usage_records').insert({
    user_id: userId,
    category: 'clips_rendered',
    amount: 1,
    processing_job_id: processingJobId,
    occurred_on: new Date().toISOString().slice(0, 10),
  });
}

module.exports = {
  assertCanStartNewJob,
  assertCanCreateProject,
  assertWithinMonthlyProcessingMinutes,
  recordProcessingMinutes,
  recordClipRendered,
};
