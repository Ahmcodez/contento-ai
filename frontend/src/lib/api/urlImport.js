import { apiRequest } from './client';

/** Kicks off the paste-URL flow: POST returns immediately with state DETECTING_PROVIDER. */
export async function createUrlImport(projectId, url) {
  const data = await apiRequest(`/api/v1/projects/${projectId}/media/url`, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
  return data.mediaImport;
}

/** Polled by useMediaImportStatus while resolving/downloading. */
export async function getUrlImport(mediaImportId) {
  const data = await apiRequest(`/api/v1/media-imports/${mediaImportId}`);
  return data.mediaImport;
}

/** "Import & Analyze" — only valid once the import has reached WAITING_CONFIRMATION. */
export async function confirmUrlImport(mediaImportId) {
  const data = await apiRequest(`/api/v1/media-imports/${mediaImportId}/confirm`, { method: 'POST' });
  return data.mediaImport;
}
