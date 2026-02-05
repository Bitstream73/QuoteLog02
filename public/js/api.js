const API = {
  async get(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        isAdmin = false;
        if (typeof updateNav === 'function') updateNav();
        if (typeof navigate === 'function') navigate(null, '/login');
      }
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error.error || `API error: ${res.status}`);
    }
    return res.json();
  },

  async post(path, data) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        isAdmin = false;
        if (typeof updateNav === 'function') updateNav();
        if (typeof navigate === 'function') navigate(null, '/login');
      }
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error.error || `API error: ${res.status}`);
    }
    return res.json();
  },

  async put(path, data) {
    const res = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        isAdmin = false;
        if (typeof updateNav === 'function') updateNav();
        if (typeof navigate === 'function') navigate(null, '/login');
      }
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error.error || `API error: ${res.status}`);
    }
    return res.json();
  },

  async patch(path, data) {
    const res = await fetch(`/api${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        isAdmin = false;
        if (typeof updateNav === 'function') updateNav();
        if (typeof navigate === 'function') navigate(null, '/login');
      }
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error.error || `API error: ${res.status}`);
    }
    return res.json();
  },

  async delete(path) {
    const res = await fetch(`/api${path}`, { method: 'DELETE' });
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/auth/')) {
        isAdmin = false;
        if (typeof updateNav === 'function') updateNav();
        if (typeof navigate === 'function') navigate(null, '/login');
      }
      const error = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(error.error || `API error: ${res.status}`);
    }
    return res.json();
  },

  // Legacy alias
  async del(path) {
    return this.delete(path);
  },

  getExportUrl(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return `/api/logs/export${qs ? '?' + qs : ''}`;
  },
};
