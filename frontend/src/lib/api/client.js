const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function rawRequest(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include', // sends the httpOnly refresh cookie
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  });
  return res;
}

/**
 * Attempts a silent token refresh exactly once per concurrent burst of
 * 401s (refreshPromise dedupes concurrent callers) rather than firing a
 * refresh request per failed call.
 */
async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = rawRequest('/api/v1/auth/refresh', { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) return null;
        const data = await res.json();
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .catch(() => null)
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

/**
 * The one function every API module calls through. Handles: JSON
 * encoding, auth header, a single transparent refresh-and-retry on 401,
 * and normalizing every failure into an ApiError with the server's real
 * error code/message — nothing here invents a response shape the backend
 * doesn't actually return.
 */
export async function apiRequest(path, options = {}) {
  let res = await rawRequest(path, options);

  if (res.status === 401 && !options._retried) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      res = await rawRequest(path, options);
    }
  }

  if (!res.ok) {
    let body = null;
    try {
      body = await res.json();
    } catch {
      // response had no JSON body — fall through with a generic message
    }
    throw new ApiError(body?.error?.message || `Request failed (${res.status})`, {
      status: res.status,
      code: body?.error?.code,
      details: body?.error?.details,
    });
  }

  if (res.status === 204) return null;

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return res;
}

export { ApiError, API_BASE };
