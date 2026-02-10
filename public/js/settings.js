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
          <input type="number" id="fetch-interval" value="${settings.fetch_interval_minutes || 5}"
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
            <span class="setting-label">Max Articles per News Source per Cycle</span>
            <span class="setting-description">Maximum articles to process per news source in each fetch cycle</span>
          </label>
          <input type="number" id="max-articles" value="${settings.max_articles_per_source_per_cycle || 10}"
                 min="1" max="1000" class="input-number" onchange="updateSetting('max_articles_per_source_per_cycle', this.value)">
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
          <select id="theme-select" onchange="updateSetting('theme', this.value); applyTheme(this.value)" class="input-select">
            <option value="light" ${(localStorage.getItem('ql-theme') || settings.theme || 'light') === 'light' ? 'selected' : ''}>Light</option>
            <option value="dark" ${(localStorage.getItem('ql-theme') || settings.theme || 'light') === 'dark' ? 'selected' : ''}>Dark</option>
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

      <!-- Quote Management Section -->
      <div class="settings-section">
        <div class="section-header">
          <h2>Quote Management</h2>
          <button class="btn btn-secondary btn-sm" onclick="loadAdminQuotes()">Refresh</button>
        </div>
        <p class="section-description">View, edit, and manage extracted quotes. Click a quote to edit its text or change the associated author headshot.</p>
        <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
          <input type="search" id="admin-quote-search" placeholder="Search quotes, authors..." class="input-text" style="flex:1;width:auto" onkeydown="if(event.key==='Enter')searchAdminQuotes()">
          <button class="btn btn-primary btn-sm" onclick="searchAdminQuotes()">Search</button>
          <button class="btn btn-secondary btn-sm" onclick="clearAdminSearch()">Clear</button>
        </div>
        <div id="admin-quotes-list">
          <div class="loading">Loading quotes...</div>
        </div>
        <div id="admin-quotes-pagination"></div>
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

    // Load admin quotes section
    await loadAdminQuotes();

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
        ${source.consecutive_failures > 0 ? `<span class="source-warning" title="${source.consecutive_failures} failures" style="cursor:pointer" onclick="showSourceErrors('${escapeHtml(source.domain)}', ${source.consecutive_failures})">!</span>` : ''}
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
    showToast('Please enter a domain', 'error');
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
    showToast('Error adding source: ' + err.message, 'error', 5000);
  }
}

async function toggleSource(sourceId, enabled) {
  try {
    await API.patch(`/sources/${sourceId}`, { enabled });
  } catch (err) {
    showToast('Error updating source: ' + err.message, 'error', 5000);
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
    showToast('Error removing source: ' + err.message, 'error', 5000);
  }
}

async function updateSetting(key, value) {
  try {
    await API.patch('/settings', { [key]: value });
  } catch (err) {
    showToast('Error updating setting: ' + err.message, 'error', 5000);
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
    showToast('Error: ' + err.message, 'error', 5000);
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
    showToast('Export failed: ' + err.message, 'error', 5000);
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
    showToast(`Backfill complete: ${result.found} headshots found out of ${result.processed} processed`, 'success', 5000);
  } catch (err) {
    showToast('Backfill failed: ' + err.message, 'error', 5000);
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
    showToast('Restore complete! Imported: ' + Object.entries(result.imported || {}).map(([k, v]) => `${k}: ${v}`).join(', '), 'success', 5000);
    // Reload settings page to reflect new data
    renderSettings();
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error', 5000);
  } finally {
    input.value = '';
  }
}

// ===================================
// Admin Quote Management
// ===================================

let _adminQuotePage = 1;
let _adminQuoteSearch = '';

function searchAdminQuotes() {
  const input = document.getElementById('admin-quote-search');
  _adminQuoteSearch = input ? input.value.trim() : '';
  _adminQuotePage = 1;
  loadAdminQuotes();
}

function clearAdminSearch() {
  _adminQuoteSearch = '';
  const input = document.getElementById('admin-quote-search');
  if (input) input.value = '';
  _adminQuotePage = 1;
  loadAdminQuotes();
}

