// Settings Page - Source Management and Configuration

async function renderSettings() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading settings...</div>';

  try {
    const [settings, sourcesData] = await Promise.all([
      API.get('/settings'),
      API.get('/sources'),
    ]);

    const sources = sourcesData.sources || [];

    let html = `
      <p style="margin-bottom:1rem">
        <a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">&larr; Back to quotes</a>
      </p>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage news sources and application configuration</p>

      <!-- Source Management Section -->
      <div class="settings-section">
        <h2>News Sources</h2>
        <p class="section-description">Add reputable news sources to extract quotes from.</p>

        <div class="add-source-form">
          <input type="text" id="new-source-domain" placeholder="e.g., reuters.com" class="input-text">
          <input type="text" id="new-source-name" placeholder="Display name (optional)" class="input-text">
          <input type="text" id="new-source-rss" placeholder="RSS feed URL (optional, auto-detected)" class="input-text">
          <button class="btn btn-primary" onclick="addSource()">Add Source</button>
        </div>

        <div id="sources-list" class="sources-list">
          ${sources.length === 0 ? `
            <p class="empty-message">No sources configured. Add a news source to start extracting quotes.</p>
          ` : sources.map(s => renderSourceRow(s)).join('')}
        </div>
      </div>

      <!-- Fetch Settings Section -->
      <div class="settings-section">
        <h2>Fetch Settings</h2>

        <div class="setting-row" style="align-items:center">
          <label>
            <span class="setting-label">Next Fetch</span>
            <span class="setting-description" id="scheduler-status">Loading...</span>
          </label>
          <button class="btn btn-primary" id="fetch-now-btn" onclick="fetchNow()">Fetch Now</button>
        </div>

        <div class="setting-row">
          <label>
            <span class="setting-label">Fetch Interval (minutes)</span>
            <span class="setting-description">How often to check for new articles</span>
          </label>
          <input type="number" id="fetch-interval" value="${settings.fetch_interval_minutes || 15}"
                 min="5" max="1440" class="input-number" onchange="updateSetting('fetch_interval_minutes', this.value)">
        </div>

        <div class="setting-row">
          <label>
            <span class="setting-label">Article Lookback (hours)</span>
            <span class="setting-description">Only fetch articles published within this time window</span>
          </label>
          <input type="number" id="article-lookback" value="${settings.article_lookback_hours || 24}"
                 min="1" max="168" class="input-number" onchange="updateSetting('article_lookback_hours', this.value)">
        </div>

        <div class="setting-row">
          <label>
            <span class="setting-label">Max Articles Per Cycle</span>
            <span class="setting-description">Maximum articles to process in each fetch cycle</span>
          </label>
          <input type="number" id="max-articles" value="${settings.max_articles_per_cycle || 100}"
                 min="1" max="1000" class="input-number" onchange="updateSetting('max_articles_per_cycle', this.value)">
        </div>
      </div>

      <!-- Disambiguation Settings Section -->
      <div class="settings-section">
        <h2>Disambiguation Settings</h2>

        <div class="setting-row">
          <label>
            <span class="setting-label">Auto-Merge Confidence Threshold</span>
            <span class="setting-description">Automatically merge names above this confidence (0-1)</span>
          </label>
          <input type="number" id="auto-merge-threshold" value="${settings.auto_merge_confidence_threshold || 0.9}"
                 min="0" max="1" step="0.05" class="input-number" onchange="updateSetting('auto_merge_confidence_threshold', this.value)">
        </div>

        <div class="setting-row">
          <label>
            <span class="setting-label">Review Confidence Threshold</span>
            <span class="setting-description">Add to review queue above this confidence (0-1)</span>
          </label>
          <input type="number" id="review-threshold" value="${settings.review_confidence_threshold || 0.7}"
                 min="0" max="1" step="0.05" class="input-number" onchange="updateSetting('review_confidence_threshold', this.value)">
        </div>

        <div class="setting-row">
          <label>
            <span class="setting-label">Minimum Quote Words</span>
            <span class="setting-description">Discard quotes shorter than this</span>
          </label>
          <input type="number" id="min-quote-words" value="${settings.min_quote_words || 5}"
                 min="1" max="50" class="input-number" onchange="updateSetting('min_quote_words', this.value)">
        </div>
      </div>

      <!-- Appearance Section -->
      <div class="settings-section">
        <h2>Appearance</h2>
        <div class="setting-row">
          <label>
            <span class="setting-label">Theme</span>
          </label>
          <select id="theme-select" onchange="updateSetting('theme', this.value)" class="input-select">
            <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
          </select>
        </div>
      </div>

      <!-- Database Backup Section -->
      <div class="settings-section">
        <h2>Database</h2>
        <p class="section-description">Export and import your database for backup and recovery.</p>

        <div class="setting-row" style="align-items:center">
          <label>
            <span class="setting-label">Export Backup</span>
            <span class="setting-description">Download all data as a JSON file</span>
          </label>
          <button class="btn btn-primary" id="export-db-btn" onclick="exportDatabase()">Export JSON</button>
        </div>

        <div class="setting-row" style="align-items:center">
          <label>
            <span class="setting-label">Import Backup</span>
            <span class="setting-description">Restore from a previously exported JSON file</span>
          </label>
          <div>
            <input type="file" id="import-db-file" accept=".json" style="display:none" onchange="importDatabase(this)">
            <button class="btn btn-secondary" onclick="document.getElementById('import-db-file').click()">Import JSON</button>
          </div>
        </div>

        <div class="setting-row" style="align-items:center">
          <label>
            <span class="setting-label">Backfill Headshots</span>
            <span class="setting-description">Fetch headshot photos from Wikipedia for persons without one</span>
          </label>
          <button class="btn btn-secondary" id="backfill-headshots-btn" onclick="backfillHeadshots()">Backfill Headshots</button>
        </div>
      </div>

      <!-- Logs Section -->
      <div id="logs-section" class="settings-section">
        <div class="section-header">
          <h2>Application Logs</h2>
          <button class="btn btn-secondary btn-sm" onclick="exportLogs()">Export CSV</button>
        </div>
        <div id="logs-stats"></div>
        <div id="logs-filters"></div>
        <div id="logs-table"></div>
        <div id="logs-pagination"></div>
      </div>
    `;

    content.innerHTML = html;

    // Start scheduler countdown
    startSchedulerCountdown();

    // Load logs section
    await loadLogsStats();
    renderLogsFilters();
    await loadLogs();
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderSourceRow(source) {
  return `
    <div class="source-row" data-id="${source.id}">
      <div class="source-info">
        <span class="source-domain">${escapeHtml(source.domain)}</span>
        <span class="source-name">${escapeHtml(source.name || '')}</span>
        ${source.rss_url ? `<span class="source-rss" title="${escapeHtml(source.rss_url)}">RSS</span>` : ''}
        ${source.consecutive_failures > 0 ? `<span class="source-warning" title="${source.consecutive_failures} failures">!</span>` : ''}
      </div>
      <div class="source-actions">
        <label class="toggle">
          <input type="checkbox" ${source.enabled ? 'checked' : ''} onchange="toggleSource(${source.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-danger btn-sm" onclick="removeSource(${source.id})">Remove</button>
      </div>
    </div>
  `;
}

async function addSource() {
  const domainInput = document.getElementById('new-source-domain');
  const nameInput = document.getElementById('new-source-name');
  const rssInput = document.getElementById('new-source-rss');

  const domain = domainInput.value.trim();
  const name = nameInput.value.trim();
  const rss_url = rssInput.value.trim();

  if (!domain) {
    alert('Please enter a domain');
    return;
  }

  try {
    const result = await API.post('/sources', {
      domain,
      name: name || undefined,
      rss_url: rss_url || undefined,
    });

    // Add to list
    const sourcesList = document.getElementById('sources-list');
    const emptyMessage = sourcesList.querySelector('.empty-message');
    if (emptyMessage) emptyMessage.remove();

    sourcesList.insertAdjacentHTML('beforeend', renderSourceRow(result.source));

    // Clear inputs
    domainInput.value = '';
    nameInput.value = '';
    rssInput.value = '';
  } catch (err) {
    alert('Error adding source: ' + err.message);
  }
}

async function toggleSource(sourceId, enabled) {
  try {
    await API.patch(`/sources/${sourceId}`, { enabled });
  } catch (err) {
    alert('Error updating source: ' + err.message);
    // Revert checkbox
    const row = document.querySelector(`.source-row[data-id="${sourceId}"]`);
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.checked = !enabled;
  }
}

async function removeSource(sourceId) {
  if (!confirm('Are you sure you want to remove this source?')) return;

  try {
    await API.delete(`/sources/${sourceId}`);

    // Remove from list
    const row = document.querySelector(`.source-row[data-id="${sourceId}"]`);
    row.remove();

    // Check if list is empty
    const sourcesList = document.getElementById('sources-list');
    if (!sourcesList.querySelector('.source-row')) {
      sourcesList.innerHTML = '<p class="empty-message">No sources configured. Add a news source to start extracting quotes.</p>';
    }
  } catch (err) {
    alert('Error removing source: ' + err.message);
  }
}

async function updateSetting(key, value) {
  try {
    await API.patch('/settings', { [key]: value });
  } catch (err) {
    alert('Error updating setting: ' + err.message);
  }
}

async function updateTheme(theme) {
  try {
    await API.put('/settings', { theme });
  } catch (err) {
    console.error('Failed to update theme:', err);
  }
}

let countdownInterval = null;
let nextCycleTime = null;

async function startSchedulerCountdown() {
  // Clear any existing interval
  if (countdownInterval) clearInterval(countdownInterval);

  try {
    const status = await API.get('/settings/scheduler');
    nextCycleTime = status.nextCycleAt ? new Date(status.nextCycleAt).getTime() : null;

    const btn = document.getElementById('fetch-now-btn');
    if (status.running) {
      btn.disabled = true;
      btn.textContent = 'Fetching...';
    }

    updateCountdownDisplay();
    countdownInterval = setInterval(updateCountdownDisplay, 1000);
  } catch (err) {
    const el = document.getElementById('scheduler-status');
    if (el) el.textContent = 'Unable to load scheduler status';
  }
}

function updateCountdownDisplay() {
  const el = document.getElementById('scheduler-status');
  if (!el) {
    if (countdownInterval) clearInterval(countdownInterval);
    return;
  }

  if (!nextCycleTime) {
    el.textContent = 'No fetch scheduled';
    return;
  }

  const remaining = nextCycleTime - Date.now();
  if (remaining <= 0) {
    el.textContent = 'Fetch starting...';
    // Refresh status after a short delay
    setTimeout(() => startSchedulerCountdown(), 5000);
    return;
  }

  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  el.textContent = `Next fetch in ${mins}m ${secs.toString().padStart(2, '0')}s`;
}

async function fetchNow() {
  const btn = document.getElementById('fetch-now-btn');
  btn.disabled = true;
  btn.textContent = 'Fetching...';

  try {
    await API.post('/settings/fetch-now');
    const el = document.getElementById('scheduler-status');
    if (el) el.textContent = 'Fetch cycle running...';

    // Poll for completion
    const pollInterval = setInterval(async () => {
      try {
        const status = await API.get('/settings/scheduler');
        if (!status.running) {
          clearInterval(pollInterval);
          btn.disabled = false;
          btn.textContent = 'Fetch Now';
          nextCycleTime = status.nextCycleAt ? new Date(status.nextCycleAt).getTime() : null;
          updateCountdownDisplay();
        }
      } catch (e) {
        // ignore polling errors
      }
    }, 3000);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Fetch Now';
    alert('Error: ' + err.message);
  }
}

async function exportDatabase() {
  const btn = document.getElementById('export-db-btn');
  btn.disabled = true;
  btn.textContent = 'Exporting...';

  try {
    const data = await API.get('/admin/backup');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quotelog-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Export JSON';
  }
}

async function backfillHeadshots() {
  const btn = document.getElementById('backfill-headshots-btn');
  btn.disabled = true;
  btn.textContent = 'Backfilling...';

  try {
    const result = await API.post('/admin/backfill-headshots', { limit: 50 });
    alert(`Backfill complete: ${result.found} headshots found out of ${result.processed} persons processed.`);
  } catch (err) {
    alert('Backfill failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Backfill Headshots';
  }
}

async function importDatabase(input) {
  const file = input.files[0];
  if (!file) return;

  if (!confirm('This will REPLACE all current data with the imported backup. Are you sure?')) {
    input.value = '';
    return;
  }

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await API.post('/admin/restore', data);
    alert('Restore complete! Imported: ' + Object.entries(result.imported || {}).map(([k, v]) => `${k}: ${v}`).join(', '));
    // Reload settings page to reflect new data
    renderSettings();
  } catch (err) {
    alert('Import failed: ' + err.message);
  } finally {
    input.value = '';
  }
}
