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

/**
 * Same ownership scoping as findByIdScoped, but resolves the caller's
 * workspaces as a subquery so it's a single round trip. Used by the job
 * status poll, which the frontend hits every few seconds while a job runs.
 */
async function findByIdForUser(id, userId) {
  return db(TABLE)
    .join('media_assets', 'media_assets.id', `${TABLE}.media_asset_id`)
    .join('projects', 'projects.id', 'media_assets.project_id')
    .whereIn('projects.workspace_id', db('workspace_members').select('workspace_id').where({ user_id: userId }))
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

/**
 * State the job was in when it last failed, read from the FAILED event's
 * from_state. Every failure path (processors, the retry-exhaustion wrapper, the
 * reaper) records it there, whereas failure_stage mixes state names and queue
 * names, so this is the one reliable source for "where do I resume from".
 */
async function findLastFailureState(id) {
  const event = await db('processing_job_events')
    .where({ processing_job_id: id, to_state: 'FAILED' })
    .orderBy('created_at', 'desc')
    .first();
  return event ? event.from_state : null;
}

/**
 * FAILED -> toState for a user retry. Guarded on state = 'FAILED' in the UPDATE
 * itself, so two simultaneous retries can't both succeed (the loser gets null).
 * Clears the failure fields and completed_at; the event carries retry:true,
 * which also marks where the reaper's per-stage re-enqueue allowance restarts.
 */
async function reopenFailed(id, toState) {
  return db.transaction(async (trx) => {
    const [job] = await trx(TABLE)
      .where({ id, state: 'FAILED' })
      .update({ state: toState, error_message: null, failure_stage: null, completed_at: null, updated_at: trx.fn.now() })
      .returning('*');
    if (!job) return null;
    await trx('processing_job_events').insert({
      processing_job_id: id,
      from_state: 'FAILED',
      to_state: toState,
      metadata: JSON.stringify({ retry: true }),
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

module.exports = {
  create,
  findByIdScoped,
  findByIdForUser,
  transitionState,
  findLastFailureState,
  reopenFailed,
  listEvents,
  countActiveForUser,
};
