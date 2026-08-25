const AppError = require('../utils/AppError');
const projectRepository = require('../repositories/project.repository');
const workspaceService = require('./workspace.service');

async function createProject(userId, { title, description }) {
  const workspace = await workspaceService.getPersonalWorkspace(userId);
  if (!workspace) {
    throw AppError.internal('No workspace found for user');
  }
  return projectRepository.create({ workspaceId: workspace.id, title, description, createdBy: userId });
}

async function listProjects(userId, { status, page, pageSize }) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  if (workspaceIds.length === 0) return { rows: [], total: 0, page: page || 1, pageSize: pageSize || 20 };

  const { rows, total } = await projectRepository.listForWorkspaces(workspaceIds, {
    status,
    page: page || 1,
    pageSize: pageSize || 20,
  });
  return { rows, total, page: page || 1, pageSize: pageSize || 20 };
}

async function getProject(userId, projectId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const project = await projectRepository.findByIdForWorkspaces(projectId, workspaceIds);
  // 404, not 403, on a resource that exists but isn't owned by the caller
  // — avoids confirming existence to someone without access.
  if (!project) throw AppError.notFound('Project not found');
  return project;
}

async function updateProject(userId, projectId, fields) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const project = await projectRepository.updateByIdForWorkspaces(projectId, workspaceIds, fields);
  if (!project) throw AppError.notFound('Project not found');
  return project;
}

async function archiveProject(userId, projectId) {
  const workspaceIds = await workspaceService.getWorkspaceIdsForUser(userId);
  const project = await projectRepository.archiveByIdForWorkspaces(projectId, workspaceIds);
  if (!project) throw AppError.notFound('Project not found');
  return project;
}

module.exports = { createProject, listProjects, getProject, updateProject, archiveProject };
