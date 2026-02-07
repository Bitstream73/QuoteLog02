// Homepage - Quote List Display

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

// Store quote metadata for sharing
const _quoteMeta = {};

// Current active category filter
let _activeCategory = 'Politicians';
let _activeSubFilter = '';
let _currentSearch = '';

// Pending new quotes count (for non-jarring updates)
let _pendingNewQuotes = 0;

// Sub-filter definitions per broad category
const SUB_FILTERS = {
  Politicians: ['U.S.', 'UK', 'EU', 'Republican', 'Democrat', 'Labor', 'Candidate'],
  Professionals: ['Law', 'STEM', 'Philosophy', 'Author', 'Historian', 'Business', 'Science'],
  Other: ['Entertainment', 'Sports', 'Activist', 'Religious', 'Media'],
};

/**
 * Format a timestamp as mm/dd/yyyy - hh:mm:ss
 */
function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${mm}/${dd}/${yyyy} - ${hh}:${min}:${ss}`;
}

/**
 * Extract domain from URL for display
 */
function extractDomain(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Group quotes by article for display
 */
function groupQuotesByArticle(quotes) {
  const groups = new Map();
  const ungrouped = [];

  for (const q of quotes) {
    if (q.articleId) {
      if (!groups.has(q.articleId)) {
        groups.set(q.articleId, {
          articleId: q.articleId,
          articleTitle: q.articleTitle,
          articlePublishedAt: q.articlePublishedAt,
          articleUrl: q.articleUrl,
          primarySourceDomain: q.primarySourceDomain,
          primarySourceName: q.primarySourceName,
          quotes: [],
        });
      }
      groups.get(q.articleId).quotes.push(q);
    } else {
      ungrouped.push(q);
    }
  }

  // Convert to array — all article groups rendered the same way
  const multiQuoteGroups = [];
  const singleQuoteGroups = [];

  for (const group of groups.values()) {
    if (group.quotes.length > 1) {
      multiQuoteGroups.push(group);
    } else {
      singleQuoteGroups.push(group);
    }
  }

  return { multiQuoteGroups, singleQuoteGroups, ungrouped };
}

/**
 * Build share buttons HTML
 */
function buildShareHtml(q) {
  // Store metadata for sharing
  _quoteMeta[q.id] = {
    text: q.text,
    personName: q.personName,
    personCategoryContext: q.personCategoryContext || q.personDisambiguation || '',
    context: q.context || '',
    articleTitle: q.articleTitle || '',
    primarySourceName: q.primarySourceName || q.primarySourceDomain || '',
    articlePublishedAt: q.articlePublishedAt || q.createdAt || '',
  };

  const quoteText = q.text.length > 200 ? q.text.substring(0, 200) + '...' : q.text;
  const shareText = encodeURIComponent(`"${quoteText}" - ${q.personName}`);
  const shareUrl = encodeURIComponent(window.location.origin + '/quote/' + q.id);

  return `
    <div class="share-row">
      <button class="share-btn" onclick="shareQuote(event, ${q.id}, 'x')" title="Share on X">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
      </button>
      <button class="share-btn" onclick="shareQuote(event, ${q.id}, 'facebook')" title="Share on Facebook">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
      </button>
      <button class="share-btn" onclick="shareQuote(event, ${q.id}, 'email')" title="Share via Email">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/></svg>
      </button>
      <button class="share-btn" onclick="shareQuote(event, ${q.id}, 'copy')" title="Copy to Clipboard">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
      </button>
    </div>
  `;
}

/**
 * Share a quote via different channels
 */
function shareQuote(event, quoteId, channel) {
  event.preventDefault();
  const meta = _quoteMeta[quoteId] || {};
  const el = document.getElementById('qe-' + quoteId);

  const quoteText = meta.text || _quoteTexts[quoteId] || (el && el.querySelector('.quote-text')?.textContent) || '';
  const authorName = meta.personName || (el && el.querySelector('.author-link')?.textContent) || '';
  const authorDesc = meta.personCategoryContext || (el && el.querySelector('.quote-author-description')?.textContent) || '';
  const context = meta.context || (el && el.querySelector('.quote-context')?.textContent) || '';
  const source = meta.primarySourceName || (el && el.querySelector('.quote-primary-source')?.textContent) || '';
  const articleTitle = meta.articleTitle || (el && el.querySelector('.quote-article-title-link')?.textContent) || '';
  const date = meta.articlePublishedAt ? formatDateTime(meta.articlePublishedAt) : (el && el.querySelector('.quote-date-inline')?.textContent) || '';
  const shareUrl = window.location.origin + '/quote/' + quoteId;
  const fullText = `"${quoteText}" - ${authorName}`;

  // Build metadata lines for rich sharing
  const metaLines = [];
  if (authorDesc) metaLines.push(authorDesc);
  if (context) metaLines.push(context);
  if (articleTitle) metaLines.push(`Article: ${articleTitle}`);
  if (source) metaLines.push(`Source: ${source}`);
  if (date) metaLines.push(date);
  const metaBlock = metaLines.length > 0 ? '\n' + metaLines.join('\n') : '';

  switch (channel) {
    case 'x':
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(fullText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
      break;
    case 'facebook':
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`, '_blank');
      break;
    case 'email': {
      const subject = encodeURIComponent(`Quote from ${authorName} - Quote Log`);
      const body = encodeURIComponent(`${fullText}${metaBlock}\n\nRead more: ${shareUrl}\n\n---\nShared from Quote Log - What, When, & Why They Said It.`);
      window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
      break;
    }
    case 'copy':
      navigator.clipboard.writeText(`${fullText}${metaBlock}\n${shareUrl}`).then(() => {
        const btn = event.currentTarget;
        btn.classList.add('share-copied');
        setTimeout(() => btn.classList.remove('share-copied'), 1500);
      }).catch(() => {});
      break;
  }
}

