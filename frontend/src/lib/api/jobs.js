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

/**
 * Resumes a FAILED job from the stage it failed in (finished work isn't redone).
 * Rejects with an ApiError: 409 NOT_RETRYABLE (not failed, or the video was
 * rejected at validation), 429 if the account is at its concurrent-job limit.
 */
export async function retryJob(jobId) {
  return apiRequest(`/api/v1/jobs/${jobId}/retry`, { method: 'POST' });
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
