const db = require('../db/client');

const TABLE = 'processing_jobs';

async function create(trx, { mediaAssetId, state = 'UPLOADING' }) {
  const query = trx || db;
  const [job] = await query(TABLE).insert({ media_asset_id: mediaAssetId, state }).returning('*');
  await query('processing_job_events').insert({
    processing_job_id: job.id,
    from_state: null,
    to_state: state,
  });
  return job;
}

async function findByIdScoped(id, workspaceIds) {
  return db(TABLE)
    .join('media_assets', 'media_assets.id', `${TABLE}.media_asset_id`)
    .join('projects', 'projects.id', 'media_assets.project_id')
    .whereIn('projects.workspace_id', workspaceIds)
    .andWhere(`${TABLE}.id`, id)
    .select(`${TABLE}.*`)
    .first();
}

async function transitionState(id, { fromState, toState, progressPercent, errorMessage, failureStage, metadata }) {
  return db.transaction(async (trx) => {
    const updates = { state: toState, updated_at: trx.fn.now() };
    if (progressPercent !== undefined) updates.progress_percent = progressPercent;
    if (errorMessage !== undefined) updates.error_message = errorMessage;
    if (failureStage !== undefined) updates.failure_stage = failureStage;
    if (toState === 'COMPLETED' || toState === 'FAILED' || toState === 'CANCELLED') {
      updates.completed_at = trx.fn.now();
    }

    const [job] = await trx(TABLE).where({ id }).update(updates).returning('*');

    await trx('processing_job_events').insert({
      processing_job_id: id,
      from_state: fromState || null,
      to_state: toState,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return job;
  });
}

async function listEvents(processingJobId) {
  return db('processing_job_events')
    .where({ processing_job_id: processingJobId })
    .orderBy('created_at', 'asc');
}

async function countActiveForUser(userId) {
  const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED'];
  const result = await db(TABLE)
    .join('media_assets', 'media_assets.id', `${TABLE}.media_asset_id`)
    .where('media_assets.uploaded_by', userId)
    .whereNotIn(`${TABLE}.state`, TERMINAL)
    .count(`${TABLE}.id as count`)
    .first();
  return Number(result.count);
}

module.exports = { create, findByIdScoped, transitionState, listEvents, countActiveForUser };
