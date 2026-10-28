import { API_BASE, getAccessToken, apiRequest } from './client';

/**
 * Clip download has no JSON API wrapper — it streams the file directly
 * (backend/src/controllers/clip.controller.js). The browser handles the
 * download via a real navigation/anchor click carrying the auth header
 * isn't possible for a plain link, so this fetches as a blob and
 * triggers a client-side download instead.
 */
export async function downloadClip(clipCandidateId, filename = 'clip.mp4') {
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}/api/v1/clips/${clipCandidateId}/download`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // no JSON body
    }
    throw new Error(body?.error?.message || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Asks for short-lived signed links to play a clip in the page. A <video> can't send our
 * Authorization header, so the server checks the logged-in user here and hands back links
 * the player can load directly: { streamUrl, posterUrl, expiresAt }.
 */
export async function getClipPlayback(clipCandidateId) {
  const playback = await apiRequest(`/api/v1/clips/${clipCandidateId}/playback`, { method: 'POST' });
  return {
    streamUrl: `${API_BASE}${playback.streamUrl}`,
    posterUrl: playback.posterUrl ? `${API_BASE}${playback.posterUrl}` : null,
    expiresAt: playback.expiresAt,
  };
}

// NOTE: there is no PATCH /clips/:id (manual bound editing) or
// POST /clips/:id/render (manual re-render) endpoint yet — rendering
// happens automatically as part of the pipeline. The clip detail view
// surfaces this rather than showing edit controls that don't do anything.
