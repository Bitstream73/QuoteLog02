const API = {
  async get(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  async put(path, data) {
    const res = await fetch(`/api${path}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  async del(path) {
    const res = await fetch(`/api${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
  },
  getExportUrl(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return `/api/logs/export${qs ? '?' + qs : ''}`;
  },
};