/**
 * Build HTML for a single quote entry with layout:
 * |Headshot| |Quote text| - |Author|
 * |       | |Primary Source| |addl. sources|
 * |       | |context|
 * |       | |share options|
 */
function buildQuoteEntryHtml(q, insideGroup, gangOpts) {
  const hideAuthor = gangOpts?.hideAuthor || false;
  const showAuthorAfter = gangOpts?.showAuthorAfter || false;
  const isLong = q.text.length > 280;
  const truncatedText = isLong ? q.text.substring(0, 280) + '...' : q.text;

  if (isLong) {
    _quoteTexts[q.id] = q.text;
  } else {
    _quoteTexts[q.id] = q.text;
  }

  // Headshot or initial placeholder
  const initial = (q.personName || '?').charAt(0).toUpperCase();
  const headshotHtml = q.photoUrl
    ? `<img src="${escapeHtml(q.photoUrl)}" alt="${escapeHtml(q.personName)}" class="quote-headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  // Quote type indicator (direct vs indirect)
  const quoteTypeHtml = q.quoteType === 'indirect'
    ? `<span class="quote-type-badge quote-type-indirect">Indirect</span>`
    : '';

  // Category context (party, team, etc.)
  const categoryCtxHtml = q.personCategoryContext
    ? `<span class="quote-category-context">${escapeHtml(q.personCategoryContext)}</span>`
    : '';

  // Primary source display (only if not in group) — links to article page when available
  const primarySource = q.primarySourceName || q.primarySourceDomain || '';
  const primarySourceHtml = !insideGroup && primarySource
    ? (q.articleId
      ? `<a href="/article/${q.articleId}" onclick="navigate(event, '/article/${q.articleId}')" class="quote-primary-source quote-primary-source-link">${escapeHtml(primarySource)}</a>`
      : `<span class="quote-primary-source">${escapeHtml(primarySource)}</span>`)
    : '';

  // Article title (only if not in group) — clickable link to article detail page
  const articleTitleHtml = !insideGroup && q.articleTitle && q.articleId
    ? `<a href="/article/${q.articleId}" onclick="navigate(event, '/article/${q.articleId}')" class="quote-article-title-link">${escapeHtml(q.articleTitle)}</a>`
    : !insideGroup && q.articleTitle
    ? `<span class="quote-article-title">${escapeHtml(q.articleTitle)}</span>`
    : '';

  // Publish date
  const dateStr = formatDateTime(q.articlePublishedAt);
  const dateHtml = !insideGroup && dateStr ? `<span class="quote-date-inline">${dateStr}</span>` : '';

  // Visibility toggle (admin only)
  const hiddenClass = q.isVisible === 0 ? ' quote-hidden' : '';
  const visibilityBtn = isAdmin
    ? `<button class="btn-visibility" onclick="toggleVisibility(event, ${q.id}, ${q.isVisible === 0 ? 'true' : 'false'})" title="${q.isVisible === 0 ? 'Show quote' : 'Hide quote'}">${q.isVisible === 0 ? '&#x1f441;&#xfe0f;&#x200d;&#x1f5e8;' : '&#x1f441;'}</button>`
    : '';

  // Admin edit button
  const editBtn = isAdmin
    ? `<button class="btn-edit-quote" onclick="editQuoteInline(event, ${q.id})" title="Edit quote">&#x270E;</button>`
    : '';

  // Context section — always visible, only if not in group
  const contextHtml = !insideGroup && q.context
    ? `<div class="quote-context">${escapeHtml(q.context)}</div>`
    : '';

  // Share options (only if not inside group — group shows share at bottom)
  const shareHtml = !insideGroup ? buildShareHtml(q) : '';

  // When ganged (consecutive same author in group), hide headshot and author row
  const showHeadshot = !hideAuthor;
  const showAuthorRow = !hideAuthor;

  return `
    <div class="quote-entry${hiddenClass}" id="qe-${q.id}">
      <div class="quote-layout">
        ${showHeadshot ? `<div class="quote-headshot-col">${headshotHtml}</div>` : `<div class="quote-headshot-col quote-headshot-spacer"></div>`}
        <div class="quote-content-col">
          <div class="quote-text-row">
            <p class="quote-text" id="qt-${q.id}">${escapeHtml(truncatedText)}</p>
            ${isLong ? `<a href="#" class="show-more-toggle" onclick="toggleQuoteText(event, ${q.id})">show more</a>` : ''}
          </div>
          ${showAuthorRow ? `<div class="quote-author-block">
            <div class="quote-author-row">
              <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
              ${quoteTypeHtml}
              ${dateHtml}
              ${visibilityBtn}
              ${editBtn}
            </div>
            ${q.personCategoryContext ? `<div class="quote-author-description">${escapeHtml(q.personCategoryContext)}</div>` : ''}
          </div>` : ''}
          ${showAuthorAfter ? `<div class="quote-author-block">
            <div class="quote-author-row">
              <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
              ${quoteTypeHtml}
              ${visibilityBtn}
              ${editBtn}
            </div>
            ${q.personCategoryContext ? `<div class="quote-author-description">${escapeHtml(q.personCategoryContext)}</div>` : ''}
          </div>` : ''}
          ${contextHtml}
          <div class="quote-sources-row">
            ${primarySourceHtml}
            ${articleTitleHtml}
          </div>
          ${shareHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Build HTML for an article group (multiple quotes from same article)
 * Groups with 3+ quotes collapse by default, showing first 2 with fade.
 */
function buildArticleGroupHtml(group) {
  const groupId = group.articleId;
  const dateStr = formatDateTime(group.articlePublishedAt);

  const primarySource = group.primarySourceName || group.primarySourceDomain || '';
  const primarySourceHtml = primarySource
    ? `<a href="/article/${groupId}" onclick="navigate(event, '/article/${groupId}')" class="source-link source-link-primary">${escapeHtml(primarySource)}</a>`
    : '';

  // Find a context from any quote in the group — always visible
  const contextQuote = group.quotes.find(q => q.context);
  const contextHtml = contextQuote
    ? `<div class="quote-context">${escapeHtml(contextQuote.context)}</div>`
    : '';

  // First quote's share button (share the article group)
  const firstQ = group.quotes[0];
  const shareHtml = buildShareHtml(firstQ);

  const collapsible = group.quotes.length >= 3;

  // Gang consecutive same-author quotes
  let quotesHtml = '';
  for (let i = 0; i < group.quotes.length; i++) {
    const q = group.quotes[i];
    const prevAuthor = i > 0 ? group.quotes[i - 1].personId : null;
    const nextAuthor = i < group.quotes.length - 1 ? group.quotes[i + 1].personId : null;
    const isConsecutiveSameAuthor = q.personId === prevAuthor;
    const isLastInRun = q.personId !== nextAuthor;

    quotesHtml += buildQuoteEntryHtml(q, true, { hideAuthor: isConsecutiveSameAuthor, showAuthorAfter: isLastInRun && isConsecutiveSameAuthor });
  }

  // Twirl caret for collapsible groups
  const twirlHtml = collapsible
    ? `<span class="article-group-twirl" id="twirl-${groupId}" onclick="toggleArticleGroup(event, ${groupId})">&#x25b6;</span>`
    : '';

  const collapsedClass = collapsible ? ' article-group-collapsed' : '';

  return `
    <div class="article-group${collapsedClass}" id="ag-${groupId}">
      <div class="article-group-header">
        ${twirlHtml}
        <a href="/article/${groupId}" onclick="navigate(event, '/article/${groupId}')" class="article-group-title-link">${escapeHtml(group.articleTitle || 'Untitled Article')}</a>
        <span class="article-group-date">${dateStr}</span>
      </div>
      <div class="article-group-quotes" id="agq-${groupId}">
        ${quotesHtml}
        ${collapsible ? `<div class="article-group-fade" id="agf-${groupId}" onclick="toggleArticleGroup(event, ${groupId})"></div>` : ''}
      </div>
      <div class="article-group-footer">
        ${contextHtml}
        <div class="article-group-sources">
          ${primarySourceHtml}
        </div>
        ${shareHtml}
      </div>
    </div>
  `;
}

