import { API_BASE, getAccessToken, ApiError, apiRequest } from './client';

/**
 * The shared apiRequest() helper uses fetch(), which has no upload
 * progress event — so the upload specifically uses XMLHttpRequest
 * instead, the only way to get real byte-level progress in the browser.
 * Every other API call still goes through apiRequest().
 */
export function uploadVideo(projectId, file, { onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/v1/projects/${projectId}/media`);
    xhr.withCredentials = true;
    const token = getAccessToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      let body = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // no JSON body
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body);
      } else {
        reject(
          new ApiError(body?.error?.message || `Upload failed (${xhr.status})`, {
            status: xhr.status,
            code: body?.error?.code,
            details: body?.error?.details,
          }),
        );
      }
    };

    xhr.onerror = () => reject(new ApiError('Upload failed — check your connection', { status: 0 }));
    xhr.onabort = () => reject(new ApiError('Upload cancelled', { status: 0, code: 'CANCELLED' }));

    if (signal) {
      signal.addEventListener('abort', () => xhr.abort());
    }

    const formData = new FormData();
    formData.append('video', file);
    xhr.send(formData);
  });
}

export async function getMediaAsset(mediaAssetId) {
  const data = await apiRequest(`/api/v1/media/${mediaAssetId}`);
  return data.mediaAsset;
}
