const db = require('../db/client');

const TABLE = 'projects';

async function create({ workspaceId, title, description, createdBy }) {
  const [project] = await db(TABLE)
    .insert({ workspace_id: workspaceId, title, description, created_by: createdBy })
    .returning('*');
  return project;
}

/**
 * Every read here is scoped by workspaceIds the caller belongs to — this
 * is the ownership boundary. There is deliberately no "find by id alone"
 * method, so a handler can't accidentally skip the check.
 */
async function listForWorkspaces(workspaceIds, { status, page = 1, pageSize = 20 } = {}) {
  let query = db(TABLE).whereIn('workspace_id', workspaceIds);
  if (status) query = query.andWhere({ status });

  const countQuery = query.clone().count('id as count').first();
  const rowsQuery = query
    .clone()
    .orderBy('created_at', 'desc')
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const [rows, countResult] = await Promise.all([rowsQuery, countQuery]);

  // Attach each project's most recently created processing job (if any)
  // so dashboard/list views can show real status instead of nothing —
  // one extra query, not N+1, since it's scoped to just this page's ids.
  if (rows.length > 0) {
    const projectIds = rows.map((r) => r.id);
    const latestJobs = await db('processing_jobs')
      .join('media_assets', 'media_assets.id', 'processing_jobs.media_asset_id')
      .whereIn('media_assets.project_id', projectIds)
      .select(
        'media_assets.project_id',
        'processing_jobs.id',
        'processing_jobs.state',
        'processing_jobs.progress_percent',
        'processing_jobs.created_at',
      )
      .orderBy('processing_jobs.created_at', 'desc');

    const latestByProject = new Map();
    for (const job of latestJobs) {
      if (!latestByProject.has(job.project_id)) {
        latestByProject.set(job.project_id, job);
      }
    }

    for (const row of rows) {
      const latest = latestByProject.get(row.id);
      row.latest_job = latest
        ? { id: latest.id, state: latest.state, progressPercent: latest.progress_percent }
        : null;
    }
  }

  return { rows, total: Number(countResult.count) };
}

async function findByIdForWorkspaces(id, workspaceIds) {
  return db(TABLE).where({ id }).whereIn('workspace_id', workspaceIds).first();
}

async function updateByIdForWorkspaces(id, workspaceIds, fields) {
  const [project] = await db(TABLE)
    .where({ id })
    .whereIn('workspace_id', workspaceIds)
    .update({ ...fields, updated_at: db.fn.now() })
    .returning('*');
  return project;
}

async function archiveByIdForWorkspaces(id, workspaceIds) {
  return updateByIdForWorkspaces(id, workspaceIds, { status: 'archived' });
}

module.exports = {
  create,
  listForWorkspaces,
  findByIdForWorkspaces,
  updateByIdForWorkspaces,
  archiveByIdForWorkspaces,
};
