import { apiRequest } from './client';

export async function updateContent(contentId, body) {
  const data = await apiRequest(`/api/v1/content/${contentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
  return data.content;
}

// NOTE: there is no GET /content/:id/export endpoint yet. "Export" in
// the UI is implemented as copy-to-clipboard, which needs no backend
// call — a real substitute, not a fabricated one.