/**
 * Toggle article group collapse/expand
 */
function toggleArticleGroup(event, groupId) {
  event.preventDefault();
  const group = document.getElementById('ag-' + groupId);
  const twirl = document.getElementById('twirl-' + groupId);
  if (!group) return;

  if (group.classList.contains('article-group-collapsed')) {
    group.classList.remove('article-group-collapsed');
    if (twirl) twirl.innerHTML = '&#x25bc;';
  } else {
    group.classList.add('article-group-collapsed');
    if (twirl) twirl.innerHTML = '&#x25b6;';
  }
}

function toggleGroupContext(event, groupId) {
  event.preventDefault();
  const ctx = document.getElementById('ctx-' + groupId);
  const arrow = document.getElementById('ctx-arrow-' + groupId);
  if (!ctx) return;

  if (ctx.style.display === 'none') {
    ctx.style.display = 'block';
    if (arrow) arrow.innerHTML = '&#x25bc;';
  } else {
    ctx.style.display = 'none';
    if (arrow) arrow.innerHTML = '&#x25b6;';
  }
}

/**
 * Toggle context expand/collapse
 */
function toggleContext(event, quoteId) {
  event.preventDefault();
  const ctx = document.getElementById('ctx-' + quoteId);
  const arrow = document.getElementById('ctx-arrow-' + quoteId);
  if (!ctx) return;

  if (ctx.style.display === 'none') {
    ctx.style.display = 'block';
    if (arrow) arrow.innerHTML = '&#x25bc;';
  } else {
    ctx.style.display = 'none';
    if (arrow) arrow.innerHTML = '&#x25b6;';
  }
}

