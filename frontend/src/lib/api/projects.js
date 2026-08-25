import { apiRequest } from './client';

export async function listProjects({ status, page, pageSize } = {}) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (page) params.set('page', page);
  if (pageSize) params.set('pageSize', pageSize);
  const query = params.toString() ? `?${params.toString()}` : '';
  return apiRequest(`/api/v1/projects${query}`);
}

export async function getProject(projectId) {
  const data = await apiRequest(`/api/v1/projects/${projectId}`);
  return data.project;
}

export async function createProject({ title, description }) {
  const data = await apiRequest('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({ title, description }),
  });
  return data.project;
}

export async function updateProject(projectId, fields) {
  const data = await apiRequest(`/api/v1/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  });
  return data.project;
}

export async function archiveProject(projectId) {
  await apiRequest(`/api/v1/projects/${projectId}`, { method: 'DELETE' });
}
