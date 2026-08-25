const db = require('../db/client');
const config = require('../config');
const usageService = require('./usage.service');

/**
 * Summarizes the caller's plan limits alongside real consumption pulled
 * from the usage_records ledger (docs/COST.md §3) — never a separately
 * maintained counter, so this can never drift from what actually happened.
 */
async function getUsageSummary(userId) {
  const user = await db('users').where({ id: userId }).first();
  const quota = await db('quotas').where({ plan: user.plan }).first();

  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [aiRequestsToday, clipsThisMonth, activeJobs] = await Promise.all([
    usageService.countAiRequestsToday(userId),
    db('usage_records')
      .where({ user_id: userId, category: 'clips_rendered' })
      .andWhere('occurred_on', '>=', monthStart)
      .sum('amount as total')
      .first(),
    db('processing_jobs')
      .join('media_assets', 'media_assets.id', 'processing_jobs.media_asset_id')
      .where('media_assets.uploaded_by', userId)
      .whereNotIn('processing_jobs.state', ['COMPLETED', 'FAILED', 'CANCELLED'])
      .count('processing_jobs.id as total')
      .first(),
  ]);

  return {
    plan: user.plan,
    quota: {
      maxUploadDurationSeconds: quota.max_upload_duration_seconds,
      maxUploadSizeMb: quota.max_upload_size_mb,
      maxClipsPerVideo: quota.max_clips_per_video,
      maxAiRequestsPerDay: quota.max_ai_requests_per_day,
      maxConcurrentJobs: quota.max_concurrent_jobs,
    },
    usage: {
      aiRequestsUsedToday: aiRequestsToday,
      clipsRenderedThisMonth: Number(clipsThisMonth.total) || 0,
      activeProcessingJobs: Number(activeJobs.total) || 0,
    },
    configDefaults: {
      maxAiCallsPerJob: config.limits.maxAiCallsPerJob,
    },
  };
}

module.exports = { getUsageSummary };