/**
 * Toggle quote visibility (admin PATCH call)
 */
async function toggleVisibility(event, quoteId, newVisible) {
  event.preventDefault();
  try {
    await API.patch(`/quotes/${quoteId}/visibility`, { isVisible: newVisible });
    const entry = document.getElementById('qe-' + quoteId);
    if (entry) {
      if (newVisible) {
        entry.classList.remove('quote-hidden');
      } else {
        entry.classList.add('quote-hidden');
      }
      // Re-render just the visibility button
      const btn = entry.querySelector('.btn-visibility');
      if (btn) {
        btn.setAttribute('onclick', `toggleVisibility(event, ${quoteId}, ${!newVisible})`);
        btn.setAttribute('title', newVisible ? 'Hide quote' : 'Show quote');
        btn.innerHTML = newVisible ? '&#x1f441;' : '&#x1f441;&#xfe0f;&#x200d;&#x1f5e8;';
      }
    }
  } catch (err) {
    console.error('Failed to toggle visibility:', err);
  }
}

/**
 * Inline edit a quote (admin only)
 */
async function editQuoteInline(event, quoteId) {
  event.preventDefault();
  const textEl = document.getElementById('qt-' + quoteId);
  if (!textEl) return;

  const currentText = _quoteTexts[quoteId] || textEl.textContent.replace(/^\u201c|\u201d$/g, '');
  const newText = prompt('Edit quote text:', currentText);
  if (newText === null || newText.trim() === '' || newText.trim() === currentText) return;

  try {
    await API.patch(`/quotes/${quoteId}`, { text: newText.trim() });
    _quoteTexts[quoteId] = newText.trim();
    textEl.textContent = newText.trim();
  } catch (err) {
    console.error('Failed to edit quote:', err);
  }
}

