import { apiRequest } from './client';

export async function getJob(jobId) {
  return apiRequest(`/api/v1/jobs/${jobId}`);
}

export async function getJobEvents(jobId) {
  const data = await apiRequest(`/api/v1/jobs/${jobId}/events`);
  return data.data;
}

export async function cancelJob(jobId) {
  return apiRequest(`/api/v1/jobs/${jobId}/cancel`, { method: 'POST' });
}

export async function getTranscript(jobId) {
  // Throws ApiError with code NOT_READY (409) if not transcribed yet —
  // callers should handle that as a normal in-progress state, not an error.
  return apiRequest(`/api/v1/jobs/${jobId}/transcript`);
}

export async function getClips(jobId) {
  const data = await apiRequest(`/api/v1/jobs/${jobId}/clips`);
  return data.data;
}

export async function getContent(jobId) {
  const data = await apiRequest(`/api/v1/jobs/${jobId}/content`);
  return data.data;
}

export async function regenerateContent(jobId, contentType) {
  const data = await apiRequest(`/api/v1/jobs/${jobId}/content/${contentType}/regenerate`, { method: 'POST' });
  return data.content;
}

// NOTE: there is no POST /jobs/:id/retry endpoint yet. A failed job
// cannot currently be retried from the UI — see JobStatusPanel, which
// surfaces this honestly instead of showing a retry button that does
// nothing.
