// Disambiguation Review & Quote Management & Taxonomy Review Page

let _reviewActiveTab = 'quotes';
let _taxonomyTypeFilter = '';
let _taxonomySourceFilter = '';

async function renderReview() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading...</div>';

  // Tab bar
  let html = `
    <p style="margin-bottom:1rem">
      <a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">&larr; Back to quotes</a>
    </p>
    <h1 class="page-title">Review</h1>
    <div class="review-tab-bar">
      <button class="review-tab ${_reviewActiveTab === 'quotes' ? 'active' : ''}" data-tab="quotes" onclick="switchReviewTab('quotes')">Quote Management</button>
      <button class="review-tab ${_reviewActiveTab === 'disambiguation' ? 'active' : ''}" data-tab="disambiguation" onclick="switchReviewTab('disambiguation')">Disambiguation Review <span class="disambig-tab-badge" id="disambig-tab-badge" style="display:none"></span></button>
      <button class="review-tab ${_reviewActiveTab === 'taxonomy' ? 'active' : ''}" data-tab="taxonomy" onclick="switchReviewTab('taxonomy')">Taxonomy Review <span class="taxonomy-tab-badge" id="taxonomy-tab-badge" style="display:none"></span></button>
    </div>
    <div id="review-tab-content"></div>
  `;
  content.innerHTML = html;

  // Load taxonomy badge count in background
  loadTaxonomyBadgeCount();

  if (_reviewActiveTab === 'taxonomy') {
    await renderTaxonomyTab();
  } else if (_reviewActiveTab === 'disambiguation') {
    await renderDisambiguationTab();
  } else {
    await renderQuoteManagementTab();
  }
}

