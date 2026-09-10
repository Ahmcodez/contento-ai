const db = require('../db/client');

const TABLE = 'media_imports';

async function create({ projectId, requestedBy, sourceUrl, state = 'DETECTING_PROVIDER' }) {
  const [row] = await db(TABLE)
    .insert({ project_id: projectId, requested_by: requestedBy, source_url: sourceUrl, state })
    .returning('*');
  await db('media_import_events').insert({ media_import_id: row.id, from_state: null, to_state: state });
  return row;
}

async function findByIdScoped(id, workspaceIds) {
  return db(TABLE)
    .join('projects', 'projects.id', `${TABLE}.project_id`)
    .whereIn('projects.workspace_id', workspaceIds)
    .andWhere(`${TABLE}.id`, id)
    .select(`${TABLE}.*`)
    .first();
}

/**
 * Mirrors processingJobRepository.transitionState — same shape, same
 * event-log-on-every-transition pattern, applied to media_imports
 * instead of processing_jobs. Kept as a genuinely separate function
 * (not a shared generic "transition any state-machine table" helper)
 * because the two tables' terminal-state timestamp columns and valid
 * `updates` fields differ enough that a shared abstraction would need
 * as many special cases as just having two small functions.
 */
async function transitionState(id, { fromState, toState, progressPercent, errorMessage, failureStage, metadata, extra }) {
  return db.transaction(async (trx) => {
    const updates = { state: toState, updated_at: trx.fn.now(), ...(extra || {}) };
    if (progressPercent !== undefined) updates.progress_percent = progressPercent;
    if (errorMessage !== undefined) updates.error_message = errorMessage;
    if (failureStage !== undefined) updates.failure_stage = failureStage;
    if (toState === 'COMPLETED' || toState === 'FAILED') {
      updates.completed_at = trx.fn.now();
    }

    const [row] = await trx(TABLE).where({ id }).update(updates).returning('*');

    await trx('media_import_events').insert({
      media_import_id: id,
      from_state: fromState || null,
      to_state: toState,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });

    return row;
  });
}

module.exports = { create, findByIdScoped, transitionState };
