const db = require('../db/client');

const TABLE = 'media_assets';

async function create(fields) {
  const [row] = await db(TABLE).insert(fields).returning('*');
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

async function findByChecksum(projectId, checksum) {
  return db(TABLE).where({ project_id: projectId, checksum_sha256: checksum }).first();
}

async function updateById(id, fields) {
  const [row] = await db(TABLE)
    .where({ id })
    .update({ ...fields, updated_at: db.fn.now() })
    .returning('*');
  return row;
}

/**
 * Lists every media asset in a project with its most recent processing
 * job attached — powers the project overview page's "your uploads"
 * list, same latest-job pattern used by project.repository.js for the
 * dashboard.
 */
async function listWithLatestJobByProjectId(projectId) {
  const assets = await db(TABLE).where({ project_id: projectId }).orderBy('created_at', 'desc');
  if (assets.length === 0) return [];

  const jobs = await db('processing_jobs')
    .whereIn(
      'media_asset_id',
      assets.map((a) => a.id),
    )
    .orderBy('created_at', 'desc');

  const latestByAsset = new Map();
  for (const job of jobs) {
    if (!latestByAsset.has(job.media_asset_id)) {
      latestByAsset.set(job.media_asset_id, job);
    }
  }

  return assets.map((asset) => {
    const job = latestByAsset.get(asset.id);
    return {
      id: asset.id,
      originalFilename: asset.original_filename,
      status: asset.status,
      durationSeconds: asset.duration_seconds,
      createdAt: asset.created_at,
      latestJob: job ? { id: job.id, state: job.state, progressPercent: job.progress_percent } : null,
    };
  });
}

module.exports = { create, findByIdScoped, findByChecksum, updateById, listWithLatestJobByProjectId };