async function loadAdminQuotes(page) {
  _adminQuotePage = page || _adminQuotePage || 1;
  const container = document.getElementById('admin-quotes-list');
  const paginationEl = document.getElementById('admin-quotes-pagination');
  if (!container) return;

  try {
    let url = `/quotes?page=${_adminQuotePage}&limit=20`;
    if (_adminQuoteSearch) url += `&search=${encodeURIComponent(_adminQuoteSearch)}`;
    const data = await API.get(url);
    if (data.quotes.length === 0) {
      container.innerHTML = '<p class="empty-message">No quotes found.</p>';
      if (paginationEl) paginationEl.innerHTML = '';
      return;
    }

    let html = '';
    for (const q of data.quotes) {
      const dateStr = q.articlePublishedAt
        ? new Date(q.articlePublishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '';
      const createdStr = q.createdAt
        ? new Date(q.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
        : '';
      const initial = (q.personName || '?').charAt(0).toUpperCase();
      const headshotHtml = q.photoUrl
        ? `<img src="${escapeHtml(q.photoUrl)}" class="admin-quote-headshot" onerror="this.style.display='none'">`
        : `<div class="admin-quote-headshot-placeholder">${initial}</div>`;

      const sourceUrls = (q.sourceUrls || []).map(u => {
        try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
      });

      html += `
        <div class="admin-quote-card" id="aqc-${q.id}">
          <div class="admin-quote-top">
            <div class="admin-quote-headshot-col">
              ${headshotHtml}
              <button class="btn btn-secondary btn-sm" onclick="changeHeadshot(${q.personId}, '${escapeHtml(q.personName)}')" style="margin-top:0.25rem;font-size:0.65rem">Photo</button>
            </div>
            <div class="admin-quote-info">
              <div class="admin-quote-text">${escapeHtml(q.text)}</div>
              <div class="admin-quote-meta">
                <strong>${escapeHtml(q.personName)}</strong>
                <span class="badge badge-info" style="font-size:0.6rem">${escapeHtml(q.personCategory || 'Other')}</span>
                ${q.personCategoryContext ? `<span style="font-size:0.75rem;color:var(--text-muted)">${escapeHtml(q.personCategoryContext)}</span>` : ''}
              </div>
              <div class="admin-quote-details">
                ${q.articleTitle ? `<div><strong>Article:</strong> ${escapeHtml(q.articleTitle)}</div>` : ''}
                ${dateStr ? `<div><strong>Published:</strong> ${dateStr}</div>` : ''}
                ${createdStr ? `<div><strong>Extracted:</strong> ${createdStr}</div>` : ''}
                ${q.primarySourceName ? `<div><strong>Source:</strong> ${escapeHtml(q.primarySourceName)}</div>` : ''}
                ${sourceUrls.length > 0 ? `<div><strong>URLs:</strong> ${sourceUrls.map(u => escapeHtml(u)).join(', ')}</div>` : ''}
                ${q.context ? `<div><strong>Context:</strong> ${escapeHtml(q.context)}</div>` : ''}
                <div><strong>Type:</strong> ${q.quoteType || 'direct'} &middot; <strong>Visible:</strong> ${q.isVisible ? 'Yes' : 'No'} &middot; <strong>ID:</strong> ${q.id}</div>
              </div>
              <div class="admin-quote-actions">
                <button class="btn btn-secondary btn-sm" onclick="adminEditQuote(${q.id})">Edit Text</button>
                <button class="btn btn-secondary btn-sm" onclick="adminEditContext(${q.id})">Edit Context</button>
                <button class="btn btn-secondary btn-sm" onclick="adminToggleVisibility(${q.id}, ${!q.isVisible})">${q.isVisible ? 'Hide' : 'Show'}</button>
                <button class="btn btn-secondary btn-sm" onclick="adminEditCategory(${q.personId}, '${escapeHtml(q.personName)}')">Category</button>
                <button class="btn btn-secondary btn-sm" onclick="adminEditAuthor(${q.personId}, '${escapeHtml(q.personName)}')">Edit Author</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = html;

    // Pagination
    if (data.totalPages > 1 && paginationEl) {
      let pHtml = '<div class="pagination">';
      for (let i = 1; i <= Math.min(data.totalPages, 10); i++) {
        pHtml += `<button class="page-btn ${i === _adminQuotePage ? 'active' : ''}" onclick="loadAdminQuotes(${i})">${i}</button>`;
      }
      if (data.totalPages > 10) {
        pHtml += `<span class="pagination-ellipsis">...</span>`;
        pHtml += `<button class="page-btn" onclick="loadAdminQuotes(${data.totalPages})">${data.totalPages}</button>`;
      }
      pHtml += '</div>';
      paginationEl.innerHTML = pHtml;
    } else if (paginationEl) {
      paginationEl.innerHTML = '';
    }
  } catch (err) {
    container.innerHTML = `<p class="empty-message">Error loading quotes: ${escapeHtml(err.message)}</p>`;
  }
}

async function adminEditQuote(quoteId) {
  const newText = prompt('Edit quote text:');
  if (newText === null || newText.trim() === '') return;

  try {
    await API.patch(`/quotes/${quoteId}`, { text: newText.trim() });
    loadAdminQuotes(_adminQuotePage);
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminEditContext(quoteId) {
  const newContext = prompt('Edit context:');
  if (newContext === null) return;

  try {
    await API.patch(`/quotes/${quoteId}`, { context: newContext.trim() || null });
    loadAdminQuotes(_adminQuotePage);
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminToggleVisibility(quoteId, newVisible) {
  try {
    await API.patch(`/quotes/${quoteId}/visibility`, { isVisible: newVisible });
    loadAdminQuotes(_adminQuotePage);
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function changeHeadshot(personId, personName) {
  const newUrl = prompt(`Enter new headshot URL for ${personName}:`, '');
  if (newUrl === null) return;

  try {
    await API.patch(`/authors/${personId}`, { photoUrl: newUrl.trim() || null });
    loadAdminQuotes(_adminQuotePage);
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function adminEditAuthor(personId, personName) {
  const newName = prompt(`Edit author name for "${personName}":`, personName);
  if (newName === null) return;

  const newDisambiguation = prompt(`Edit description/disambiguation for "${newName || personName}" (leave blank to clear):`, '');

  const updates = {};
  if (newName !== null && newName.trim() !== '' && newName.trim() !== personName) {
    updates.canonicalName = newName.trim();
  }
  if (newDisambiguation !== null) {
    updates.disambiguation = newDisambiguation.trim() || null;
  }

  if (Object.keys(updates).length === 0) return;

  try {
    await API.patch(`/authors/${personId}`, updates);
    loadAdminQuotes(_adminQuotePage);
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function showSourceErrors(domain, failureCount) {
  const modalContent = document.getElementById('modal-content');
  const modalOverlay = document.getElementById('modal-overlay');
  modalContent.innerHTML = '<div class="loading">Loading error logs...</div>';
  modalOverlay.classList.remove('hidden');

  try {
    const data = await API.get(`/logs?search=${encodeURIComponent(domain)}&level=error&limit=20`);
    const logs = data.logs || [];

    let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
      <h3>Errors for ${escapeHtml(domain)}</h3>
      <button class="btn btn-secondary btn-sm" onclick="closeModal()">Close</button>
    </div>`;
    html += `<p style="color:var(--text-muted);font-size:0.85rem;margin-bottom:1rem">${failureCount} consecutive failure${failureCount !== 1 ? 's' : ''}</p>`;

    if (logs.length === 0) {
      html += '<p style="color:var(--text-muted)">No error logs found for this source.</p>';
    } else {
      for (const log of logs) {
        const time = new Date(log.timestamp).toLocaleString();
        const details = log.details ? JSON.parse(log.details) : {};
        html += `
          <div style="border-bottom:1px solid var(--border);padding:0.75rem 0">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.25rem">
              <span class="badge badge-${log.level}">${log.level}</span>
              <span style="font-size:0.8rem;color:var(--text-muted)">${time}</span>
            </div>
            <div style="font-family:var(--font-ui);font-size:0.85rem;margin-bottom:0.25rem"><strong>${escapeHtml(log.action)}</strong></div>
            ${log.error ? `<div style="color:var(--error);font-size:0.85rem;margin-bottom:0.25rem">${escapeHtml(log.error)}</div>` : ''}
            <div class="json-view" style="font-size:0.75rem;max-height:150px;overflow-y:auto">${JSON.stringify(details, null, 2)}</div>
          </div>
        `;
      }
    }

    html += `<div style="text-align:right;margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border)"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>`;
    modalContent.innerHTML = html;
  } catch (err) {
    modalContent.innerHTML = `<p style="color:var(--error)">Error loading logs: ${escapeHtml(err.message)}</p><div style="text-align:right;margin-top:1rem"><button class="btn btn-secondary" onclick="closeModal()">Close</button></div>`;
  }
}

async function adminEditCategory(personId, personName) {
  const categories = ['Politician', 'Government Official', 'Business Leader', 'Entertainer', 'Athlete', 'Pundit', 'Journalist', 'Scientist/Academic', 'Legal/Judicial', 'Military/Defense', 'Activist/Advocate', 'Religious Leader', 'Other'];
  const category = prompt(`Select category for ${personName}:\n${categories.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nEnter number or category name:`);
  if (category === null) return;

  let selectedCategory = category.trim();
  const num = parseInt(selectedCategory);
  if (num >= 1 && num <= categories.length) {
    selectedCategory = categories[num - 1];
  }

  if (!categories.includes(selectedCategory)) {
    showToast('Invalid category. Please choose from the list.', 'error');
    return;
  }

  const context = prompt(`Enter category context for ${personName} (e.g., party/office, team/sport):`, '');

  try {
    await API.patch(`/authors/${personId}`, {
      category: selectedCategory,
      categoryContext: context ? context.trim() : null,
    });
    loadAdminQuotes(_adminQuotePage);
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}
