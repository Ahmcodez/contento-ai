const db = require('../db/client');

async function createMany(processingJobId, candidates) {
  if (candidates.length === 0) return [];
  const rows = candidates.map((c, i) => ({
    processing_job_id: processingJobId,
    start_ms: c.startMs,
    end_ms: c.endMs,
    title: c.title,
    hook: c.hook || null,
    summary: c.summary || null,
    reason: c.reason || null,
    topic: c.topic || null,
    ai_score: c.aiScore ?? null,
    score_breakdown: c.scoreBreakdown ? JSON.stringify(c.scoreBreakdown) : null,
    final_score: c.finalScore,
    rank: i + 1,
  }));
  return db('clip_candidates').insert(rows).returning('*');
}

async function listByProcessingJobId(processingJobId) {
  return db('clip_candidates').where({ processing_job_id: processingJobId }).orderBy('rank', 'asc');
}

async function findByIdScoped(id, workspaceIds) {
  return db('clip_candidates')
    .join('processing_jobs', 'processing_jobs.id', 'clip_candidates.processing_job_id')
    .join('media_assets', 'media_assets.id', 'processing_jobs.media_asset_id')
    .join('projects', 'projects.id', 'media_assets.project_id')
    .whereIn('projects.workspace_id', workspaceIds)
    .andWhere('clip_candidates.id', id)
    .select('clip_candidates.*')
    .first();
}

async function updateStatus(id, status) {
  const [row] = await db('clip_candidates').where({ id }).update({ status }).returning('*');
  return row;
}

module.exports = { createMany, listByProcessingJobId, findByIdScoped, updateStatus };
