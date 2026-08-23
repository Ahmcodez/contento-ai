const workspaceRepository = require('../repositories/workspace.repository');

/**
 * Resolves the set of workspace ids a user belongs to. Every ownership
 * check downstream (projects, media, jobs) is scoped through this list —
 * see docs/SECURITY.md §2.
 */
async function getWorkspaceIdsForUser(userId) {
  return workspaceRepository.listWorkspaceIdsForUser(userId);
}

async function getPersonalWorkspace(userId) {
  return workspaceRepository.findPersonalWorkspaceForUser(userId);
}

module.exports = { getWorkspaceIdsForUser, getPersonalWorkspace };
