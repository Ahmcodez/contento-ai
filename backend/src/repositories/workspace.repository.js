const db = require('../db/client');

async function createPersonalWorkspace(trx, { ownerId, name }) {
  const query = trx || db;
  const [workspace] = await query('workspaces')
    .insert({ owner_id: ownerId, name, is_personal: true })
    .returning(['id', 'name', 'owner_id', 'is_personal']);

  await query('workspace_members').insert({
    workspace_id: workspace.id,
    user_id: ownerId,
    role: 'owner',
  });

  return workspace;
}

async function findMembership(userId, workspaceId) {
  return db('workspace_members').where({ user_id: userId, workspace_id: workspaceId }).first();
}

async function findPersonalWorkspaceForUser(userId) {
  return db('workspaces').where({ owner_id: userId, is_personal: true }).first();
}

async function listWorkspaceIdsForUser(userId) {
  const rows = await db('workspace_members').where({ user_id: userId }).select('workspace_id');
  return rows.map((r) => r.workspace_id);
}

module.exports = {
  createPersonalWorkspace,
  findMembership,
  findPersonalWorkspaceForUser,
  listWorkspaceIdsForUser,
};
