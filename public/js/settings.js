// Settings Page - Source Management and Configuration

async function renderSettings() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading settings...</div>';

  try {
    const [settings, sourcesData, promptsData, noteworthyData, keywordsData] = await Promise.all([
      API.get('/settings'),
      API.get('/sources'),
      API.get('/settings/prompts').catch(() => ({ prompts: [] })),
      API.get('/admin/noteworthy').catch(() => ({ items: [] })),
      API.get('/admin/keywords').catch(() => ({ keywords: [] })),
    ]);

    const sources = sourcesData.sources || [];
    const prompts = promptsData.prompts || [];
    const noteworthyItems = noteworthyData.items || [];
    const keywords = keywordsData.keywords || [];

    let html = `
      <p style="margin-bottom:1rem">
        <a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">&larr; Back to quotes</a>
      </p>
      <h1 class="page-title">Settings</h1>
      <p class="page-subtitle">Manage news sources and application configuration</p>

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

      <!-- Prompts Section -->
      <div class="settings-section" id="settings-section-prompts">
        <h2>AI Prompts</h2>
        <p class="section-description">Manage Gemini prompt templates used for quote extraction and fact-checking. Edit the template text to customize AI behavior.</p>
        <div id="settings-prompts-list">
          ${prompts.length === 0 ? '<p class="empty-message">No prompts configured.</p>' : prompts.map(p => renderSettingsPromptCard(p)).join('')}
        </div>
      </div>

      <!-- Historical Sources Section -->
      <div class="settings-section" id="settings-section-historical">
        <h2>Historical Sources</h2>
        <p class="section-description">
          Configure historical quote sources for backfilling quotes from the past.
          Each provider fetches articles from a different archive.
        </p>

        <div class="setting-row" style="align-items:center">
          <label>
            <span class="setting-label">Historical Backfill</span>
            <span class="setting-description">Enable/disable historical fetching during each cycle</span>
          </label>
          <label class="toggle">
            <input type="checkbox" ${settings.historical_fetch_enabled === '1' ? 'checked' : ''}
                   onchange="updateSetting('historical_fetch_enabled', this.checked ? '1' : '0')">
            <span class="toggle-slider"></span>
          </label>
        </div>

        <div class="setting-row">
          <label>
            <span class="setting-label">Articles per Source per Cycle</span>
            <span class="setting-description">Max historical articles to fetch from each provider per cycle</span>
          </label>
          <input type="number" value="${settings.historical_articles_per_source_per_cycle || 5}"
                 min="1" max="100" class="input-number"
                 onchange="updateSetting('historical_articles_per_source_per_cycle', this.value)">
        </div>

        <div id="historical-sources-list" class="sources-list">
          <p class="empty-message">Loading historical sources...</p>
        </div>
      </div>

      <!-- Data Management Section -->
      <div class="settings-section">
        <h2>Data Management</h2>

        <!-- News Sources Subsection -->
        <div class="settings-subsection">
          <h3 class="subsection-title">News Sources</h3>
          <p class="section-description">Add reputable news sources to extract quotes from.</p>

          <div class="add-source-form">
            <input type="text" id="new-source-domain" placeholder="e.g., reuters.com" class="input-text">
            <input type="text" id="new-source-name" placeholder="Display name (optional)" class="input-text">
            <input type="text" id="new-source-rss" placeholder="RSS feed URL (optional, auto-detected)" class="input-text">
            <button class="btn btn-primary" onclick="addSource()">Add Source</button>
          </div>

          <details class="sources-details">
            <summary>Sources (${sources.length})</summary>
            <div id="sources-list" class="sources-list">
              ${sources.length === 0 ? `
                <p class="empty-message">No sources configured. Add a news source to start extracting quotes.</p>
              ` : sources.map(s => renderSourceRow(s)).join('')}
            </div>
          </details>
        </div>

        <!-- Backup & Restore Subsection -->
        <div class="settings-subsection">
          <h3 class="subsection-title">Backup &amp; Restore</h3>
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
        </div>

        <!-- Backfill Headshots Subsection -->
        <div class="settings-subsection">
          <h3 class="subsection-title">Backfill Headshots</h3>
          <div class="setting-row" style="align-items:center">
            <label>
              <span class="setting-label">Fetch Missing Photos</span>
              <span class="setting-description">Fetch headshot photos from Wikipedia for persons without one</span>
            </label>
            <button class="btn btn-secondary" id="backfill-headshots-btn" onclick="backfillHeadshots()">Backfill Headshots</button>
          </div>
        </div>

        <!-- Quote Quality Purge Subsection -->
        <div class="settings-subsection">
          <h3 class="subsection-title">Quote Quality Purge</h3>
          <p class="setting-description" style="margin-bottom:12px">Classify existing quotes using AI and permanently delete opinions (B) and platitudes (C), keeping only verifiable facts (A). Hidden quotes are deleted immediately. Multiple runs may be needed for large databases.</p>
          <div class="setting-row" style="align-items:center; gap:8px">
            <button class="btn btn-secondary" id="purge-preview-btn" onclick="runPurgeQuality(true)">Preview</button>
            <button class="btn btn-danger" id="purge-execute-btn" onclick="runPurgeQuality(false)">Purge Now</button>
          </div>
          <div id="purge-quality-results" style="display:none; margin-top:12px; padding:12px; background:var(--bg-secondary); border-radius:8px; font-size:0.9rem"></div>
        </div>
      </div>

      <!-- Noteworthy Section -->
      <div class="settings-section" id="settings-section-noteworthy">
        <h2>Noteworthy</h2>
        <p class="section-description">Manage items displayed in the Noteworthy section on the homepage. Add quotes, topics, or articles that deserve special attention.</p>

        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title">Add Noteworthy Item</h3>
          </div>
          <div class="noteworthy-add-form">
            <select id="noteworthy-type" class="input-select" style="width:auto;min-width:120px">
              <option value="quote">Quote</option>
              <option value="topic">Topic</option>
              <option value="article">Article</option>
            </select>
            <input type="text" id="noteworthy-search" class="input-text" placeholder="Search by name or ID..." style="flex:1">
            <button class="btn btn-primary btn-sm" onclick="noteworthySearch()">Search</button>
          </div>
          <div id="noteworthy-search-results" class="noteworthy-search-results"></div>
        </div>

        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title">Current Items (${noteworthyItems.length})</h3>
          </div>
          <div id="noteworthy-items-list" class="topics-keywords-list">
            ${noteworthyItems.length === 0 ? '<p class="empty-message">No noteworthy items. Add quotes, topics, or articles above.</p>' : noteworthyItems.map(item => renderNoteworthyRow(item)).join('')}
          </div>
        </div>
      </div>

      <!-- Keywords Section -->
      <div class="settings-section" id="settings-section-keywords">
        <h2>Keywords</h2>
        <p class="section-description">Manage keywords used for quote classification. Keywords can have aliases for flexible matching.</p>

        <div class="settings-subsection">
          <h3 class="subsection-title">Add Keyword</h3>
          <div class="keyword-add-form">
            <input type="text" id="new-keyword-name" placeholder="Keyword name" class="input-text">
            <input type="text" id="new-keyword-aliases" placeholder="Aliases (comma-separated, optional)" class="input-text" style="flex:1">
            <button class="btn btn-primary" onclick="addKeyword()">Add</button>
          </div>
        </div>

        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title" id="keywords-count-title">Keywords (${keywords.length})</h3>
            <input type="text" id="keywords-filter" placeholder="Filter keywords..." class="input-text" style="width:180px" oninput="filterKeywords()">
          </div>
          <div id="keywords-list" class="topics-keywords-list">
            ${renderKeywords(keywords)}
          </div>
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

    // Load historical sources
    loadHistoricalSources();

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
        <label class="top-story-label" title="Include in Top Stories">
          <input type="checkbox" ${source.is_top_story ? 'checked' : ''} onchange="toggleTopStory(${source.id}, this.checked)">
          <span class="top-story-label-text">Top</span>
        </label>
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

    // Update summary count
    updateSourcesSummaryCount();

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

async function toggleTopStory(sourceId, isTopStory) {
  try {
    await API.patch(`/sources/${sourceId}`, { is_top_story: isTopStory ? 1 : 0 });
    showToast(isTopStory ? 'Source marked as top story' : 'Source removed from top stories', 'success');
  } catch (err) {
    showToast('Error updating source: ' + err.message, 'error', 5000);
    // Revert checkbox
    const row = document.querySelector(`.source-row[data-id="${sourceId}"]`);
    const checkbox = row.querySelector('.top-story-label input[type="checkbox"]');
    if (checkbox) checkbox.checked = !isTopStory;
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

    // Update summary count
    updateSourcesSummaryCount();
  } catch (err) {
    showToast('Error removing source: ' + err.message, 'error', 5000);
  }
}

function updateSourcesSummaryCount() {
  const sourcesList = document.getElementById('sources-list');
  const summary = document.querySelector('.sources-details summary');
  if (summary && sourcesList) {
    const count = sourcesList.querySelectorAll('.source-row').length;
    summary.textContent = `Sources (${count})`;
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

async function runPurgeQuality(dryRun) {
  if (!dryRun) {
    showConfirmToast('This will permanently delete all non-factual quotes. Continue?', () => executePurge(false));
    return;
  }
  await executePurge(true);
}

async function executePurge(dryRun) {
  const btn = document.getElementById(dryRun ? 'purge-preview-btn' : 'purge-execute-btn');
  const resultsDiv = document.getElementById('purge-quality-results');
  btn.disabled = true;
  btn.textContent = dryRun ? 'Previewing...' : 'Purging...';

  try {
    const result = await API.post('/admin/purge-quality', { dry_run: dryRun, batch_size: 10 });
    resultsDiv.style.display = 'block';
    const p1 = result.phase1 || {};
    const p2 = result.phase2 || {};
    resultsDiv.innerHTML = `
      <strong>${dryRun ? 'Preview' : 'Purge Complete'}</strong><br>
      <strong>Phase 1 — Hidden quotes:</strong> ${p1.invisible_found || 0} found, ${p1.deleted || 0} deleted<br>
      <strong>Phase 2 — AI Classification:</strong> ${p2.classified || 0} classified (A: ${p2.breakdown?.category_A || 0}, B: ${p2.breakdown?.category_B || 0}, C: ${p2.breakdown?.category_C || 0})<br>
      B+C pending deletion: ${p2.pending_deletion || 0}, deleted: ${p2.deleted || 0}<br>
      ${p2.remaining_unclassified > 0 ? `<em>${p2.remaining_unclassified} quotes still unclassified — run again to continue</em><br>` : ''}
      ${!dryRun ? `Pinecone cleaned: ${result.pinecone_deleted || 0}` : ''}
      ${result.pinecone_error ? `<br><span style="color:var(--danger)">Pinecone error: ${escapeHtml(result.pinecone_error)}</span>` : ''}
    `;
    showToast(dryRun ? 'Preview complete' : `Purge complete: ${(p1.deleted || 0) + (p2.deleted || 0)} quotes deleted`, dryRun ? 'info' : 'success', 5000);
  } catch (err) {
    showToast('Purge failed: ' + err.message, 'error', 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = dryRun ? 'Preview' : 'Purge Now';
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

function renderHistoricalSourceRow(source) {
  const statusClass = source.status === 'working' ? 'status-dot-working'
    : source.status === 'failed' ? 'status-dot-failed'
    : 'status-dot-disabled';
  const statusLabel = source.status === 'working' ? 'Working'
    : source.status === 'failed' ? 'Failed'
    : source.status === 'disabled' ? 'Disabled'
    : 'Unknown';

  return `
    <div class="source-row historical-source-row" data-key="${escapeHtml(source.provider_key)}">
      <div class="source-info">
        <span class="status-dot ${statusClass}" title="${statusLabel}"></span>
        <div>
          <span class="source-domain">${escapeHtml(source.name)}</span>
          <span class="source-name">${escapeHtml(source.description || '')}</span>
          ${source.last_error ? `<span class="source-warning" title="${escapeHtml(source.last_error)}">!</span>` : ''}
        </div>
      </div>
      <div class="source-actions">
        <span class="historical-stat">${source.total_articles_fetched} articles</span>
        <button class="btn btn-secondary btn-sm"
                onclick="testHistoricalSource('${escapeHtml(source.provider_key)}')"
                id="test-btn-${escapeHtml(source.provider_key)}">Test</button>
        <label class="toggle">
          <input type="checkbox" ${source.enabled ? 'checked' : ''}
                 onchange="toggleHistoricalSource('${escapeHtml(source.provider_key)}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    </div>
  `;
}

async function loadHistoricalSources() {
  try {
    const data = await API.get('/historical-sources');
    const list = document.getElementById('historical-sources-list');
    if (list) {
      list.innerHTML = data.sources.length === 0
        ? '<p class="empty-message">No historical sources configured.</p>'
        : data.sources.map(s => renderHistoricalSourceRow(s)).join('');
    }
  } catch (err) {
    console.error('Failed to load historical sources:', err);
  }
}

async function toggleHistoricalSource(key, enabled) {
  try {
    await API.patch(`/historical-sources/${key}`, { enabled });
    showToast(enabled ? 'Historical source enabled' : 'Historical source disabled', 'success');
    await loadHistoricalSources();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
    await loadHistoricalSources();
  }
}

async function testHistoricalSource(key) {
  const btn = document.getElementById(`test-btn-${key}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Testing...'; }
  try {
    const result = await API.post(`/historical-sources/${key}/test`);
    showToast(result.message, result.success ? 'success' : 'error', 5000);
    await loadHistoricalSources();
  } catch (err) {
    showToast('Test failed: ' + err.message, 'error', 5000);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Test'; }
  }
}