function switchReviewTab(tab) {
  _reviewActiveTab = tab;
  // Update tab bar active state
  document.querySelectorAll('.review-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  const container = document.getElementById('review-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading...</div>';
  if (tab === 'taxonomy') {
    renderTaxonomyTab();
  } else if (tab === 'disambiguation') {
    renderDisambiguationTab();
  } else {
    renderQuoteManagementTab();
  }
}

async function renderDisambiguationTab() {
  const container = document.getElementById('review-tab-content');
  if (!container) return;

  try {
    const [reviewData, stats] = await Promise.all([
      API.get('/review?limit=20'),
      API.get('/review/stats'),
    ]);

    updateReviewBadge(stats.pending);
    updateDisambigTabBadge(stats.pending);

    let html = `
      <p class="page-subtitle">Review potential name matches to improve quote attribution accuracy</p>
      <div class="review-stats">
        <span class="stat"><strong>${stats.pending}</strong> items pending</span>
        <span class="stat"><strong>${stats.resolved_today}</strong> resolved today</span>
      </div>
    `;

    if (reviewData.items.length === 0) {
      html += `
        <div class="empty-state">
          <h3>No items to review</h3>
          <p>Great job! All disambiguation tasks have been completed.</p>
          <p><a href="/" onclick="navigate(event, '/')">Back to quotes</a></p>
        </div>
      `;
    } else {
      // Group items by candidate person for batch review
      const groupedItems = groupByCandidate(reviewData.items);

      for (const [candidateId, items] of Object.entries(groupedItems)) {
        if (items.length > 1 && candidateId !== 'null') {
          // Batch review card
          html += renderBatchReviewCard(items);
        } else {
          // Individual review cards
          for (const item of items) {
            html += renderReviewCard(item);
          }
        }
      }

      // Pagination
      if (reviewData.totalPages > 1) {
        html += `
          <div class="pagination">
            <span class="pagination-info">Page ${reviewData.page} of ${reviewData.totalPages}</span>
          </div>
        `;
      }
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

// ===================================
// Quote Management Tab
// ===================================

let _adminQuotePage = 1;
let _adminQuoteSearch = '';
let _adminQuoteTimeFilter = '';
let _adminQuoteCustomDate = '';

async function renderQuoteManagementTab() {
  const container = document.getElementById('review-tab-content');
  if (!container) return;

  container.innerHTML = `
    <p class="page-subtitle">View, edit, and manage extracted quotes.</p>
    <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
      <input type="search" id="admin-quote-search" placeholder="Search quotes, authors..." class="input-text" style="flex:1;width:auto" value="${escapeHtml(_adminQuoteSearch)}" onkeydown="if(event.key==='Enter')searchAdminQuotes()">
      <button class="btn btn-primary btn-sm" onclick="searchAdminQuotes()">Search</button>
      <button class="btn btn-secondary btn-sm" onclick="clearAdminSearch()">Clear</button>
    </div>
    <div class="review-time-filters">
      <span class="review-time-label">Published:</span>
      <button class="review-time-btn ${_adminQuoteTimeFilter === '1h' ? 'active' : ''}" onclick="setQuoteTimeFilter('1h')">Last Hour</button>
      <button class="review-time-btn ${_adminQuoteTimeFilter === '12h' ? 'active' : ''}" onclick="setQuoteTimeFilter('12h')">Last 12 Hours</button>
      <button class="review-time-btn ${_adminQuoteTimeFilter === '1d' ? 'active' : ''}" onclick="setQuoteTimeFilter('1d')">Last Day</button>
      <button class="review-time-btn ${_adminQuoteTimeFilter === '1w' ? 'active' : ''}" onclick="setQuoteTimeFilter('1w')">Last Week</button>
      <button class="review-time-btn ${_adminQuoteTimeFilter === 'custom' ? 'active' : ''}" onclick="toggleCustomDatePicker()">Custom</button>
      ${_adminQuoteTimeFilter ? '<button class="review-time-btn review-time-clear" onclick="setQuoteTimeFilter(\\'\\')">Clear</button>' : ''}
      <div id="custom-date-picker" style="display:${_adminQuoteTimeFilter === 'custom' ? 'flex' : 'none'};gap:0.5rem;align-items:center;margin-left:0.5rem">
        <input type="date" id="custom-date-input" class="input-text" style="width:auto;font-size:0.8rem" value="${escapeHtml(_adminQuoteCustomDate)}" onchange="applyCustomDate()">
      </div>
    </div>
    <div id="admin-quotes-list">
      <div class="loading">Loading quotes...</div>
    </div>
    <div id="admin-quotes-pagination"></div>
  `;

  await loadAdminQuotes();
}

function searchAdminQuotes() {
  const input = document.getElementById('admin-quote-search');
  _adminQuoteSearch = input ? input.value.trim() : '';
  _adminQuotePage = 1;
  loadAdminQuotes();
}

function clearAdminSearch() {
  _adminQuoteSearch = '';
  _adminQuoteTimeFilter = '';
  _adminQuoteCustomDate = '';
  const input = document.getElementById('admin-quote-search');
  if (input) input.value = '';
  _adminQuotePage = 1;
  loadAdminQuotes();
}

function setQuoteTimeFilter(filter) {
  _adminQuoteTimeFilter = filter;
  _adminQuotePage = 1;
  if (filter !== 'custom') _adminQuoteCustomDate = '';
  renderQuoteManagementTab();
}

function toggleCustomDatePicker() {
  if (_adminQuoteTimeFilter === 'custom') {
    _adminQuoteTimeFilter = '';
    _adminQuoteCustomDate = '';
    renderQuoteManagementTab();
  } else {
    _adminQuoteTimeFilter = 'custom';
    renderQuoteManagementTab();
  }
}

function applyCustomDate() {
  const input = document.getElementById('custom-date-input');
  if (input && input.value) {
    _adminQuoteCustomDate = input.value;
    _adminQuotePage = 1;
    loadAdminQuotes();
  }
}

function getTimeFilterISO() {
  const now = new Date();
  if (_adminQuoteTimeFilter === '1h') {
    return new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  } else if (_adminQuoteTimeFilter === '12h') {
    return new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  } else if (_adminQuoteTimeFilter === '1d') {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  } else if (_adminQuoteTimeFilter === '1w') {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  } else if (_adminQuoteTimeFilter === 'custom' && _adminQuoteCustomDate) {
    return _adminQuoteCustomDate + 'T00:00:00.000Z';
  }
  return '';
}

async function markQuoteReviewed(quoteId) {
  try {
    await API.post(`/quotes/${quoteId}/reviewed`);
    const card = document.getElementById('aqc-' + quoteId);
    if (card) {
      card.style.transition = 'opacity 0.3s';
      card.style.opacity = '0';
      setTimeout(() => card.remove(), 300);
    }
    showToast('Quote marked as reviewed', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error');
  }
}

async function loadAdminQuotes(page) {
  _adminQuotePage = page || _adminQuotePage || 1;
  const container = document.getElementById('admin-quotes-list');
  const paginationEl = document.getElementById('admin-quotes-pagination');
  if (!container) return;

  try {
    let url = `/quotes?page=${_adminQuotePage}&limit=20&excludeReviewed=1`;
    if (_adminQuoteSearch) url += `&search=${encodeURIComponent(_adminQuoteSearch)}`;
    const publishedAfter = getTimeFilterISO();
    if (publishedAfter) url += `&publishedAfter=${encodeURIComponent(publishedAfter)}`;
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
              <button class="btn btn-secondary btn-sm" onclick="adminChangeHeadshot(${q.personId}, '${escapeHtml(q.personName)}')" style="margin-top:0.25rem;font-size:0.65rem">Photo</button>
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
              ${typeof buildAdminActionsHtml === 'function' ? buildAdminActionsHtml({
                id: q.id, personId: q.personId, personName: q.personName,
                text: q.text, context: q.context, isVisible: q.isVisible,
                personCategory: q.personCategory, personCategoryContext: q.personCategoryContext,
                disambiguation: q.personDisambiguation
              }) : ''}
              <div style="margin-top:0.4rem">
                <button class="btn btn-success btn-sm review-mark-btn" onclick="markQuoteReviewed(${q.id})">Reviewed</button>
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

// ===================================
// Disambiguation Review Functions
// ===================================

function groupByCandidate(items) {
  const groups = {};
  for (const item of items) {
    const key = item.candidate_person_id || 'null';
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}

function renderReviewCard(item) {
  const signals = item.match_signals || {};
  const similarityPercent = Math.round((item.similarity_score || 0) * 100);
  const similarityClass = similarityPercent >= 85 ? 'high' : similarityPercent >= 70 ? 'medium' : 'low';

  return `
    <div class="review-card" data-id="${item.id}">
      <div class="review-header">
        <h3>Is this the same person?</h3>
      </div>

      <div class="review-columns">
        <div class="review-column new-name">
          <h4>New Name</h4>
          <p class="name-display">"${escapeHtml(item.new_name)}"</p>
          ${item.new_context ? `<div class="context"><strong>Context:</strong> ${escapeHtml(item.new_context)}</div>` : ''}
          ${signals.reasoning ? `<div class="match-signals"><strong>Match reasoning:</strong> ${escapeHtml(signals.reasoning)}</div>` : ''}
        </div>

        <div class="review-column existing-person">
          <h4>Existing Person</h4>
          ${item.candidate_person_id ? `
            <p class="name-display">"${escapeHtml(item.candidate_canonical_name || item.candidate_name)}"</p>
            ${item.candidate_disambiguation ? `<p class="disambiguation">${escapeHtml(item.candidate_disambiguation)}</p>` : ''}
            ${item.candidate_aliases && item.candidate_aliases.length > 0 ? `
              <div class="aliases"><strong>Aliases:</strong> ${item.candidate_aliases.map(a => escapeHtml(a)).join(', ')}</div>
            ` : ''}
            ${item.candidate_recent_quotes && item.candidate_recent_quotes.length > 0 ? `
              <div class="recent-quotes">
                <strong>Recent quotes:</strong>
                <ul>
                  ${item.candidate_recent_quotes.map(q => `<li>"${escapeHtml(q)}"</li>`).join('')}
                </ul>
              </div>
            ` : ''}
            <p class="quote-count"><strong>Quote count:</strong> ${item.candidate_quote_count || 0}</p>
          ` : `
            <p class="no-candidate">No candidate person identified</p>
          `}
        </div>
      </div>

      <div class="similarity-bar">
        <div class="similarity-fill ${similarityClass}" style="width: ${similarityPercent}%"></div>
        <span class="similarity-label">Similarity: ${similarityPercent}%</span>
      </div>

      <div class="review-actions">
        ${item.candidate_person_id ? `
          <button class="btn btn-success" onclick="handleMerge(${item.id})">Same Person</button>
        ` : ''}
        <button class="btn btn-danger" onclick="handleReject(${item.id})">Different Person</button>
        <button class="btn btn-secondary" onclick="handleSkip(${item.id})">Skip</button>
      </div>
    </div>
  `;
}

function renderBatchReviewCard(items) {
  const candidate = items[0];
  const candidateName = candidate.candidate_canonical_name || candidate.candidate_name;

  return `
    <div class="batch-review-card">
      <div class="batch-header">
        <h3>Batch Review: ${items.length} names may match "${escapeHtml(candidateName)}"</h3>
        ${candidate.candidate_disambiguation ? `<p class="disambiguation">${escapeHtml(candidate.candidate_disambiguation)}</p>` : ''}
      </div>

      <div class="batch-items">
        ${items.map(item => {
          const score = Math.round((item.similarity_score || 0) * 100);
          const checked = score >= 80 ? 'checked' : '';
          return `
            <label class="batch-item">
              <input type="checkbox" ${checked} value="${item.id}" class="batch-checkbox" data-candidate="${item.candidate_person_id}">
              <span class="batch-name">"${escapeHtml(item.new_name)}"</span>
              <span class="batch-score">${score}%</span>
            </label>
          `;
        }).join('')}
      </div>

      <div class="batch-actions">
        <button class="btn btn-success" onclick="handleBatchMerge(this)">Merge Selected</button>
        <button class="btn btn-danger" onclick="handleBatchReject(this)">Reject All</button>
        <button class="btn btn-secondary" onclick="expandBatch(this)">Review Individually</button>
      </div>
    </div>
  `;
}

async function handleMerge(reviewId) {
  const card = document.querySelector(`.review-card[data-id="${reviewId}"]`);
  card.classList.add('processing');

  try {
    await API.post(`/review/${reviewId}/merge`);
    card.classList.add('resolved', 'merged');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-1);
  } catch (err) {
    card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function handleReject(reviewId) {
  const card = document.querySelector(`.review-card[data-id="${reviewId}"]`);
  card.classList.add('processing');

  try {
    await API.post(`/review/${reviewId}/reject`);
    card.classList.add('resolved', 'rejected');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-1);
  } catch (err) {
    card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function handleSkip(reviewId) {
  const card = document.querySelector(`.review-card[data-id="${reviewId}"]`);
  card.classList.add('processing');

  try {
    await API.post(`/review/${reviewId}/skip`);
    card.classList.add('resolved', 'skipped');
    setTimeout(() => card.remove(), 500);
  } catch (err) {
    card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function handleBatchMerge(button) {
  const card = button.closest('.batch-review-card');
  const checkboxes = card.querySelectorAll('.batch-checkbox:checked');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  if (ids.length === 0) {
    showToast('Please select at least one item to merge', 'error');
    return;
  }

  card.classList.add('processing');

  try {
    await API.post('/review/batch', { action: 'merge', ids });
    card.classList.add('resolved');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-ids.length);
  } catch (err) {
    card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function handleBatchReject(button) {
  const card = button.closest('.batch-review-card');
  const checkboxes = card.querySelectorAll('.batch-checkbox');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  card.classList.add('processing');

  try {
    await API.post('/review/batch', { action: 'reject', ids });
    card.classList.add('resolved');
    setTimeout(() => card.remove(), 500);
    updateReviewCount(-ids.length);
  } catch (err) {
    card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

function expandBatch(button) {
  const card = button.closest('.batch-review-card');
  const checkboxes = card.querySelectorAll('.batch-checkbox');
  const ids = Array.from(checkboxes).map(cb => parseInt(cb.value));

  // Re-render the page to show individual cards
  renderReview();
}

function updateReviewCount(delta) {
  const badge = document.getElementById('review-badge');
  if (badge) {
    let count = parseInt(badge.textContent) || 0;
    count = Math.max(0, count + delta);
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
    updateDisambigTabBadge(count);
  }
}

function updateDisambigTabBadge(count) {
  const badge = document.getElementById('disambig-tab-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ===================================
// Taxonomy Review Tab
// ===================================

async function loadTaxonomyBadgeCount() {
  try {
    const data = await API.get('/admin/taxonomy/suggestions/stats');
    const pending = (data.stats || [])
      .filter(s => s.status === 'pending')
      .reduce((sum, s) => sum + s.count, 0);
    updateTaxonomyTabBadge(pending);
  } catch (_) { /* ignore */ }
}

function updateTaxonomyTabBadge(count) {
  const badge = document.getElementById('taxonomy-tab-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

const _taxonomyTypeLabels = {
  new_keyword: 'New Keyword',
  new_topic: 'New Topic',
  keyword_alias: 'Keyword Alias',
  topic_keyword: 'Topic Keyword',
  topic_alias: 'Topic Alias',
};

const _taxonomySourceLabels = {
  ai_extraction: 'AI Extraction',
  batch_evolution: 'Batch Evolution',
  confidence_review: 'Confidence Review',
};

const _taxonomyTypeBgColors = {
  new_keyword: '#2563eb',
  new_topic: '#7c3aed',
  keyword_alias: '#0891b2',
  topic_keyword: '#059669',
  topic_alias: '#d97706',
};

const _taxonomySourceBgColors = {
  ai_extraction: '#6366f1',
  batch_evolution: '#ea580c',
  confidence_review: '#0d9488',
};

async function renderTaxonomyTab() {
  const container = document.getElementById('review-tab-content');
  if (!container) return;

  try {
    const [suggestionsData, statsData] = await Promise.all([
      API.get(`/admin/taxonomy/suggestions?status=pending${_taxonomyTypeFilter ? '&type=' + encodeURIComponent(_taxonomyTypeFilter) : ''}&limit=50`),
      API.get('/admin/taxonomy/suggestions/stats'),
    ]);

    const suggestions = suggestionsData.suggestions || [];
    const stats = statsData.stats || [];

    const pendingTotal = stats.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.count, 0);
    updateTaxonomyTabBadge(pendingTotal);

    // Stats summary
    const pendingByType = {};
    for (const s of stats) {
      if (s.status === 'pending') {
        pendingByType[s.suggestion_type] = (pendingByType[s.suggestion_type] || 0) + s.count;
      }
    }

    let html = `
      <p class="page-subtitle">Review AI-suggested taxonomy changes: new keywords, topics, aliases, and associations.</p>
      <div class="review-stats">
        <span class="stat"><strong>${pendingTotal}</strong> pending suggestions</span>
      </div>
      <div class="tax-controls">
        <div class="tax-filters">
          <select id="tax-type-filter" onchange="filterTaxonomySuggestions()" class="input-text" style="width:auto">
            <option value="">All Types</option>
            ${Object.entries(_taxonomyTypeLabels).map(([k, v]) => {
              const cnt = pendingByType[k] || 0;
              return `<option value="${k}" ${_taxonomyTypeFilter === k ? 'selected' : ''}>${escapeHtml(v)} (${cnt})</option>`;
            }).join('')}
          </select>
        </div>
        <div class="tax-actions-bar">
          <button class="btn btn-secondary btn-sm" onclick="toggleTaxonomySelectAll()">Select All</button>
          <button class="btn btn-success btn-sm" onclick="batchApproveSuggestions()">Approve Selected</button>
          <button class="btn btn-danger btn-sm" onclick="batchRejectSuggestions()">Reject Selected</button>
          <button class="btn btn-primary btn-sm" onclick="triggerEvolution()" style="margin-left:auto">Run Evolution</button>
        </div>
      </div>
    `;

    if (suggestions.length === 0) {
      html += `
        <div class="empty-state">
          <h3>No pending suggestions</h3>
          <p>All taxonomy suggestions have been reviewed.</p>
        </div>
      `;
    } else {
      html += '<div id="tax-suggestions-list">';
      for (const s of suggestions) {
        html += renderSuggestionCard(s);
      }
      html += '</div>';
    }

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function renderSuggestionCard(suggestion) {
  let data = {};
  try { data = JSON.parse(suggestion.suggested_data); } catch (_) {}

  const typeBg = _taxonomyTypeBgColors[suggestion.suggestion_type] || '#6b7280';
  const srcBg = _taxonomySourceBgColors[suggestion.source] || '#6b7280';
  const typeLabel = _taxonomyTypeLabels[suggestion.suggestion_type] || suggestion.suggestion_type;
  const srcLabel = _taxonomySourceLabels[suggestion.source] || suggestion.source;

  const createdStr = suggestion.created_at
    ? new Date(suggestion.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

  // Build data display based on content
  let dataHtml = '';
  if (data.name) {
    dataHtml += `<div class="tax-card-field"><strong>Name:</strong> ${escapeHtml(data.name)}</div>`;
  }
  if (data.type) {
    dataHtml += `<div class="tax-card-field"><strong>Entity Type:</strong> ${escapeHtml(data.type)}</div>`;
  }
  if (data.closest_match) {
    const matchScore = data.closest_match.score ? Math.round(data.closest_match.score * 100) + '%' : 'N/A';
    dataHtml += `<div class="tax-card-field"><strong>Closest Match:</strong> ${escapeHtml(data.closest_match.keyword_name || 'none')} (${matchScore})</div>`;
  }
  if (data.suggested_aliases && data.suggested_aliases.length > 0) {
    dataHtml += `<div class="tax-card-field"><strong>Aliases:</strong> ${data.suggested_aliases.map(a => escapeHtml(a)).join(', ')}</div>`;
  }
  if (data.keyword_name) {
    dataHtml += `<div class="tax-card-field"><strong>Keyword:</strong> ${escapeHtml(data.keyword_name)}</div>`;
  }
  if (data.topic_name) {
    dataHtml += `<div class="tax-card-field"><strong>Topic:</strong> ${escapeHtml(data.topic_name)}</div>`;
  }
  if (data.alias) {
    dataHtml += `<div class="tax-card-field"><strong>Alias:</strong> ${escapeHtml(data.alias)}</div>`;
  }
  if (data.occurrence_count) {
    dataHtml += `<div class="tax-card-field"><strong>Occurrences:</strong> ${data.occurrence_count}</div>`;
  }
  if (data.confidence) {
    dataHtml += `<div class="tax-card-field"><strong>Confidence:</strong> ${Math.round(data.confidence * 100)}%</div>`;
  }

  // Escape the suggestion data for use in onclick attributes
  const escapedDataAttr = escapeHtml(suggestion.suggested_data).replace(/'/g, '&#39;');

  return `
    <div class="tax-card" data-id="${suggestion.id}">
      <div class="tax-card-header">
        <label class="tax-card-select">
          <input type="checkbox" class="tax-select-cb" value="${suggestion.id}">
        </label>
        <span class="tax-badge" style="background:${typeBg}">${escapeHtml(typeLabel)}</span>
        <span class="tax-badge" style="background:${srcBg}">${escapeHtml(srcLabel)}</span>
        ${createdStr ? `<span class="tax-card-date">${createdStr}</span>` : ''}
      </div>
      <div class="tax-card-body">
        ${dataHtml}
      </div>
      <div class="tax-card-actions">
        <button class="btn btn-success btn-sm" onclick="approveSuggestion(${suggestion.id})">Approve</button>
        <button class="btn btn-primary btn-sm" onclick="editAndApproveSuggestion(${suggestion.id}, '${escapedDataAttr}')">Edit & Approve</button>
        <button class="btn btn-danger btn-sm" onclick="rejectSuggestion(${suggestion.id})">Reject</button>
      </div>
    </div>
  `;
}

function filterTaxonomySuggestions() {
  const sel = document.getElementById('tax-type-filter');
  _taxonomyTypeFilter = sel ? sel.value : '';
  renderTaxonomyTab();
}

async function approveSuggestion(id) {
  const card = document.querySelector(`.tax-card[data-id="${id}"]`);
  if (card) card.classList.add('processing');

  try {
    await API.post(`/admin/taxonomy/suggestions/${id}/approve`);
    showToast('Suggestion approved', 'success');
    if (card) {
      card.classList.add('resolved');
      setTimeout(() => card.remove(), 400);
    }
    loadTaxonomyBadgeCount();
  } catch (err) {
    if (card) card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function editAndApproveSuggestion(id, rawData) {
  const card = document.querySelector(`.tax-card[data-id="${id}"]`);
  if (!card) return;

  // Parse existing data
  let data = {};
  try {
    // rawData is HTML-escaped, decode it
    const tmp = document.createElement('textarea');
    tmp.innerHTML = rawData;
    data = JSON.parse(tmp.value);
  } catch (_) {}

  // Check if already showing edit form
  if (card.querySelector('.tax-edit-form')) return;

  const actionsEl = card.querySelector('.tax-card-actions');
  if (!actionsEl) return;

  const nameVal = data.name || '';
  const aliasesVal = (data.suggested_aliases || []).join(', ');

  actionsEl.innerHTML = `
    <div class="tax-edit-form">
      <div style="margin-bottom:0.5rem">
        <label style="font-size:0.8rem;font-weight:600">Name</label>
        <input type="text" id="tax-edit-name-${id}" class="input-text" value="${escapeHtml(nameVal)}" style="width:100%">
      </div>
      <div style="margin-bottom:0.5rem">
        <label style="font-size:0.8rem;font-weight:600">Aliases (comma-separated)</label>
        <input type="text" id="tax-edit-aliases-${id}" class="input-text" value="${escapeHtml(aliasesVal)}" style="width:100%">
      </div>
      <div style="display:flex;gap:0.5rem">
        <button class="btn btn-success btn-sm" onclick="submitEditedSuggestion(${id})">Save & Approve</button>
        <button class="btn btn-secondary btn-sm" onclick="renderTaxonomyTab()">Cancel</button>
      </div>
    </div>
  `;
}

async function submitEditedSuggestion(id) {
  const nameInput = document.getElementById(`tax-edit-name-${id}`);
  const aliasesInput = document.getElementById(`tax-edit-aliases-${id}`);

  if (!nameInput || !nameInput.value.trim()) {
    showToast('Name is required', 'error');
    return;
  }

  const editedData = {
    name: nameInput.value.trim(),
    suggested_aliases: aliasesInput
      ? aliasesInput.value.split(',').map(a => a.trim()).filter(Boolean)
      : [],
  };

  const card = document.querySelector(`.tax-card[data-id="${id}"]`);
  if (card) card.classList.add('processing');

  try {
    await API.post(`/admin/taxonomy/suggestions/${id}/approve`, { edited_data: editedData });
    showToast('Suggestion edited and approved', 'success');
    if (card) {
      card.classList.add('resolved');
      setTimeout(() => card.remove(), 400);
    }
    loadTaxonomyBadgeCount();
  } catch (err) {
    if (card) card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function rejectSuggestion(id) {
  const card = document.querySelector(`.tax-card[data-id="${id}"]`);
  if (card) card.classList.add('processing');

  try {
    await API.post(`/admin/taxonomy/suggestions/${id}/reject`);
    showToast('Suggestion rejected', 'info');
    if (card) {
      card.classList.add('resolved');
      setTimeout(() => card.remove(), 400);
    }
    loadTaxonomyBadgeCount();
  } catch (err) {
    if (card) card.classList.remove('processing');
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

function toggleTaxonomySelectAll() {
  const checkboxes = document.querySelectorAll('.tax-select-cb');
  if (checkboxes.length === 0) return;
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
}

async function batchApproveSuggestions() {
  const checked = document.querySelectorAll('.tax-select-cb:checked');
  const ids = Array.from(checked).map(cb => parseInt(cb.value));

  if (ids.length === 0) {
    showToast('Select at least one suggestion', 'error');
    return;
  }

  showConfirmToast(`Approve ${ids.length} suggestion(s)?`, async () => {
    let success = 0;
    let errors = 0;
    for (const id of ids) {
      try {
        await API.post(`/admin/taxonomy/suggestions/${id}/approve`);
        success++;
        const card = document.querySelector(`.tax-card[data-id="${id}"]`);
        if (card) card.remove();
      } catch (_) { errors++; }
    }
    showToast(`Approved ${success}, errors ${errors}`, success > 0 ? 'success' : 'error');
    loadTaxonomyBadgeCount();
  });
}

async function batchRejectSuggestions() {
  const checked = document.querySelectorAll('.tax-select-cb:checked');
  const ids = Array.from(checked).map(cb => parseInt(cb.value));

  if (ids.length === 0) {
    showToast('Select at least one suggestion', 'error');
    return;
  }

  showConfirmToast(`Reject ${ids.length} suggestion(s)?`, async () => {
    let success = 0;
    let errors = 0;
    for (const id of ids) {
      try {
        await API.post(`/admin/taxonomy/suggestions/${id}/reject`);
        success++;
        const card = document.querySelector(`.tax-card[data-id="${id}"]`);
        if (card) card.remove();
      } catch (_) { errors++; }
    }
    showToast(`Rejected ${success}, errors ${errors}`, success > 0 ? 'info' : 'error');
    loadTaxonomyBadgeCount();
  });
}

async function triggerEvolution() {
  showConfirmToast('Run taxonomy evolution? This analyzes recent quotes for new patterns.', async () => {
    try {
      showToast('Running taxonomy evolution...', 'info', 5000);
      const result = await API.post('/admin/taxonomy/evolve');
      const msg = result.message || 'Evolution complete';
      showToast(msg, 'success', 5000);
      // Refresh the tab to show any new suggestions
      renderTaxonomyTab();
    } catch (err) {
      showToast('Error: ' + err.message, 'error', 5000);
    }
  });
}
