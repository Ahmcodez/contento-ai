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

module.exports = { create, findByIdScoped, findByChecksum, updateById };