// ======= Noteworthy Section =======

function renderNoteworthyRow(item) {
  const typeIcon = item.entity_type === 'quote' ? '\u201C\u201D' : item.entity_type === 'topic' ? '#' : '\uD83D\uDCF0';
  const label = item.entity_label || `${item.entity_type} #${item.entity_id}`;
  return `
    <div class="tk-row" data-noteworthy-id="${item.id}">
      <div class="tk-row__info">
        <span class="tk-row__type">${typeIcon} ${escapeHtml(item.entity_type)}</span>
        <span class="tk-row__name">${escapeHtml(label)}</span>
        <span class="tk-row__stats">Order: ${item.display_order || 0}</span>
      </div>
      <div class="tk-row__actions">
        <button class="btn btn-secondary btn-sm" onclick="noteworthyMoveUp(${item.id})" title="Move up">\u2191</button>
        <button class="btn btn-secondary btn-sm" onclick="noteworthyMoveDown(${item.id})" title="Move down">\u2193</button>
        <button class="btn btn-danger btn-sm" onclick="noteworthyRemove(${item.id})">Remove</button>
      </div>
    </div>
  `;
}

async function noteworthySearch() {
  const type = document.getElementById('noteworthy-type').value;
  const query = document.getElementById('noteworthy-search').value.trim();
  const resultsDiv = document.getElementById('noteworthy-search-results');

  if (!query) {
    resultsDiv.innerHTML = '';
    return;
  }

  resultsDiv.innerHTML = '<p class="empty-message">Searching...</p>';

  try {
    let items = [];
    if (type === 'quote') {
      const data = await API.get('/search/unified?q=' + encodeURIComponent(query) + '&limit=10');
      items = (data.quotes || []).map(q => ({
        id: q.id,
        label: (q.text || '').substring(0, 100) + ((q.text || '').length > 100 ? '...' : ''),
        type: 'quote'
      }));
    } else if (type === 'topic') {
      const data = await API.get('/admin/topics');
      items = (data.topics || []).filter(t =>
        t.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10).map(t => ({
        id: t.id,
        label: t.name,
        type: 'topic'
      }));
    } else if (type === 'article') {
      const data = await API.get('/search/unified?q=' + encodeURIComponent(query) + '&limit=10');
      items = (data.articles || []).map(a => ({
        id: a.id,
        label: a.title || 'Untitled',
        type: 'article'
      }));
    }

    if (items.length === 0) {
      resultsDiv.innerHTML = '<p class="empty-message">No results found.</p>';
      return;
    }

    resultsDiv.innerHTML = items.map(item => `
      <div class="noteworthy-search-item" onclick="noteworthyAdd('${escapeHtml(item.type)}', ${item.id})">
        <span class="noteworthy-search-item__label">${escapeHtml(item.label)}</span>
        <button class="btn btn-primary btn-sm">Add</button>
      </div>
    `).join('');
  } catch (err) {
    resultsDiv.innerHTML = `<p class="empty-message">Search error: ${escapeHtml(err.message)}</p>`;
  }
}

