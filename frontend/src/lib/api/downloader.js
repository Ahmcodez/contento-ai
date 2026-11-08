import { apiRequest, API_BASE } from './client';

/**
 * The public video downloader: no account, no login. Looks a link up and returns what can be
 * downloaded: { provider, title, thumbnailUrl, durationSeconds, options: [{ id, label, kind, approxSizeLabel }] }.
 */
export function fetchVideoInfo(url) {
  return apiRequest('/api/v1/tools/downloader/info', { method: 'POST', body: JSON.stringify({ url }) });
}

/** Starts preparing the chosen format in the background. Resolves { id }. */
export function startDownload(url, optionId) {
  return apiRequest('/api/v1/tools/downloader/jobs', { method: 'POST', body: JSON.stringify({ url, optionId }) });
}

/** { id, state: queued | downloading | ready | failed | expired, filename, sizeBytes, expiresAt, error } */
export function getDownloadStatus(id) {
  return apiRequest(`/api/v1/tools/downloader/jobs/${id}`);
}

/** A plain link the browser can navigate to; the server answers with a download (Content-Disposition: attachment). */
export function downloadFileUrl(id) {
  return `${API_BASE}/api/v1/tools/downloader/jobs/${id}/file`;
}
