import { apiRequest, setAccessToken } from './client';

export async function register({ email, password, name }) {
  const data = await apiRequest('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
  setAccessToken(data.accessToken);
  return data.user;
}

export async function login({ email, password }) {
  const data = await apiRequest('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setAccessToken(data.accessToken);
  return data.user;
}

export async function logout() {
  await apiRequest('/api/v1/auth/logout', { method: 'POST' });
  setAccessToken(null);
}

export async function fetchMe() {
  const data = await apiRequest('/api/v1/auth/me');
  return data.user;
}

// NOTE: the backend has no "forgot password" endpoint yet. The signup
// brief asked for one "if supported" — it isn't, so the UI must say so
// rather than pretend to send a reset email. See ForgotPasswordPage.