/**
 * Build category tabs HTML with sub-filters
 */
function buildCategoryTabsHtml(categories, activeCategory) {
  const catMap = {};
  for (const c of categories) {
    catMap[c.category] = c.count;
  }

  const broadOrder = ['All', 'Politicians', 'Professionals', 'Other'];

  let tabs = `<div class="category-tabs">`;
  for (const cat of broadOrder) {
    const count = catMap[cat] || 0;
    tabs += `<button class="category-tab ${activeCategory === cat ? 'active' : ''}" onclick="filterByCategory('${escapeHtml(cat)}')">${escapeHtml(cat)} ${count > 0 ? `<span class="cat-count">${count}</span>` : ''}</button>`;
  }
  tabs += `</div>`;

  // Sub-filters for the active category
  const subs = SUB_FILTERS[activeCategory];
  if (subs && activeCategory !== 'All') {
    tabs += `<div class="sub-filters">`;
    tabs += `<button class="sub-filter-btn ${_activeSubFilter === '' ? 'active' : ''}" onclick="filterBySub('')">All</button>`;
    for (const sf of subs) {
      tabs += `<button class="sub-filter-btn ${_activeSubFilter === sf ? 'active' : ''}" onclick="filterBySub('${escapeHtml(sf)}')">${escapeHtml(sf)}</button>`;
    }
    tabs += `</div>`;
  }

  return tabs;
}

/**
 * Filter by broad category
 */
function filterByCategory(category) {
  _activeCategory = category;
  _activeSubFilter = '';
  renderHome();
}

/**
 * Filter by sub-filter within category
 */
function filterBySub(sub) {
  _activeSubFilter = sub;
  renderHome();
}

/**
 * Render the homepage with quotes
 */
