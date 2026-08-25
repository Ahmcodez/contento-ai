import { apiRequest } from './client';

export async function getUsage() {
  return apiRequest('/api/v1/usage');
}
