// Settings Page - Source Management and Configuration

async function renderSettings() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading settings...</div>';

  try {
    const [settings, sourcesData, promptsData, noteworthyData, keywordsData, topicsData, categoriesData, sourceAuthorsData] = await Promise.all([
      API.get('/settings'),
      API.get('/sources'),
      API.get('/settings/prompts').catch(() => ({ prompts: [] })),
      API.get('/admin/noteworthy').catch(() => ({ items: [] })),
      API.get('/admin/keywords').catch(() => ({ keywords: [] })),
      API.get('/admin/topics').catch(() => ({ topics: [] })),
      API.get('/admin/categories').catch(() => ({ categories: [] })),
      API.get('/source-authors').catch(() => ({ sourceAuthors: [] })),
    ]);

    const sources = sourcesData.sources || [];
    const prompts = promptsData.prompts || [];
    const noteworthyItems = noteworthyData.items || [];
    const sourceAuthors = sourceAuthorsData.sourceAuthors || [];
    const keywords = keywordsData.keywords || [];
    const topics = topicsData.topics || [];
    const categories = categoriesData.categories || [];

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

      <!-- Ingest Filters Section -->
      <div class="settings-section">
        <h2>Ingest Filters</h2>
        <p class="section-description">Toggle author categories on/off. Quotes from authors in disabled categories will be silently discarded during ingestion.</p>
        ${(() => {
          const allCategories = ['Politician','Government Official','Business Leader','Entertainer','Athlete','Pundit','Journalist','Scientist/Academic','Legal/Judicial','Military/Defense','Activist/Advocate','Religious Leader','Other'];
          const excluded = (() => { try { return JSON.parse(settings.ingest_filter_excluded_categories || '[]'); } catch { return []; } })();
          return allCategories.map(cat => `
            <div class="setting-row" style="align-items:center">
              <label>
                <span class="setting-label">${cat}</span>
              </label>
              <label class="toggle">
                <input type="checkbox" ${!excluded.includes(cat) ? 'checked' : ''}
                       onchange="toggleIngestCategory('${cat}', this.checked)">
                <span class="toggle-slider"></span>
              </label>
            </div>
          `).join('');
        })()}
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

        <!-- Source Authors Subsection -->
        <div class="settings-subsection">
          <h3 class="subsection-title">Source Authors</h3>
          <p class="section-description">Publishers/organizations linked to news sources. Each unique domain has one source author with a logo image.</p>

          <details class="sources-details">
            <summary>Source Authors (${sourceAuthors.length})</summary>
            <div class="sources-list">
              ${sourceAuthors.length === 0 ? '<p class="empty-message">No source authors yet. They are created automatically when sources are added.</p>'
                : sourceAuthors.map(sa => {
                  const initial = (sa.name || '?').charAt(0).toUpperCase();
                  const fallbackSpan = '<span style="width:32px;height:32px;border-radius:4px;background:var(--bg-secondary);display:inline-flex;align-items:center;justify-content:center;font-size:0.9rem;border:1px solid var(--border)">' + initial + '</span>';
                  const imgHtml = sa.image_url
                    ? '<img src="' + escapeHtml(sa.image_url) + '" alt="' + escapeHtml(sa.name) + '" style="width:32px;height:32px;border-radius:4px;object-fit:cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\'">'
                      + '<span style="width:32px;height:32px;border-radius:4px;background:var(--bg-secondary);display:none;align-items:center;justify-content:center;font-size:0.9rem;border:1px solid var(--border)">' + initial + '</span>'
                    : fallbackSpan;
                  return '<div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border)">'
                    + imgHtml
                    + '<div style="flex:1;min-width:0">'
                    + '<strong style="font-size:0.9rem">' + escapeHtml(sa.name) + '</strong>'
                    + '<span style="font-size:0.8rem;color:var(--text-muted);margin-left:0.5rem">' + escapeHtml(sa.domain) + '</span>'
                    + (sa.source_count ? '<span style="font-size:0.75rem;color:var(--text-muted);margin-left:0.5rem">(' + sa.source_count + ' feeds)</span>' : '')
                    + '</div>'
                    + '<button class="btn btn-sm" onclick="adminChangeSourceAuthorImage(' + sa.id + ', \'' + escapeHtml(sa.name.replace(/'/g, "\\'")) + '\', function(){ renderSettings(); })">Image</button>'
                    + '<button class="btn btn-sm" onclick="editSourceAuthorName(' + sa.id + ', \'' + escapeHtml(sa.name.replace(/'/g, "\\'")) + '\')">Edit</button>'
                    + '</div>';
                }).join('')}
            </div>
          </details>

          <div class="setting-row" style="align-items:center;margin-top:0.75rem">
            <label>
              <span class="setting-label">Backfill Source Author Images</span>
              <span class="setting-description">Fetch logos from Wikipedia for source authors without one</span>
            </label>
            <button class="btn btn-secondary" id="backfill-sa-images-btn" onclick="backfillSourceAuthorImages()">Backfill Images</button>
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
          <div id="purge-quality-results" style="display:none; margin-top:12px; padding:12px; background:var(--bg-secondary); border-radius:8px; font-size:0.9rem">
            <div id="purge-summary-bar" style="display:none; margin-bottom:8px; font-weight:600; font-size:0.85rem">
              <span style="color:var(--success)">Kept: <span id="purge-kept-count">0</span></span> |
              <span style="color:var(--danger)">Deleted: <span id="purge-deleted-count">0</span></span> |
              Remaining: ~<span id="purge-remaining-count">0</span> |
              ETA: <span id="purge-eta">—</span>
            </div>
            <div id="purge-activity-log" style="display:none; max-height:320px; overflow-y:auto; font-family:monospace; font-size:0.8rem; line-height:1.5; padding:8px; background:var(--bg-primary); border-radius:6px; border:1px solid var(--border-color)"></div>
            <div id="purge-final-summary" style="display:none; margin-top:8px"></div>
          </div>
        </div>
      </div>

      <!-- Noteworthy Section -->
      <div class="settings-section" id="settings-section-noteworthy">
        <h2>Noteworthy</h2>
        <p class="section-description">Manage items displayed in the Noteworthy section on the homepage. Add quotes, topics, articles, categories, or authors that deserve special attention.</p>

        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title">Add Noteworthy Item</h3>
          </div>
          <div class="noteworthy-add-form">
            <select id="noteworthy-type" class="input-select" style="width:auto;min-width:120px">
              <option value="quote">Quote</option>
              <option value="topic">Topic</option>
              <option value="article">Article</option>
              <option value="category">Category</option>
              <option value="person">Author</option>
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
            ${noteworthyItems.length === 0 ? '<p class="empty-message">No noteworthy items. Add quotes, topics, articles, or categories above.</p>' : noteworthyItems.map(item => renderNoteworthyRow(item)).join('')}
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

      <!-- Topics Section -->
      <div class="settings-section" id="settings-section-topics">
        <h2>Topics</h2>
        <p class="section-description">Manage topics that group keywords together. Topics can have date ranges, aliases, and linked keywords.</p>

        <div class="settings-subsection">
          <h3 class="subsection-title">Add Topic</h3>
          <div class="topic-add-form" style="display:flex;flex-wrap:wrap;gap:0.5rem;align-items:flex-end">
            <div style="flex:1;min-width:180px">
              <label class="input-label" style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:2px">Name</label>
              <input type="text" id="new-topic-name" placeholder="Topic name" class="input-text">
            </div>
            <div style="min-width:120px">
              <label class="input-label" style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:2px">Status</label>
              <select id="new-topic-status" class="input-select">
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div style="min-width:140px">
              <label class="input-label" style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:2px">Start Date</label>
              <input type="date" id="new-topic-start-date" class="input-text">
            </div>
            <div style="min-width:140px">
              <label class="input-label" style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:2px">End Date</label>
              <input type="date" id="new-topic-end-date" class="input-text">
            </div>
            <div style="flex:2;min-width:200px">
              <label class="input-label" style="font-size:0.75rem;color:var(--text-muted);display:block;margin-bottom:2px">Description</label>
              <input type="text" id="new-topic-description" placeholder="Description (optional)" class="input-text">
            </div>
            <button class="btn btn-primary" onclick="addTopic()">Add</button>
          </div>
        </div>

        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title" id="topics-count-title">Topics (${topics.length})</h3>
            <div style="display:flex;gap:0.5rem;align-items:center">
              <select id="topics-status-filter" class="input-select" style="width:auto;min-width:100px" onchange="filterTopics()">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
              <input type="text" id="topics-filter" placeholder="Filter topics..." class="input-text" style="width:180px" oninput="filterTopics()">
            </div>
          </div>
          <div id="topics-list" class="topics-keywords-list">
            ${renderTopics(topics)}
          </div>
        </div>
      </div>

      <!-- Categories Section -->
      <div class="settings-section" id="settings-section-categories">
        <h2>Categories</h2>
        <p class="section-description">Organize topics into categories for navigation and grouping. Drag topics between categories to reorganize.</p>

        <div class="settings-subsection">
          <h3 class="subsection-title">Add Category</h3>
          <div class="keyword-add-form">
            <input type="text" id="new-category-name" placeholder="Category name" class="input-text"
                   onkeydown="if(event.key==='Enter')addCategory()">
            <button class="btn btn-primary" onclick="addCategory()">Add</button>
          </div>
        </div>

        <div class="settings-subsection">
          <div class="subsection-header">
            <h3 class="subsection-title" id="categories-count-title">Categories (${categories.length})</h3>
          </div>
          <div id="categories-list" class="topics-keywords-list">
            ${renderCategories(categories)}
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

async function toggleIngestCategory(category, isAllowed) {
  const allCategories = ['Politician','Government Official','Business Leader','Entertainer','Athlete','Pundit','Journalist','Scientist/Academic','Legal/Judicial','Military/Defense','Activist/Advocate','Religious Leader','Other'];
  const excluded = [];
  const sections = document.querySelectorAll('.settings-section');
  for (const section of sections) {
    const h2 = section.querySelector('h2');
    if (h2 && h2.textContent === 'Ingest Filters') {
      const checkboxes = section.querySelectorAll('input[type="checkbox"]');
      checkboxes.forEach((cb, i) => {
        if (!cb.checked && allCategories[i]) {
          excluded.push(allCategories[i]);
        }
      });
      break;
    }
  }
  await updateSetting('ingest_filter_excluded_categories', JSON.stringify(excluded));
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

async function editSourceAuthorName(saId, currentName) {
  const newName = prompt('Edit source author name:', currentName || '');
  if (newName === null || newName.trim() === '' || newName.trim() === currentName) return;

  try {
    await API.patch(`/source-authors/${saId}`, { name: newName.trim() });
    showToast('Source author name updated', 'success');
    renderSettings();
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function backfillSourceAuthorImages() {
  const btn = document.getElementById('backfill-sa-images-btn');
  btn.disabled = true;
  btn.textContent = 'Backfilling...';

  try {
    const result = await API.post('/admin/backfill-source-author-images', { limit: 50 });
    showToast(`Backfill complete: ${result.found} images found out of ${result.processed} processed`, 'success', 5000);
    renderSettings();
  } catch (err) {
    showToast('Backfill failed: ' + err.message, 'error', 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Backfill Images';
  }
}

async function runPurgeQuality(dryRun) {
  if (!dryRun) {
    showConfirmToast('This will permanently delete all non-factual quotes. Continue?', () => executePurge(false));
    return;
  }
  await executePurge(true);
}

function getCategoryLabel(category) {
  if (category === 'A') return 'Verifiable fact';
  if (category === 'B') return 'Opinion';
  if (category === 'C') return 'Platitude';
  return category;
}

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return '< 1s';
  if (seconds < 60) return `~${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `~${m}m ${s}s` : `~${m}m`;
}

function updatePurgeSummary(kept, deleted, remaining, eta) {
  const bar = document.getElementById('purge-summary-bar');
  if (bar) {
    bar.style.display = 'block';
    document.getElementById('purge-kept-count').textContent = kept;
    document.getElementById('purge-deleted-count').textContent = deleted;
    document.getElementById('purge-remaining-count').textContent = remaining;
    document.getElementById('purge-eta').textContent = formatEta(eta);
  }
}

function appendPurgeLogEntry(container, type, html) {
  const div = document.createElement('div');
  div.style.padding = '1px 0';
  if (type === 'kept') div.style.color = 'var(--success)';
  else if (type === 'deleted') div.style.color = 'var(--danger)';
  else if (type === 'warning') div.style.color = 'var(--warning, #f59e0b)';
  else div.style.color = 'var(--text-secondary)';
  div.innerHTML = html;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function handlePurgeProgress(data, logContainer, dryRun) {
  if (data.type === 'kept' || data.type === 'deleted') {
    const icon = data.type === 'kept' ? '✓' : '✗';
    const label = dryRun ? (data.type === 'kept' ? 'KEEP' : 'WOULD DELETE') : (data.type === 'kept' ? 'KEPT' : 'DELETE');
    const catLabel = getCategoryLabel(data.category);
    appendPurgeLogEntry(logContainer, data.type, `${icon} ${label}: "${escapeHtml(data.quoteText)}" — ${escapeHtml(data.author)} (Cat ${data.category}: ${catLabel})`);
    updatePurgeSummary(data.totalKept, data.totalDeleted, data.remaining, data.estimatedSecondsLeft);
  } else if (data.type === 'warning') {
    appendPurgeLogEntry(logContainer, 'warning', `⚠ ${escapeHtml(data.message)}`);
  } else {
    appendPurgeLogEntry(logContainer, 'info', `ℹ ${escapeHtml(data.message)}`);
  }
}

function renderPurgeFinalSummary(result, dryRun, el) {
  const p1 = result.phase1 || {};
  const p2 = result.phase2 || {};
  el.style.display = 'block';
  el.innerHTML = `
    <strong>${dryRun ? 'Preview Complete' : 'Purge Complete'}</strong><br>
    <strong>Phase 1 — Hidden quotes:</strong> ${p1.invisible_found || 0} found, ${p1.deleted || 0} deleted<br>
    <strong>Phase 2 — AI Classification:</strong> ${p2.classified || 0} classified (A: ${p2.breakdown?.category_A || 0}, B: ${p2.breakdown?.category_B || 0}, C: ${p2.breakdown?.category_C || 0})<br>
    B+C pending deletion: ${p2.pending_deletion || 0}, deleted: ${p2.deleted || 0}<br>
    ${p2.remaining_unclassified > 0 ? `<em>${p2.remaining_unclassified} quotes still unclassified — run again to continue</em><br>` : ''}
    ${!dryRun ? `Pinecone cleaned: ${result.pinecone_deleted || 0}` : ''}
    ${result.pinecone_error ? `<br><span style="color:var(--danger)">Pinecone error: ${escapeHtml(result.pinecone_error)}</span>` : ''}
  `;
}

async function executePurge(dryRun) {
  const previewBtn = document.getElementById('purge-preview-btn');
  const executeBtn = document.getElementById('purge-execute-btn');
  const resultsDiv = document.getElementById('purge-quality-results');
  const summaryBar = document.getElementById('purge-summary-bar');
  const logContainer = document.getElementById('purge-activity-log');
  const finalSummary = document.getElementById('purge-final-summary');

  previewBtn.disabled = true;
  executeBtn.disabled = true;
  (dryRun ? previewBtn : executeBtn).textContent = dryRun ? 'Previewing...' : 'Purging...';

  // Reset and show panel
  resultsDiv.style.display = 'block';
  summaryBar.style.display = 'none';
  logContainer.style.display = 'block';
  logContainer.innerHTML = '';
  finalSummary.style.display = 'none';
  finalSummary.innerHTML = '';
  document.getElementById('purge-kept-count').textContent = '0';
  document.getElementById('purge-deleted-count').textContent = '0';
  document.getElementById('purge-remaining-count').textContent = '0';
  document.getElementById('purge-eta').textContent = '—';

  // Register Socket.IO listeners
  const onProgress = (data) => handlePurgeProgress(data, logContainer, dryRun);
  const onComplete = (data) => {
    updatePurgeSummary(data.totalKept, data.totalDeleted, 0, 0);
  };
  if (typeof socket !== 'undefined' && socket) {
    socket.on('purge_progress', onProgress);
    socket.on('purge_complete', onComplete);
  }

  try {
    const result = await API.post('/admin/purge-quality', { dry_run: dryRun, batch_size: 10 });
    renderPurgeFinalSummary(result, dryRun, finalSummary);
    showToast(dryRun ? 'Preview complete' : `Purge complete: ${(result.phase1?.deleted || 0) + (result.phase2?.deleted || 0)} quotes deleted`, dryRun ? 'info' : 'success', 5000);
  } catch (err) {
    showToast('Purge failed: ' + err.message, 'error', 5000);
  } finally {
    if (typeof socket !== 'undefined' && socket) {
      socket.off('purge_progress', onProgress);
      socket.off('purge_complete', onComplete);
    }
    previewBtn.disabled = false;
    executeBtn.disabled = false;
    previewBtn.textContent = 'Preview';
    executeBtn.textContent = 'Purge Now';
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
  const typeIcon = item.entity_type === 'quote' ? '\u201C\u201D'
    : item.entity_type === 'topic' ? '#'
    : item.entity_type === 'category' ? '\uD83D\uDDC2\uFE0F'
    : item.entity_type === 'person' ? '\uD83D\uDC64'
    : '\uD83D\uDCF0';
  const label = item.entity_label || `${item.entity_type} #${item.entity_id}`;
  return `
    <div class="tk-row" data-noteworthy-id="${item.id}">
      <div class="tk-row__info">
        <span class="tk-row__type">${typeIcon} ${escapeHtml(item.entity_type)}</span>
        <span class="tk-row__name">${escapeHtml(label)}</span>
        <span class="tk-row__stats">Order: ${item.display_order || 0}</span>
      </div>
      <div class="tk-row__actions">
        <button class="btn btn-secondary btn-sm${item.full_width ? ' btn-active' : ''}" onclick="noteworthyToggleFullWidth(${item.id}, ${item.full_width ? 0 : 1})" title="Toggle full width">&#x2194;</button>
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
    } else if (type === 'category') {
      const data = await API.get('/admin/categories');
      items = (data.categories || []).filter(c =>
        c.name.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10).map(c => ({
        id: c.id,
        label: c.name,
        type: 'category'
      }));
    } else if (type === 'person') {
      const data = await API.get('/search/unified?q=' + encodeURIComponent(query) + '&limit=10');
      items = (data.persons || []).map(p => ({
        id: p.id,
        label: p.canonical_name,
        type: 'person'
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

async function noteworthyToggleFullWidth(id, value) {
  try {
    await API.patch(`/admin/noteworthy/${id}`, { full_width: value });
    await refreshNoteworthyList();
  } catch (err) {
    showToast('Error toggling full width: ' + err.message, 'error', 5000);
  }
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

// ======= Topics Section =======

let _topicsCache = [];

function renderTopics(topics) {
  _topicsCache = topics;
  if (topics.length === 0) {
    return '<p class="empty-message">No topics configured. Add a topic above.</p>';
  }
  return topics.map(t => renderTopicRow(t)).join('');
}

function topicStatusBadge(status) {
  const colors = {
    active: 'color:var(--success)',
    archived: 'color:var(--text-muted)',
    draft: 'color:var(--warning)',
  };
  const style = colors[status] || 'color:var(--text-muted)';
  return `<span class="tk-row__type" style="${style}">${escapeHtml(status)}</span>`;
}

function renderTopicRow(topic) {
  const dateRange = (topic.start_date || topic.end_date)
    ? `${topic.start_date || '...'} - ${topic.end_date || '...'}`
    : '';
  return `
    <details class="keyword-card" data-topic-id="${topic.id}">
      <summary class="keyword-card__summary">
        <div class="keyword-card__info">
          ${topicStatusBadge(topic.status || 'active')}
          <span class="keyword-card__name" id="topic-name-${topic.id}">${escapeHtml(topic.name)}</span>
          <span class="keyword-card__stats">${topic.keyword_count || 0} keywords &middot; ${topic.quote_count || 0} quotes${dateRange ? ' &middot; ' + escapeHtml(dateRange) : ''}</span>
        </div>
        <div class="keyword-card__actions" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" onclick="editTopic(${topic.id})" title="Edit">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteTopic(${topic.id})" title="Delete">Delete</button>
        </div>
      </summary>
      <div class="keyword-card__body" id="topic-body-${topic.id}">
        <div class="keyword-aliases-loading">Loading details...</div>
      </div>
    </details>
  `;
}

function filterTopics() {
  const query = (document.getElementById('topics-filter')?.value || '').toLowerCase().trim();
  const statusFilter = (document.getElementById('topics-status-filter')?.value || '');
  const list = document.getElementById('topics-list');
  if (!list) return;
  let filtered = _topicsCache;
  if (statusFilter) {
    filtered = filtered.filter(t => t.status === statusFilter);
  }
  if (query) {
    filtered = filtered.filter(t => t.name.toLowerCase().includes(query));
  }
  list.innerHTML = filtered.length === 0
    ? '<p class="empty-message">No topics match filter.</p>'
    : filtered.map(t => renderTopicRow(t)).join('');
}

// Lazy-load topic details when card is opened
document.addEventListener('toggle', async (e) => {
  const details = e.target.closest?.('.keyword-card[data-topic-id]');
  if (!details || !details.open) return;
  const topicId = details.dataset.topicId;
  if (!topicId) return;
  const body = document.getElementById(`topic-body-${topicId}`);
  if (!body || body.dataset.loaded) return;
  try {
    const data = await API.get(`/admin/topics/${topicId}`);
    const aliases = data.aliases || [];
    const keywords = data.keywords || [];
    const categories = data.categories || [];
    const topic = data.topic || {};
    body.dataset.loaded = 'true';
    body.innerHTML = renderTopicDetails(topicId, topic, aliases, keywords, categories);
  } catch (err) {
    body.innerHTML = `<p class="empty-message">Error loading topic: ${escapeHtml(err.message)}</p>`;
  }
}, true);

function renderTopicDetails(topicId, topic, aliases, keywords, categories = []) {
  let html = '';

  // Inline edit fields
  html += `<div style="display:flex;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.75rem;align-items:flex-end">
    <div style="min-width:120px">
      <label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:2px">Status</label>
      <select id="topic-status-${topicId}" class="input-select" style="width:auto" onchange="updateTopicField(${topicId}, 'status', this.value)">
        <option value="active" ${topic.status === 'active' ? 'selected' : ''}>Active</option>
        <option value="draft" ${topic.status === 'draft' ? 'selected' : ''}>Draft</option>
        <option value="archived" ${topic.status === 'archived' ? 'selected' : ''}>Archived</option>
      </select>
    </div>
    <div style="min-width:130px">
      <label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:2px">Start Date</label>
      <input type="date" id="topic-start-${topicId}" class="input-text" value="${topic.start_date || ''}"
             onchange="updateTopicField(${topicId}, 'start_date', this.value)">
    </div>
    <div style="min-width:130px">
      <label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:2px">End Date</label>
      <input type="date" id="topic-end-${topicId}" class="input-text" value="${topic.end_date || ''}"
             onchange="updateTopicField(${topicId}, 'end_date', this.value)">
    </div>
    <div style="flex:1;min-width:180px">
      <label style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:2px">Description</label>
      <input type="text" id="topic-desc-${topicId}" class="input-text" value="${escapeHtml(topic.description || '')}"
             placeholder="Optional description"
             onchange="updateTopicField(${topicId}, 'description', this.value)">
    </div>
  </div>`;

  // Aliases section
  html += '<div style="margin-bottom:0.75rem"><strong style="font-size:0.8rem">Aliases</strong></div>';
  html += '<div class="keyword-aliases-list">';
  if (aliases.length === 0) {
    html += '<p class="empty-message" style="padding:0.25rem 0;font-size:0.85rem">No aliases.</p>';
  } else {
    html += aliases.map(a => `
      <span class="keyword-alias-chip" data-alias-id="${a.id}">
        ${escapeHtml(a.alias)}
        <button class="keyword-alias-remove" onclick="deleteTopicAlias(${topicId}, ${a.id})" title="Remove alias">&times;</button>
      </span>
    `).join('');
  }
  html += '</div>';
  html += `
    <div class="keyword-alias-add">
      <input type="text" id="topic-alias-input-${topicId}" placeholder="New alias" class="input-text" style="width:160px"
             onkeydown="if(event.key==='Enter')addTopicAlias(${topicId})">
      <button class="btn btn-secondary btn-sm" onclick="addTopicAlias(${topicId})">Add Alias</button>
    </div>
  `;

  // Keywords section
  html += '<div style="margin-top:0.75rem;margin-bottom:0.5rem"><strong style="font-size:0.8rem">Linked Keywords</strong></div>';
  html += '<div class="keyword-aliases-list">';
  if (keywords.length === 0) {
    html += '<p class="empty-message" style="padding:0.25rem 0;font-size:0.85rem">No keywords linked.</p>';
  } else {
    html += keywords.map(kw => `
      <span class="keyword-alias-chip" data-keyword-id="${kw.id}">
        ${escapeHtml(kw.name)}
        <button class="keyword-alias-remove" onclick="unlinkTopicKeyword(${topicId}, ${kw.id})" title="Unlink keyword">&times;</button>
      </span>
    `).join('');
  }
  html += '</div>';
  html += `
    <div class="keyword-alias-add">
      <input type="text" id="topic-keyword-filter-${topicId}" class="input-text" placeholder="Filter keywords..." style="width:200px" oninput="filterTopicKeywordOptions(${topicId})">
      <select id="topic-keyword-select-${topicId}" class="input-select" style="width:200px">
        <option value="">Select a keyword...</option>
      </select>
      <button class="btn btn-secondary btn-sm" onclick="linkTopicKeyword(${topicId})">Link Keyword</button>
    </div>
  `;

  // Populate keyword dropdown asynchronously
  loadTopicKeywordOptions(topicId, keywords.map(kw => kw.id));

  // Categories section
  html += '<div style="margin-top:0.75rem;margin-bottom:0.5rem"><strong style="font-size:0.8rem">Linked Categories</strong></div>';
  html += '<div class="keyword-aliases-list">';
  if (categories.length === 0) {
    html += '<p class="empty-message" style="padding:0.25rem 0;font-size:0.85rem">No categories linked.</p>';
  } else {
    html += categories.map(cat => `
      <span class="keyword-alias-chip" data-category-id="${cat.id}">
        ${escapeHtml(cat.name)}
        <button class="keyword-alias-remove" onclick="unlinkTopicCategory(${topicId}, ${cat.id})" title="Unlink category">&times;</button>
      </span>
    `).join('');
  }
  html += '</div>';
  html += `
    <div class="keyword-alias-add">
      <select id="topic-category-select-${topicId}" class="input-select" style="width:200px">
        <option value="">Select a category...</option>
      </select>
      <button class="btn btn-secondary btn-sm" onclick="linkTopicCategory(${topicId})">Link Category</button>
    </div>
  `;

  // Populate category dropdown asynchronously
  loadTopicCategoryOptions(topicId, categories.map(cat => cat.id));

  return html;
}

const _topicKeywordCache = {};

async function loadTopicKeywordOptions(topicId, linkedKeywordIds) {
  try {
    const data = await API.get('/admin/keywords');
    const allKeywords = data.keywords || [];
    const select = document.getElementById(`topic-keyword-select-${topicId}`);
    if (!select) return;
    const linkedSet = new Set(linkedKeywordIds);
    const available = allKeywords.filter(kw => !linkedSet.has(kw.id));
    _topicKeywordCache[topicId] = available;
    select.innerHTML = '<option value="">Select a keyword...</option>' +
      available.map(kw => `<option value="${kw.id}">${escapeHtml(kw.name)}</option>`).join('');
  } catch (err) {
    console.error('Failed to load keywords for dropdown:', err);
  }
}

function filterTopicKeywordOptions(topicId) {
  const filterInput = document.getElementById(`topic-keyword-filter-${topicId}`);
  const select = document.getElementById(`topic-keyword-select-${topicId}`);
  if (!filterInput || !select) return;
  const query = filterInput.value.toLowerCase().trim();
  const available = _topicKeywordCache[topicId] || [];
  const filtered = query ? available.filter(kw => kw.name.toLowerCase().includes(query)) : available;
  select.innerHTML = '<option value="">Select a keyword...</option>' +
    filtered.map(kw => `<option value="${kw.id}">${escapeHtml(kw.name)}</option>`).join('');
}

async function loadTopicCategoryOptions(topicId, linkedCategoryIds) {
  try {
    const data = await API.get('/admin/categories');
    const allCategories = data.categories || [];
    const select = document.getElementById(`topic-category-select-${topicId}`);
    if (!select) return;
    const linkedSet = new Set(linkedCategoryIds);
    const available = allCategories.filter(cat => !linkedSet.has(cat.id));
    select.innerHTML = '<option value="">Select a category...</option>' +
      available.map(cat => `<option value="${cat.id}">${escapeHtml(cat.name)}</option>`).join('');
  } catch (err) {
    console.error('Failed to load categories for dropdown:', err);
  }
}

async function linkTopicCategory(topicId) {
  const select = document.getElementById(`topic-category-select-${topicId}`);
  const catId = select?.value;
  if (!catId) {
    showToast('Please select a category', 'error');
    return;
  }
  try {
    await API.post(`/admin/categories/${catId}/topics`, { topic_id: topicId });
    showToast('Category linked');
    refreshTopicBody(topicId);
  } catch (err) {
    showToast('Failed to link category: ' + err.message, 'error');
  }
}

async function unlinkTopicCategory(topicId, catId) {
  try {
    await API.delete(`/admin/categories/${catId}/topics/${topicId}`);
    showToast('Category unlinked');
    refreshTopicBody(topicId);
  } catch (err) {
    showToast('Failed to unlink category: ' + err.message, 'error');
  }
}

async function addTopic() {
  const nameInput = document.getElementById('new-topic-name');
  const statusInput = document.getElementById('new-topic-status');
  const startInput = document.getElementById('new-topic-start-date');
  const endInput = document.getElementById('new-topic-end-date');
  const descInput = document.getElementById('new-topic-description');

  const name = (nameInput?.value || '').trim();
  if (!name) {
    showToast('Please enter a topic name', 'error');
    return;
  }

  const payload = { name };
  const status = statusInput?.value;
  if (status) payload.status = status;
  const startDate = startInput?.value;
  if (startDate) payload.start_date = startDate;
  const endDate = endInput?.value;
  if (endDate) payload.end_date = endDate;
  const description = (descInput?.value || '').trim();
  if (description) payload.description = description;

  try {
    await API.post('/admin/topics', payload);
    showToast('Topic added', 'success');
    nameInput.value = '';
    if (statusInput) statusInput.value = 'active';
    if (startInput) startInput.value = '';
    if (endInput) endInput.value = '';
    if (descInput) descInput.value = '';
    await reloadTopics();
  } catch (err) {
    showToast('Error adding topic: ' + err.message, 'error', 5000);
  }
}

async function editTopic(id) {
  const nameEl = document.getElementById(`topic-name-${id}`);
  if (!nameEl) return;
  const currentName = nameEl.textContent;
  const newName = prompt('Rename topic:', currentName);
  if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

  try {
    await API.put(`/admin/topics/${id}`, { name: newName.trim() });
    showToast('Topic renamed', 'success');
    await reloadTopics();
  } catch (err) {
    showToast('Error renaming topic: ' + err.message, 'error', 5000);
  }
}

async function updateTopicField(id, field, value) {
  try {
    await API.put(`/admin/topics/${id}`, { [field]: value || null });
    showToast('Topic updated', 'success');
    await reloadTopics();
  } catch (err) {
    showToast('Error updating topic: ' + err.message, 'error', 5000);
  }
}

async function deleteTopic(id) {
  showConfirmToast('Delete this topic and all its aliases?', async () => {
    try {
      await API.delete(`/admin/topics/${id}`);
      showToast('Topic deleted', 'success');
      await reloadTopics();
    } catch (err) {
      showToast('Error deleting topic: ' + err.message, 'error', 5000);
    }
  });
}

async function addTopicAlias(topicId) {
  const input = document.getElementById(`topic-alias-input-${topicId}`);
  const alias = (input?.value || '').trim();
  if (!alias) {
    showToast('Please enter an alias', 'error');
    return;
  }

  try {
    await API.post(`/admin/topics/${topicId}/aliases`, { alias });
    showToast('Alias added', 'success');
    input.value = '';
    await refreshTopicBody(topicId);
    await reloadTopics();
  } catch (err) {
    showToast('Error adding alias: ' + err.message, 'error', 5000);
  }
}

async function deleteTopicAlias(topicId, aliasId) {
  try {
    await API.delete(`/admin/topics/${topicId}/aliases/${aliasId}`);
    showToast('Alias removed', 'success');
    await refreshTopicBody(topicId);
    await reloadTopics();
  } catch (err) {
    showToast('Error removing alias: ' + err.message, 'error', 5000);
  }
}

async function linkTopicKeyword(topicId) {
  const select = document.getElementById(`topic-keyword-select-${topicId}`);
  const keywordId = select?.value;
  if (!keywordId) {
    showToast('Please select a keyword', 'error');
    return;
  }

  try {
    await API.post(`/admin/topics/${topicId}/keywords`, { keyword_id: parseInt(keywordId) });
    showToast('Keyword linked', 'success');
    await refreshTopicBody(topicId);
    await reloadTopics();
  } catch (err) {
    showToast('Error linking keyword: ' + err.message, 'error', 5000);
  }
}

async function unlinkTopicKeyword(topicId, keywordId) {
  try {
    await API.delete(`/admin/topics/${topicId}/keywords/${keywordId}`);
    showToast('Keyword unlinked', 'success');
    await refreshTopicBody(topicId);
    await reloadTopics();
  } catch (err) {
    showToast('Error unlinking keyword: ' + err.message, 'error', 5000);
  }
}

async function refreshTopicBody(topicId) {
  const body = document.getElementById(`topic-body-${topicId}`);
  if (!body) return;
  try {
    const data = await API.get(`/admin/topics/${topicId}`);
    body.innerHTML = renderTopicDetails(topicId, data.topic || {}, data.aliases || [], data.keywords || [], data.categories || []);
  } catch (err) {
    console.error('Failed to refresh topic body:', err);
  }
}

async function reloadTopics() {
  try {
    const data = await API.get('/admin/topics');
    const topics = data.topics || [];
    _topicsCache = topics;
    const list = document.getElementById('topics-list');
    const filterInput = document.getElementById('topics-filter');
    const statusFilter = document.getElementById('topics-status-filter');
    const query = (filterInput?.value || '').toLowerCase().trim();
    const statusVal = statusFilter?.value || '';
    let filtered = topics;
    if (statusVal) {
      filtered = filtered.filter(t => t.status === statusVal);
    }
    if (query) {
      filtered = filtered.filter(t => t.name.toLowerCase().includes(query));
    }
    if (list) {
      // Preserve which cards are open
      const openIds = new Set();
      list.querySelectorAll('.keyword-card[data-topic-id][open]').forEach(d => openIds.add(d.dataset.topicId));
      list.innerHTML = filtered.length === 0
        ? '<p class="empty-message">No topics configured. Add a topic above.</p>'
        : filtered.map(t => renderTopicRow(t)).join('');
      // Re-open previously open cards
      openIds.forEach(tId => {
        const card = list.querySelector(`.keyword-card[data-topic-id="${tId}"]`);
        if (card) card.open = true;
      });
    }
    const title = document.getElementById('topics-count-title');
    if (title) title.textContent = `Topics (${topics.length})`;
  } catch (err) {
    console.error('Failed to reload topics:', err);
  }
}

// ======= Categories Section =======

let _categoriesCache = [];

function renderCategories(categories) {
  _categoriesCache = categories;
  if (categories.length === 0) {
    return '<p class="empty-message">No categories configured. Add a category above.</p>';
  }
  return categories.map(cat => renderCategoryRow(cat)).join('');
}

function renderCategoryRow(cat) {
  const thumbHtml = cat.image_url
    ? `<img src="${escapeHtml(cat.image_url)}" alt="" style="width:24px;height:24px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px" onerror="this.style.display='none'">`
    : cat.icon_name
      ? `<span class="material-icons-outlined" style="font-size:18px;vertical-align:middle;margin-right:4px;color:var(--text-muted)">${escapeHtml(cat.icon_name)}</span>`
      : '';
  return `
    <details class="keyword-card" data-category-id="${cat.id}">
      <summary class="keyword-card__summary">
        <div class="keyword-card__info">
          ${thumbHtml}<span class="keyword-card__name" id="category-name-${cat.id}">${escapeHtml(cat.name)}</span>
          <span class="keyword-card__stats">${cat.topic_count || 0} topics &middot; Order: ${cat.sort_order ?? 0}</span>
        </div>
        <div class="keyword-card__actions" onclick="event.stopPropagation()">
          <button class="btn btn-secondary btn-sm" onclick="categoryMoveUp(${cat.id})" title="Move up">&uarr;</button>
          <button class="btn btn-secondary btn-sm" onclick="categoryMoveDown(${cat.id})" title="Move down">&darr;</button>
          <button class="btn btn-secondary btn-sm" onclick="adminChangeCategoryImage(${cat.id}, '${escapeHtml(cat.name.replace(/'/g, "\\'"))}')" title="Change image">Image</button>
          <button class="btn btn-secondary btn-sm" onclick="editCategory(${cat.id})" title="Rename">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteCategory(${cat.id})" title="Delete">Delete</button>
        </div>
      </summary>
      <div class="keyword-card__body" id="category-body-${cat.id}">
        <div class="keyword-aliases-loading">Loading topics...</div>
      </div>
    </details>
  `;
}

// Lazy-load topics when category card is opened
document.addEventListener('toggle', async (e) => {
  const details = e.target.closest?.('.keyword-card[data-category-id]');
  if (!details || !details.open) return;
  const catId = details.dataset.categoryId;
  if (!catId) return;
  const body = document.getElementById(`category-body-${catId}`);
  if (!body || body.dataset.loaded) return;
  try {
    const data = await API.get(`/admin/categories/${catId}`);
    const topics = data.topics || [];
    body.dataset.loaded = 'true';
    body.innerHTML = renderCategoryTopics(catId, topics);
  } catch (err) {
    body.innerHTML = `<p class="empty-message">Error loading topics: ${escapeHtml(err.message)}</p>`;
  }
}, true);

function renderCategoryTopics(catId, topics) {
  let html = '<div class="keyword-aliases-list">';
  if (topics.length === 0) {
    html += '<p class="empty-message" style="padding:0.5rem 0">No topics linked.</p>';
  } else {
    html += topics.map(t => `
      <span class="keyword-alias-chip" data-topic-id="${t.id}">
        ${escapeHtml(t.name)}
        <button class="keyword-alias-remove" onclick="removeCategoryTopic(${catId}, ${t.id})" title="Unlink topic">&times;</button>
      </span>
    `).join('');
  }
  html += '</div>';
  html += `
    <div class="keyword-alias-add">
      <select id="category-topic-select-${catId}" class="input-select" style="width:200px">
        <option value="">Select a topic...</option>
      </select>
      <button class="btn btn-secondary btn-sm" onclick="addCategoryTopic(${catId})">Link Topic</button>
    </div>
  `;
  // Populate the topic dropdown asynchronously
  loadCategoryTopicOptions(catId, topics.map(t => t.id));
  return html;
}

async function loadCategoryTopicOptions(catId, linkedTopicIds) {
  try {
    const data = await API.get('/admin/topics');
    const allTopics = data.topics || [];
    const select = document.getElementById(`category-topic-select-${catId}`);
    if (!select) return;
    const linkedSet = new Set(linkedTopicIds);
    const available = allTopics.filter(t => !linkedSet.has(t.id));
    select.innerHTML = '<option value="">Select a topic...</option>' +
      available.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  } catch (err) {
    console.error('Failed to load topics for dropdown:', err);
  }
}

async function addCategory() {
  const nameInput = document.getElementById('new-category-name');
  const name = (nameInput?.value || '').trim();

  if (!name) {
    showToast('Please enter a category name', 'error');
    return;
  }

  try {
    await API.post('/admin/categories', { name });
    showToast('Category added', 'success');
    nameInput.value = '';
    await reloadCategories();
  } catch (err) {
    showToast('Error adding category: ' + err.message, 'error', 5000);
  }
}

async function editCategory(id) {
  const nameEl = document.getElementById(`category-name-${id}`);
  if (!nameEl) return;
  const currentName = nameEl.textContent;
  const newName = prompt('Rename category:', currentName);
  if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

  try {
    await API.put(`/admin/categories/${id}`, { name: newName.trim() });
    showToast('Category renamed', 'success');
    await reloadCategories();
  } catch (err) {
    showToast('Error renaming category: ' + err.message, 'error', 5000);
  }
}

async function deleteCategory(id) {
  showConfirmToast('Delete this category? Topics will be unlinked but not deleted.', async () => {
    try {
      await API.delete(`/admin/categories/${id}`);
      showToast('Category deleted', 'success');
      await reloadCategories();
    } catch (err) {
      showToast('Error deleting category: ' + err.message, 'error', 5000);
    }
  });
}

async function categoryMoveUp(id) {
  const cat = _categoriesCache.find(c => c.id === id);
  if (!cat) return;
  const idx = _categoriesCache.indexOf(cat);
  if (idx <= 0) return;
  const prev = _categoriesCache[idx - 1];
  try {
    await API.put(`/admin/categories/${id}`, { sort_order: prev.sort_order });
    await API.put(`/admin/categories/${prev.id}`, { sort_order: cat.sort_order });
    await reloadCategories();
  } catch (err) {
    showToast('Error reordering: ' + err.message, 'error');
  }
}

async function categoryMoveDown(id) {
  const cat = _categoriesCache.find(c => c.id === id);
  if (!cat) return;
  const idx = _categoriesCache.indexOf(cat);
  if (idx < 0 || idx >= _categoriesCache.length - 1) return;
  const next = _categoriesCache[idx + 1];
  try {
    await API.put(`/admin/categories/${id}`, { sort_order: next.sort_order });
    await API.put(`/admin/categories/${next.id}`, { sort_order: cat.sort_order });
    await reloadCategories();
  } catch (err) {
    showToast('Error reordering: ' + err.message, 'error');
  }
}

async function addCategoryTopic(catId) {
  const select = document.getElementById(`category-topic-select-${catId}`);
  const topicId = select?.value;
  if (!topicId) {
    showToast('Please select a topic', 'error');
    return;
  }

  try {
    await API.post(`/admin/categories/${catId}/topics`, { topic_id: parseInt(topicId) });
    showToast('Topic linked', 'success');
    // Refresh the category body
    const body = document.getElementById(`category-body-${catId}`);
    if (body) {
      const data = await API.get(`/admin/categories/${catId}`);
      body.innerHTML = renderCategoryTopics(catId, data.topics || []);
    }
    await reloadCategories();
  } catch (err) {
    showToast('Error linking topic: ' + err.message, 'error', 5000);
  }
}

async function removeCategoryTopic(catId, topicId) {
  try {
    await API.delete(`/admin/categories/${catId}/topics/${topicId}`);
    showToast('Topic unlinked', 'success');
    // Refresh the category body
    const body = document.getElementById(`category-body-${catId}`);
    if (body) {
      const data = await API.get(`/admin/categories/${catId}`);
      body.innerHTML = renderCategoryTopics(catId, data.topics || []);
    }
    await reloadCategories();
  } catch (err) {
    showToast('Error unlinking topic: ' + err.message, 'error', 5000);
  }
}

async function reloadCategories() {
  try {
    const data = await API.get('/admin/categories');
    const categories = data.categories || [];
    _categoriesCache = categories;
    const list = document.getElementById('categories-list');
    if (list) {
      // Preserve which cards are open
      const openIds = new Set();
      list.querySelectorAll('.keyword-card[data-category-id][open]').forEach(d => openIds.add(d.dataset.categoryId));
      list.innerHTML = categories.length === 0
        ? '<p class="empty-message">No categories configured. Add a category above.</p>'
        : categories.map(cat => renderCategoryRow(cat)).join('');
      // Re-open previously open cards
      openIds.forEach(catId => {
        const card = list.querySelector(`.keyword-card[data-category-id="${catId}"]`);
        if (card) card.open = true;
      });
    }
    const title = document.getElementById('categories-count-title');
    if (title) title.textContent = `Categories (${categories.length})`;
  } catch (err) {
    console.error('Failed to reload categories:', err);
  }
}