async function renderHome() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading quotes...</div>';

  // Check for search query param
  const params = new URLSearchParams(window.location.search);
  _currentSearch = params.get('search') || '';

  // Update search input
  const searchInput = document.getElementById('header-search-input');
  if (searchInput) searchInput.value = _currentSearch;

  try {
    const queryParams = new URLSearchParams({
      page: '1',
      limit: '50',
      category: _activeCategory,
    });
    if (_activeSubFilter) queryParams.set('subFilter', _activeSubFilter);
    if (_currentSearch) queryParams.set('search', _currentSearch);

    const [quotesData, reviewStats] = await Promise.all([
      API.get('/quotes?' + queryParams.toString()),
      API.get('/review/stats').catch(() => ({ pending: 0 })),
    ]);

    // Update review badge
    updateReviewBadge(reviewStats.pending);

    let html = '';

    // Search results header
    if (_currentSearch) {
      html += `<div class="search-results-header">
        <h2>Search results for "${escapeHtml(_currentSearch)}"</h2>
        <button class="btn btn-secondary btn-sm" onclick="clearSearch()">Clear Search</button>
      </div>`;
    }

    // Category tabs
    if (quotesData.categories && quotesData.categories.length > 0) {
      html += buildCategoryTabsHtml(quotesData.categories, _activeCategory);
    }

    if (quotesData.quotes.length === 0) {
      html += `
        <div class="empty-state">
          <h3>No quotes yet</h3>
          <p>Quotes will appear here as they are extracted from news articles.</p>
          <p>Add news sources in <a href="/settings" onclick="navigate(event, '/settings')" style="color:var(--accent)">Settings</a> to start extracting quotes.</p>
        </div>
      `;
    } else {
      html += `<p class="quote-count">${quotesData.total} quotes collected</p>`;

      // Group quotes by article
      const { multiQuoteGroups, singleQuoteGroups, ungrouped } = groupQuotesByArticle(quotesData.quotes);

      // Render multi-quote article groups first
      for (const group of multiQuoteGroups) {
        html += buildArticleGroupHtml(group);
      }

      // Render single-quote article groups with same card format
      for (const group of singleQuoteGroups) {
        html += buildArticleGroupHtml(group);
      }

      // Render ungrouped quotes as individual entries
      for (const q of ungrouped) {
        html += buildQuoteEntryHtml(q, false);
      }

      // Pagination
      if (quotesData.totalPages > 1) {
        html += '<div class="pagination">';
        for (let i = 1; i <= Math.min(quotesData.totalPages, 10); i++) {
          html += `<button class="page-btn ${i === quotesData.page ? 'active' : ''}" onclick="loadQuotesPage(${i})">${i}</button>`;
        }
        if (quotesData.totalPages > 10) {
          html += `<span class="pagination-ellipsis">...</span>`;
          html += `<button class="page-btn" onclick="loadQuotesPage(${quotesData.totalPages})">${quotesData.totalPages}</button>`;
        }
        html += '</div>';
      }
    }

    content.innerHTML = html;

    // Restore scroll position if returning from article/quote page
    if (_pendingScrollRestore) {
      _pendingScrollRestore = false;
      requestAnimationFrame(() => {
        window.scrollTo(0, _homeScrollY);
      });
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error loading quotes</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function clearSearch() {
  _currentSearch = '';
  const searchInput = document.getElementById('header-search-input');
  if (searchInput) searchInput.value = '';
  window.history.pushState({}, '', '/');
  renderHome();
}

/**
 * Load a specific page of quotes
 */
async function loadQuotesPage(page) {
  const content = document.getElementById('content');
  try {
    const queryParams = new URLSearchParams({
      page: String(page),
      limit: '50',
      category: _activeCategory,
    });
    if (_activeSubFilter) queryParams.set('subFilter', _activeSubFilter);
    if (_currentSearch) queryParams.set('search', _currentSearch);

    const quotesData = await API.get('/quotes?' + queryParams.toString());

    let html = '';

    // Category tabs
    if (quotesData.categories && quotesData.categories.length > 0) {
      html += buildCategoryTabsHtml(quotesData.categories, _activeCategory);
    }

    html += `<p class="quote-count">Page ${page} of ${quotesData.totalPages} &middot; ${quotesData.total} quotes collected</p>`;

    const { multiQuoteGroups, singleQuoteGroups, ungrouped } = groupQuotesByArticle(quotesData.quotes);

    for (const group of multiQuoteGroups) {
      html += buildArticleGroupHtml(group);
    }
    for (const group of singleQuoteGroups) {
      html += buildArticleGroupHtml(group);
    }
    for (const q of ungrouped) {
      html += buildQuoteEntryHtml(q, false);
    }

    // Pagination
    if (quotesData.totalPages > 1) {
      html += '<div class="pagination">';
      const startPage = Math.max(1, page - 4);
      const endPage = Math.min(quotesData.totalPages, page + 4);

      if (startPage > 1) {
        html += `<button class="page-btn" onclick="loadQuotesPage(1)">1</button>`;
        if (startPage > 2) html += `<span class="pagination-ellipsis">...</span>`;
      }

      for (let i = startPage; i <= endPage; i++) {
        html += `<button class="page-btn ${i === page ? 'active' : ''}" onclick="loadQuotesPage(${i})">${i}</button>`;
      }

      if (endPage < quotesData.totalPages) {
        if (endPage < quotesData.totalPages - 1) html += `<span class="pagination-ellipsis">...</span>`;
        html += `<button class="page-btn" onclick="loadQuotesPage(${quotesData.totalPages})">${quotesData.totalPages}</button>`;
      }
      html += '</div>';
    }

    content.innerHTML = html;
  } catch (err) {
    console.error('Error loading page:', err);
  }
}

/**
 * Update the review badge count
 */
function updateReviewBadge(count) {
  const badge = document.getElementById('review-badge');
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  }
}

/**
 * Handle new quotes from Socket.IO
 * Show a non-jarring notification banner instead of re-rendering the page.
 */
function handleNewQuotes(quotes) {
  if (window.location.pathname === '/' || window.location.pathname === '') {
    _pendingNewQuotes += (quotes ? quotes.length : 0);
    showNewQuotesBanner();
  }
}

/**
 * Show a banner at the top of the feed indicating new quotes are available.
 */
function showNewQuotesBanner() {
  if (_pendingNewQuotes <= 0) return;

  let banner = document.getElementById('new-quotes-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'new-quotes-banner';
    banner.className = 'new-quotes-banner';
    const content = document.getElementById('content');
    if (content && content.firstChild) {
      content.insertBefore(banner, content.firstChild);
    }
  }

  const label = _pendingNewQuotes === 1 ? '1 new quote' : `${_pendingNewQuotes} new quotes`;
  banner.innerHTML = `${label} available <button class="new-quotes-refresh-btn" onclick="loadNewQuotes()">Refresh</button>`;
  banner.style.display = '';
}

/**
 * Load new quotes: re-render while preserving scroll position.
 */
function loadNewQuotes() {
  _pendingNewQuotes = 0;
  const banner = document.getElementById('new-quotes-banner');
  if (banner) banner.remove();
  const scrollY = window.scrollY;
  renderHome().then(() => {
    window.scrollTo(0, scrollY);
  });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Toggle between truncated and full quote text
 */
function toggleQuoteText(event, quoteId) {
  event.preventDefault();
  const el = document.getElementById('qt-' + quoteId);
  const toggle = event.target;
  const fullText = _quoteTexts[quoteId];
  if (!el || !fullText) return;

  if (toggle.textContent === 'show more') {
    el.textContent = '\u201c' + fullText + '\u201d';
    toggle.textContent = 'show less';
  } else {
    el.textContent = '\u201c' + fullText.substring(0, 280) + '...\u201d';
    toggle.textContent = 'show more';
  }
}
