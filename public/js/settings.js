// Settings Page - Source Management and Configuration

async function renderSettings() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading settings...</div>';

  try {
    const [settings, sourcesData, topicsData, keywordsData, promptsData] = await Promise.all([
      API.get('/settings'),
      API.get('/sources'),
      API.get('/admin/topics'),
      API.get('/admin/keywords'),
      API.get('/settings/prompts').catch(() => ({ prompts: [] })),
    ]);

    const sources = sourcesData.sources || [];
    const topics = topicsData.topics || [];
    const keywords = keywordsData.keywords || [];
    const prompts = promptsData.prompts || [];

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
      </div>

      <!-- Topics & Keywords Section -->
      <div class="settings-section" id="settings-section-topics-keywords">
        <h2>Topics &amp; Keywords</h2>
        <p class="section-description">Manage topics and keywords used for quote categorization. Disabled items are excluded from extraction and display.</p>

        <!-- Topics Subsection -->
        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title">Topics (${topics.length})</h3>
            <button class="btn btn-primary btn-sm" onclick="settingsCreateTopic()">New Topic</button>
          </div>
          <div id="settings-topics-list" class="topics-keywords-list">
            ${topics.length === 0 ? '<p class="empty-message">No topics configured yet.</p>' : topics.map(t => renderSettingsTopicRow(t)).join('')}
          </div>
        </div>

        <!-- Keywords Subsection -->
        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title">Keywords (${keywords.length})</h3>
            <button class="btn btn-primary btn-sm" onclick="settingsCreateKeyword()">New Keyword</button>
          </div>
          <div id="settings-keywords-list" class="topics-keywords-list">
            ${keywords.length === 0 ? '<p class="empty-message">No keywords configured yet.</p>' : keywords.map(k => renderSettingsKeywordRow(k)).join('')}
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

    // Load keyword chips for each topic row
    loadSettingsTopicKeywordChips(topics);

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

// ======= Topics & Keywords CRUD for Settings =======

function renderSettingsTopicRow(topic) {
  const enabledClass = topic.enabled ? '' : ' disabled-row';
  return `
    <div class="tk-row${enabledClass}" data-topic-id="${topic.id}">
      <div class="tk-row__info">
        <span class="tk-row__name">${escapeHtml(topic.name)}</span>
        ${topic.description ? `<span class="tk-row__desc">${escapeHtml(topic.description)}</span>` : ''}
        <span class="tk-row__stats">${topic.quote_count || 0} quotes, ${topic.keyword_count || 0} keywords</span>
        <div class="tk-row__keywords" id="settings-topic-keywords-${topic.id}"></div>
      </div>
      <div class="tk-row__actions">
        <label class="toggle" title="${topic.enabled ? 'Enabled' : 'Disabled'}">
          <input type="checkbox" ${topic.enabled ? 'checked' : ''} onchange="settingsToggleTopicEnabled(${topic.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-secondary btn-sm" onclick="settingsEditTopic(${topic.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="settingsDeleteTopic(${topic.id}, '${escapeHtml((topic.name || '').replace(/'/g, "\\'"))}')">Delete</button>
      </div>
    </div>
  `;
}

function renderSettingsKeywordRow(keyword) {
  const enabledClass = keyword.enabled ? '' : ' disabled-row';
  const typeLabel = keyword.keyword_type || 'concept';
  return `
    <div class="tk-row${enabledClass}" data-keyword-id="${keyword.id}">
      <div class="tk-row__info">
        <span class="tk-row__name">${escapeHtml(keyword.name)}</span>
        <span class="tk-row__type">${escapeHtml(typeLabel)}</span>
        <span class="tk-row__stats">${keyword.quote_count || 0} quotes</span>
      </div>
      <div class="tk-row__actions">
        <label class="toggle" title="${keyword.enabled ? 'Enabled' : 'Disabled'}">
          <input type="checkbox" ${keyword.enabled ? 'checked' : ''} onchange="settingsToggleKeywordEnabled(${keyword.id}, this.checked)">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn btn-secondary btn-sm" onclick="settingsEditKeyword(${keyword.id})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="settingsDeleteKeyword(${keyword.id}, '${escapeHtml((keyword.name || '').replace(/'/g, "\\'"))}')">Delete</button>
      </div>
    </div>
  `;
}

function loadSettingsTopicKeywordChips(topics) {
  // Keyword chips are loaded on-demand when the topic section renders.
  // The keyword_count is already shown in the stats span.
  // Individual keyword names are visible on the Review Topics & Keywords page.
}

async function settingsToggleTopicEnabled(topicId, enabled) {
  try {
    await API.put(`/admin/topics/${topicId}`, { enabled });
    const row = document.querySelector(`.tk-row[data-topic-id="${topicId}"]`);
    if (row) row.classList.toggle('disabled-row', !enabled);
    showToast(enabled ? 'Topic enabled' : 'Topic disabled', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    // Revert checkbox
    const row = document.querySelector(`.tk-row[data-topic-id="${topicId}"]`);
    if (row) {
      const cb = row.querySelector('.toggle input');
      if (cb) cb.checked = !enabled;
    }
  }
}

async function settingsToggleKeywordEnabled(keywordId, enabled) {
  try {
    await API.patch(`/admin/keywords/${keywordId}`, { enabled });
    const row = document.querySelector(`.tk-row[data-keyword-id="${keywordId}"]`);
    if (row) row.classList.toggle('disabled-row', !enabled);
    showToast(enabled ? 'Keyword enabled' : 'Keyword disabled', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
    const row = document.querySelector(`.tk-row[data-keyword-id="${keywordId}"]`);
    if (row) {
      const cb = row.querySelector('.toggle input');
      if (cb) cb.checked = !enabled;
    }
  }
}

async function settingsEditTopic(topicId) {
  const row = document.querySelector(`.tk-row[data-topic-id="${topicId}"]`);
  const currentName = row ? row.querySelector('.tk-row__name').textContent : '';
  const newName = prompt('Edit topic name:', currentName);
  if (newName === null || newName.trim() === '' || newName.trim() === currentName) return;
  try {
    const result = await API.put(`/admin/topics/${topicId}`, { name: newName.trim() });
    if (row) {
      const nameEl = row.querySelector('.tk-row__name');
      if (nameEl) nameEl.textContent = result.topic.name;
    }
    showToast('Topic updated', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function settingsEditKeyword(keywordId) {
  const row = document.querySelector(`.tk-row[data-keyword-id="${keywordId}"]`);
  const currentName = row ? row.querySelector('.tk-row__name').textContent : '';
  const newName = prompt('Edit keyword name:', currentName);
  if (newName === null || newName.trim() === '' || newName.trim() === currentName) return;
  try {
    const result = await API.patch(`/admin/keywords/${keywordId}`, { name: newName.trim() });
    if (row) {
      const nameEl = row.querySelector('.tk-row__name');
      if (nameEl) nameEl.textContent = result.keyword.name;
    }
    showToast('Keyword updated', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function settingsDeleteTopic(topicId, topicName) {
  showConfirmToast(`Delete topic "${topicName}"? This removes all quote-topic links.`, async () => {
    try {
      await API.delete(`/admin/topics/${topicId}`);
      const row = document.querySelector(`.tk-row[data-topic-id="${topicId}"]`);
      if (row) row.remove();
      updateSettingsTopicCount();
      showToast('Topic deleted', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });
}

async function settingsDeleteKeyword(keywordId, keywordName) {
  showConfirmToast(`Delete keyword "${keywordName}"? This removes all links.`, async () => {
    try {
      await API.delete(`/admin/keywords/${keywordId}`);
      const row = document.querySelector(`.tk-row[data-keyword-id="${keywordId}"]`);
      if (row) row.remove();
      updateSettingsKeywordCount();
      showToast('Keyword deleted', 'success');
    } catch (err) {
      showToast('Error: ' + err.message, 'error');
    }
  });
}

async function settingsCreateTopic() {
  const name = prompt('New topic name:');
  if (!name || !name.trim()) return;
  try {
    const result = await API.post('/admin/topics', { name: name.trim() });
    const list = document.getElementById('settings-topics-list');
    const emptyMsg = list.querySelector('.empty-message');
    if (emptyMsg) emptyMsg.remove();
    const topic = result.topic;
    topic.keyword_count = 0;
    topic.quote_count = 0;
    topic.enabled = 1;
    list.insertAdjacentHTML('beforeend', renderSettingsTopicRow(topic));
    updateSettingsTopicCount();
    showToast('Topic created', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function settingsCreateKeyword() {
  const name = prompt('New keyword name:');
  if (!name || !name.trim()) return;
  try {
    const result = await API.post('/admin/keywords', { name: name.trim(), keyword_type: 'concept' });
    const list = document.getElementById('settings-keywords-list');
    const emptyMsg = list.querySelector('.empty-message');
    if (emptyMsg) emptyMsg.remove();
    const keyword = result.keyword;
    keyword.quote_count = 0;
    keyword.enabled = 1;
    list.insertAdjacentHTML('beforeend', renderSettingsKeywordRow(keyword));
    updateSettingsKeywordCount();
    showToast('Keyword created', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

function updateSettingsTopicCount() {
  const list = document.getElementById('settings-topics-list');
  const header = list ? list.closest('.settings-subsection')?.querySelector('.subsection-title') : null;
  if (header && list) {
    const count = list.querySelectorAll('.tk-row').length;
    header.textContent = `Topics (${count})`;
  }
}

function updateSettingsKeywordCount() {
  const list = document.getElementById('settings-keywords-list');
  const header = list ? list.closest('.settings-subsection')?.querySelector('.subsection-title') : null;
  if (header && list) {
    const count = list.querySelectorAll('.tk-row').length;
    header.textContent = `Keywords (${count})`;
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
