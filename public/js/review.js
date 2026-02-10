// Disambiguation Review & Quote Management Page

let _reviewActiveTab = 'disambiguation';

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
      <button class="review-tab ${_reviewActiveTab === 'disambiguation' ? 'active' : ''}" onclick="switchReviewTab('disambiguation')">Disambiguation Review</button>
      <button class="review-tab ${_reviewActiveTab === 'quotes' ? 'active' : ''}" onclick="switchReviewTab('quotes')">Quote Management</button>
    </div>
    <div id="review-tab-content"></div>
  `;
  content.innerHTML = html;

  if (_reviewActiveTab === 'disambiguation') {
    await renderDisambiguationTab();
  } else {
    await renderQuoteManagementTab();
  }
}

function switchReviewTab(tab) {
  _reviewActiveTab = tab;
  // Update tab bar active state
  document.querySelectorAll('.review-tab').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.toLowerCase().includes(tab === 'disambiguation' ? 'disambiguation' : 'quote'));
  });
  const container = document.getElementById('review-tab-content');
  if (!container) return;
  container.innerHTML = '<div class="loading">Loading...</div>';
  if (tab === 'disambiguation') {
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

async function renderQuoteManagementTab() {
  const container = document.getElementById('review-tab-content');
  if (!container) return;

  container.innerHTML = `
    <p class="page-subtitle">View, edit, and manage extracted quotes.</p>
    <div style="display:flex;gap:0.5rem;margin-bottom:1rem">
      <input type="search" id="admin-quote-search" placeholder="Search quotes, authors..." class="input-text" style="flex:1;width:auto" value="${escapeHtml(_adminQuoteSearch)}" onkeydown="if(event.key==='Enter')searchAdminQuotes()">
      <button class="btn btn-primary btn-sm" onclick="searchAdminQuotes()">Search</button>
      <button class="btn btn-secondary btn-sm" onclick="clearAdminSearch()">Clear</button>
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
  }
}
