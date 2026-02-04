async function renderSettings() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading settings...</div>';
  try {
    const settings = await API.get('/settings');
    let html = `<p style="margin-bottom:1rem"><a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">&larr; Back to quotes</a></p><h1 class="page-title">Settings</h1><p class="page-subtitle">Application configuration and logs</p><div class="card" style="margin-bottom:2rem"><h3 style="margin-bottom:1rem">Theme</h3><select id="theme-select" onchange="updateTheme(this.value)"><option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option></select></div><div id="logs-section"><div class="section-header"><h2>Application Logs</h2><button class="btn btn-secondary btn-sm" onclick="exportLogs()">Export CSV</button></div><div id="logs-stats"></div><div id="logs-filters"></div><div id="logs-table"></div><div id="logs-pagination"></div></div>`;
    content.innerHTML = html;
    await loadLogsStats(); renderLogsFilters(); await loadLogs();
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`; }
}
async function updateTheme(theme) { try { await API.put('/settings', { theme }); } catch (err) { console.error('Failed:', err); } }
