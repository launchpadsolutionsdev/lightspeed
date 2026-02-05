const API_BASE_URL =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001'
    : 'https://lightspeed-backend.onrender.com';

export { API_BASE_URL };

export function getAuthHeaders() {
  const token = localStorage.getItem('authToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function apiRequest(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...getAuthHeaders(),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));

    if (error.code === 'TRIAL_LIMIT_REACHED') {
      const err = new Error('LIMIT_REACHED');
      err.code = 'TRIAL_LIMIT_REACHED';
      err.usageCount = error.usageCount;
      err.limit = error.limit;
      throw err;
    }
    if (error.code === 'TRIAL_EXPIRED') {
      const err = new Error('TRIAL_EXPIRED');
      err.code = 'TRIAL_EXPIRED';
      throw err;
    }
    if (error.code === 'AUTH_REQUIRED' || response.status === 401) {
      const err = new Error('AUTH_REQUIRED');
      err.code = 'AUTH_REQUIRED';
      throw err;
    }

    throw new Error(error.error || error.message || 'API request failed. Please try again.');
  }

  return response.json();
}

export async function apiPost(path, body) {
  return apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function apiPatch(path, body) {
  return apiRequest(path, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function apiPut(path, body) {
  return apiRequest(path, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export async function apiDelete(path) {
  return apiRequest(path, { method: 'DELETE' });
}