async function noteworthyAdd(entityType, entityId) {
  try {
    const list = document.getElementById('noteworthy-items-list');
    const currentCount = list.querySelectorAll('.tk-row').length;
    await API.post('/admin/noteworthy', {
      entity_type: entityType,
      entity_id: entityId,
      display_order: currentCount
    });
    showToast('Added to noteworthy', 'success');
    document.getElementById('noteworthy-search-results').innerHTML = '';
    document.getElementById('noteworthy-search').value = '';
    await refreshNoteworthyList();
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function noteworthyRemove(id) {
  showConfirmToast('Remove this item from noteworthy?', async () => {
    try {
      await API.delete(`/admin/noteworthy/${id}`);
      const row = document.querySelector(`.tk-row[data-noteworthy-id="${id}"]`);
      if (row) row.remove();
      updateNoteworthyCount();
      showToast('Removed from noteworthy', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });
}

async function noteworthyMoveUp(id) {
  const row = document.querySelector(`.tk-row[data-noteworthy-id="${id}"]`);
  if (!row || !row.previousElementSibling || !row.previousElementSibling.classList.contains('tk-row')) return;
  try {
    const prevId = row.previousElementSibling.dataset.noteworthyId;
    const rows = document.querySelectorAll('#noteworthy-items-list .tk-row');
    const ids = Array.from(rows).map(r => parseInt(r.dataset.noteworthyId));
    const idx = ids.indexOf(id);
    if (idx <= 0) return;
    await API.patch(`/admin/noteworthy/${id}`, { display_order: idx - 1 });
    await API.patch(`/admin/noteworthy/${prevId}`, { display_order: idx });
    await refreshNoteworthyList();
  } catch (err) {
    showToast('Error reordering: ' + err.message, 'error');
  }
}

async function noteworthyMoveDown(id) {
  const row = document.querySelector(`.tk-row[data-noteworthy-id="${id}"]`);
  if (!row || !row.nextElementSibling || !row.nextElementSibling.classList.contains('tk-row')) return;
  try {
    const nextId = row.nextElementSibling.dataset.noteworthyId;
    const rows = document.querySelectorAll('#noteworthy-items-list .tk-row');
    const ids = Array.from(rows).map(r => parseInt(r.dataset.noteworthyId));
    const idx = ids.indexOf(id);
    if (idx < 0 || idx >= ids.length - 1) return;
    await API.patch(`/admin/noteworthy/${id}`, { display_order: idx + 1 });
    await API.patch(`/admin/noteworthy/${nextId}`, { display_order: idx });
    await refreshNoteworthyList();
  } catch (err) {
    showToast('Error reordering: ' + err.message, 'error');
  }
}

async function refreshNoteworthyList() {
  try {
    const data = await API.get('/admin/noteworthy');
    const items = data.items || [];
    const list = document.getElementById('noteworthy-items-list');
    if (list) {
      list.innerHTML = items.length === 0
        ? '<p class="empty-message">No noteworthy items. Add quotes, topics, or articles above.</p>'
        : items.map(item => renderNoteworthyRow(item)).join('');
    }
    updateNoteworthyCount();
  } catch (err) {
    console.error('Failed to refresh noteworthy:', err);
  }
}

function updateNoteworthyCount() {
  const list = document.getElementById('noteworthy-items-list');
  const header = list ? list.closest('.settings-subsection')?.querySelector('.subsection-title') : null;
  if (header && list) {
    const count = list.querySelectorAll('.tk-row').length;
    header.textContent = `Current Items (${count})`;
  }
}

// ======= Prompts Section =======

function renderSettingsPromptCard(prompt) {
  const categoryLabel = prompt.category || 'general';
  const updatedAt = prompt.updated_at ? new Date(prompt.updated_at).toLocaleDateString() : '';
  return `
    <details class="prompt-card" data-prompt-key="${escapeHtml(prompt.prompt_key)}">
      <summary class="prompt-card__summary">
        <span class="prompt-card__name">${escapeHtml(prompt.name)}</span>
        <span class="prompt-card__meta">
          <span class="prompt-card__category">${escapeHtml(categoryLabel)}</span>
          <span class="prompt-card__length">${prompt.template_length || 0} chars</span>
          ${updatedAt ? `<span class="prompt-card__updated">Updated ${updatedAt}</span>` : ''}
        </span>
      </summary>
      <div class="prompt-card__body">
        <p class="prompt-card__desc">${escapeHtml(prompt.description || '')}</p>
        <textarea class="prompt-card__textarea" id="prompt-textarea-${escapeHtml(prompt.prompt_key)}" rows="12" spellcheck="false">Loading...</textarea>
        <div class="prompt-card__actions">
          <button class="btn btn-primary btn-sm" onclick="savePrompt('${escapeHtml(prompt.prompt_key)}')">Save</button>
          <button class="btn btn-secondary btn-sm" onclick="resetPromptToDefault('${escapeHtml(prompt.prompt_key)}')">Reset to Default</button>
        </div>
      </div>
    </details>
  `;
}

// Lazy-load prompt template when details element is opened
document.addEventListener('toggle', async (e) => {
  const details = e.target.closest('.prompt-card');
  if (!details || !details.open) return;
  const key = details.dataset.promptKey;
  const textarea = document.getElementById(`prompt-textarea-${key}`);
  if (!textarea || textarea.dataset.loaded) return;
  try {
    const data = await API.get(`/settings/prompts/${key}`);
    textarea.value = data.prompt?.template || '';
    textarea.dataset.loaded = 'true';
  } catch (err) {
    textarea.value = 'Error loading template: ' + err.message;
  }
}, true);

async function savePrompt(key) {
  const textarea = document.getElementById(`prompt-textarea-${key}`);
  if (!textarea) return;
  const template = textarea.value;
  try {
    await API.put(`/settings/prompts/${key}`, { template });
    showToast('Prompt saved', 'success');
  } catch (err) {
    showToast('Error saving prompt: ' + err.message, 'error');
  }
}

async function resetPromptToDefault(key) {
  showConfirmToast('Reset this prompt to its default template? Your customizations will be lost.', async () => {
    try {
      await API.post(`/settings/prompts/${key}/reset`);
      // Reload the template text
      const textarea = document.getElementById(`prompt-textarea-${key}`);
      if (textarea) {
        const data = await API.get(`/settings/prompts/${key}`);
        textarea.value = data.prompt?.template || '';
      }
      showToast('Prompt reset to default', 'success');
    } catch (err) {
      showToast('Error resetting prompt: ' + err.message, 'error');
    }
  });
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
            <div class="json-view" style="font-size:0.75rem;max-height:150px;overflow-y:auto">${escapeHtml(JSON.stringify(details, null, 2))}</div>
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

// ======= Keywords Section =======

// In-memory cache for keyword list (avoids re-fetch on filter)
let _keywordsCache = [];

function renderKeywords(keywords) {
  _keywordsCache = keywords;
  if (keywords.length === 0) {
    return '<p class="empty-message">No keywords configured. Add a keyword above.</p>';
  }
  return keywords.map(kw => renderKeywordRow(kw)).join('');
}

function renderKeywordRow(kw) {
  return `
    <details class="keyword-card" data-keyword-id="${kw.id}">
      <summary class="keyword-card__summary">
        <div class="keyword-card__info">
          <span class="keyword-card__name" id="keyword-name-${kw.id}">${escapeHtml(kw.name)}</span>
          <span class="keyword-card__stats">${kw.alias_count || 0} aliases &middot; ${kw.quote_count || 0} quotes</span>
        </div>
        <div class="keyword-card__actions" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" onclick="editKeyword(${kw.id})" title="Rename">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteKeyword(${kw.id})" title="Delete">Delete</button>
        </div>
      </summary>
      <div class="keyword-card__body" id="keyword-body-${kw.id}">
        <div class="keyword-aliases-loading">Loading aliases...</div>
      </div>
    </details>
  `;
}

function filterKeywords() {
  const query = (document.getElementById('keywords-filter')?.value || '').toLowerCase().trim();
  const list = document.getElementById('keywords-list');
  if (!list) return;
  const fullCache = _keywordsCache;
  const filtered = query
    ? fullCache.filter(kw => kw.name.toLowerCase().includes(query))
    : fullCache;
  list.innerHTML = filtered.length === 0
    ? '<p class="empty-message">No keywords match filter.</p>'
    : filtered.map(kw => renderKeywordRow(kw)).join('');
  // Don't call renderKeywords here to avoid overwriting the full cache
}

// Lazy-load aliases when keyword card is opened
document.addEventListener('toggle', async (e) => {
  const details = e.target.closest?.('.keyword-card');
  if (!details || !details.open) return;
  const kwId = details.dataset.keywordId;
  const body = document.getElementById(`keyword-body-${kwId}`);
  if (!body || body.dataset.loaded) return;
  try {
    const data = await API.get(`/admin/keywords/${kwId}`);
    const aliases = data.aliases || [];
    body.dataset.loaded = 'true';
    body.innerHTML = renderKeywordAliases(kwId, aliases);
  } catch (err) {
    body.innerHTML = `<p class="empty-message">Error loading aliases: ${escapeHtml(err.message)}</p>`;
  }
}, true);

function renderKeywordAliases(kwId, aliases) {
  let html = '<div class="keyword-aliases-list">';
  if (aliases.length === 0) {
    html += '<p class="empty-message" style="padding:0.5rem 0">No aliases.</p>';
  } else {
    html += aliases.map(a => `
      <span class="keyword-alias-chip" data-alias-id="${a.id}">
        ${escapeHtml(a.alias)}
        <button class="keyword-alias-remove" onclick="deleteAlias(${kwId}, ${a.id})" title="Remove alias">&times;</button>
      </span>
    `).join('');
  }
  html += '</div>';
  html += `
    <div class="keyword-alias-add">
      <input type="text" id="alias-input-${kwId}" placeholder="New alias" class="input-text" style="width:160px"
             onkeydown="if(event.key==='Enter')addAlias(${kwId})">
      <button class="btn btn-secondary btn-sm" onclick="addAlias(${kwId})">Add Alias</button>
    </div>
  `;
  return html;
}

async function addKeyword() {
  const nameInput = document.getElementById('new-keyword-name');
  const aliasesInput = document.getElementById('new-keyword-aliases');
  const name = (nameInput?.value || '').trim();
  const aliasesRaw = (aliasesInput?.value || '').trim();

  if (!name) {
    showToast('Please enter a keyword name', 'error');
    return;
  }

  const aliases = aliasesRaw
    ? aliasesRaw.split(',').map(a => a.trim()).filter(a => a.length > 0)
    : [];

  try {
    await API.post('/admin/keywords', { name, aliases });
    showToast('Keyword added', 'success');
    nameInput.value = '';
    aliasesInput.value = '';
    await reloadKeywords();
  } catch (err) {
    showToast('Error adding keyword: ' + err.message, 'error', 5000);
  }
}

async function editKeyword(id) {
  const nameEl = document.getElementById(`keyword-name-${id}`);
  if (!nameEl) return;
  const currentName = nameEl.textContent;
  const newName = prompt('Rename keyword:', currentName);
  if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

  try {
    await API.put(`/admin/keywords/${id}`, { name: newName.trim() });
    showToast('Keyword renamed', 'success');
    await reloadKeywords();
  } catch (err) {
    showToast('Error renaming keyword: ' + err.message, 'error', 5000);
  }
}

async function deleteKeyword(id) {
  showConfirmToast('Delete this keyword and all its aliases?', async () => {
    try {
      await API.delete(`/admin/keywords/${id}`);
      showToast('Keyword deleted', 'success');
      await reloadKeywords();
    } catch (err) {
      showToast('Error deleting keyword: ' + err.message, 'error', 5000);
    }
  });
}

async function addAlias(keywordId) {
  const input = document.getElementById(`alias-input-${keywordId}`);
  const alias = (input?.value || '').trim();
  if (!alias) {
    showToast('Please enter an alias', 'error');
    return;
  }

  try {
    const data = await API.post(`/admin/keywords/${keywordId}/aliases`, { alias });
    showToast('Alias added', 'success');
    input.value = '';
    // Re-render alias list in the open card
    const body = document.getElementById(`keyword-body-${keywordId}`);
    if (body) {
      const kwData = await API.get(`/admin/keywords/${keywordId}`);
      body.innerHTML = renderKeywordAliases(keywordId, kwData.aliases || []);
    }
    // Update alias count in cache and row
    await reloadKeywords();
  } catch (err) {
    showToast('Error adding alias: ' + err.message, 'error', 5000);
  }
}

async function deleteAlias(keywordId, aliasId) {
  try {
    await API.delete(`/admin/keywords/${keywordId}/aliases/${aliasId}`);
    showToast('Alias removed', 'success');
    // Re-render alias list
    const body = document.getElementById(`keyword-body-${keywordId}`);
    if (body) {
      const kwData = await API.get(`/admin/keywords/${keywordId}`);
      body.innerHTML = renderKeywordAliases(keywordId, kwData.aliases || []);
    }
    await reloadKeywords();
  } catch (err) {
    showToast('Error removing alias: ' + err.message, 'error', 5000);
  }
}

async function reloadKeywords() {
  try {
    const data = await API.get('/admin/keywords');
    const keywords = data.keywords || [];
    _keywordsCache = keywords;
    const list = document.getElementById('keywords-list');
    const filterInput = document.getElementById('keywords-filter');
    const query = (filterInput?.value || '').toLowerCase().trim();
    const filtered = query
      ? keywords.filter(kw => kw.name.toLowerCase().includes(query))
      : keywords;
    if (list) {
      // Preserve which cards are open
      const openIds = new Set();
      list.querySelectorAll('.keyword-card[open]').forEach(d => openIds.add(d.dataset.keywordId));
      list.innerHTML = filtered.length === 0
        ? '<p class="empty-message">No keywords configured. Add a keyword above.</p>'
        : filtered.map(kw => renderKeywordRow(kw)).join('');
      // Re-open previously open cards
      openIds.forEach(kwId => {
        const card = list.querySelector(`.keyword-card[data-keyword-id="${kwId}"]`);
        if (card) card.open = true;
      });
    }
    const title = document.getElementById('keywords-count-title');
    if (title) title.textContent = `Keywords (${keywords.length})`;
  } catch (err) {
    console.error('Failed to reload keywords:', err);
  }
}
