// Homepage - Quote List Display

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

// Current active category filter
let _activeCategory = 'Politician';
let _currentSearch = '';

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

  // Convert to array, groups with multiple quotes first, then singles
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
  const el = document.getElementById('qe-' + quoteId);
  if (!el) return;

  const quoteText = _quoteTexts[quoteId] || el.querySelector('.quote-text')?.textContent || '';
  const authorName = el.querySelector('.author-link')?.textContent || '';
  const shareUrl = window.location.origin + '/quote/' + quoteId;
  const fullText = `"${quoteText}" - ${authorName}`;

  switch (channel) {
    case 'x':
      window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(fullText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
      break;
    case 'facebook':
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(fullText)}`, '_blank');
      break;
    case 'email': {
      const subject = encodeURIComponent(`Quote from ${authorName} - Quote Log`);
      const body = encodeURIComponent(`${fullText}\n\nRead more: ${shareUrl}\n\n---\nShared from Quote Log - What, When, & Why They Said It.`);
      window.location.href = `mailto:?subject=${subject}&body=${body}`;
      break;
    }
    case 'copy':
      navigator.clipboard.writeText(`${fullText}\n${shareUrl}`).then(() => {
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
 * |       | |twirl down context|
 * |       | |share options|
 */
function buildQuoteEntryHtml(q, insideGroup) {
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

  // Category context (party, team, etc.)
  const categoryCtxHtml = q.personCategoryContext
    ? `<span class="quote-category-context">${escapeHtml(q.personCategoryContext)}</span>`
    : '';

  // Source links (only show if not inside an article group, or show per-quote sources)
  const sourceLinks = insideGroup ? '' : (q.sourceUrls || [])
    .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
    .join(' ');

  // Primary source display (only if not in group)
  const primarySource = q.primarySourceName || q.primarySourceDomain || '';
  const primarySourceHtml = !insideGroup && primarySource
    ? `<span class="quote-primary-source">${escapeHtml(primarySource)}</span>`
    : '';

  // Article title (only if not in group)
  const articleTitleHtml = !insideGroup && q.articleTitle
    ? `<span class="quote-article-title">${escapeHtml(q.articleTitle)}</span>`
    : '';

  // Publish date
  const dateStr = q.articlePublishedAt
    ? new Date(q.articlePublishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
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

  // Context section (expandable) — only if not in group
  const contextHtml = !insideGroup && q.context
    ? `<div class="quote-context-toggle" onclick="toggleContext(event, ${q.id})">
        <span class="context-arrow" id="ctx-arrow-${q.id}">&#x25b6;</span> Context
      </div>
      <div class="quote-context" id="ctx-${q.id}" style="display:none">${escapeHtml(q.context)}</div>`
    : '';

  // Share options (only if not inside group — group shows share at bottom)
  const shareHtml = !insideGroup ? buildShareHtml(q) : '';

  return `
    <div class="quote-entry${hiddenClass}" id="qe-${q.id}">
      <div class="quote-layout">
        <div class="quote-headshot-col">
          ${headshotHtml}
        </div>
        <div class="quote-content-col">
          <div class="quote-text-row">
            <p class="quote-text" id="qt-${q.id}">${escapeHtml(truncatedText)}</p>
            ${isLong ? `<a href="#" class="show-more-toggle" onclick="toggleQuoteText(event, ${q.id})">show more</a>` : ''}
          </div>
          <div class="quote-author-row">
            <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
            ${categoryCtxHtml}
            ${dateHtml}
            ${visibilityBtn}
            ${editBtn}
          </div>
          <div class="quote-sources-row">
            ${primarySourceHtml}
            ${sourceLinks}
            ${articleTitleHtml}
          </div>
          ${contextHtml}
          ${shareHtml}
        </div>
      </div>
    </div>
  `;
}

/**
 * Build HTML for an article group (multiple quotes from same article)
 */
function buildArticleGroupHtml(group) {
  const dateStr = group.articlePublishedAt
    ? new Date(group.articlePublishedAt).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    : '';

  const sourceLinks = [];
  const allUrls = new Set();
  for (const q of group.quotes) {
    (q.sourceUrls || []).forEach(u => allUrls.add(u));
  }
  allUrls.forEach(url => {
    sourceLinks.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`);
  });

  const primarySource = group.primarySourceName || group.primarySourceDomain || '';
  const primarySourceHtml = primarySource
    ? `<a href="${escapeHtml(group.articleUrl || '#')}" target="_blank" rel="noopener" class="source-link source-link-primary">${escapeHtml(primarySource)}</a>`
    : '';

  // Find a context from any quote in the group
  const contextQuote = group.quotes.find(q => q.context);
  const contextHtml = contextQuote
    ? `<div class="quote-context-toggle" onclick="toggleGroupContext(event, 'grp-${group.articleId}')">
        <span class="context-arrow" id="ctx-arrow-grp-${group.articleId}">&#x25b6;</span> Context
      </div>
      <div class="quote-context" id="ctx-grp-${group.articleId}" style="display:none">${escapeHtml(contextQuote.context)}</div>`
    : '';

  // First quote's share button (share the article group)
  const firstQ = group.quotes[0];
  const shareHtml = buildShareHtml(firstQ);

  let quotesHtml = '';
  for (const q of group.quotes) {
    quotesHtml += buildQuoteEntryHtml(q, true);
  }

  return `
    <div class="article-group">
      <div class="article-group-header">
        <span class="article-group-title">${escapeHtml(group.articleTitle || 'Untitled Article')}</span>
        <span class="article-group-date">${dateStr}</span>
      </div>
      ${quotesHtml}
      <div class="article-group-footer">
        <div class="article-group-sources">
          ${primarySourceHtml}
          ${sourceLinks.join(' ')}
        </div>
        ${contextHtml}
        ${shareHtml}
      </div>
    </div>
  `;
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
 * Build category tabs HTML
 */
function buildCategoryTabsHtml(categories, activeCategory) {
  const defaultOrder = ['Politician', 'Government Official', 'Business Leader', 'Entertainer', 'Athlete', 'Pundit', 'Journalist', 'Scientist/Academic', 'Legal/Judicial', 'Military/Defense', 'Activist/Advocate', 'Religious Leader', 'Other'];
  const catMap = {};
  for (const c of categories) {
    catMap[c.category || 'Other'] = c.count;
  }

  let tabs = `<div class="category-tabs">`;
  tabs += `<button class="category-tab ${activeCategory === 'All' ? 'active' : ''}" onclick="filterByCategory('All')">All</button>`;

  for (const cat of defaultOrder) {
    if (catMap[cat]) {
      tabs += `<button class="category-tab ${activeCategory === cat ? 'active' : ''}" onclick="filterByCategory('${escapeHtml(cat)}')">${escapeHtml(cat)} <span class="cat-count">${catMap[cat]}</span></button>`;
    }
  }

  tabs += `</div>`;
  return tabs;
}

/**
 * Filter by category
 */
function filterByCategory(category) {
  _activeCategory = category;
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

      // Render single-quote groups and ungrouped as individual entries
      for (const group of singleQuoteGroups) {
        html += buildQuoteEntryHtml(group.quotes[0], false);
      }
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
      html += buildQuoteEntryHtml(group.quotes[0], false);
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
 */
function handleNewQuotes(quotes) {
  // If on homepage, prepend new quotes
  if (window.location.pathname === '/' || window.location.pathname === '') {
    const content = document.getElementById('content');
    const quoteEntries = content.querySelectorAll('.quote-entry');

    if (quoteEntries.length > 0) {
      const firstEntry = quoteEntries[0];
      for (const q of quotes.reverse()) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildQuoteEntryHtml(q, false);
        const newEntry = wrapper.firstElementChild;
        newEntry.classList.add('new-quote');
        firstEntry.parentNode.insertBefore(newEntry, firstEntry);

        // Remove animation class after animation completes
        setTimeout(() => newEntry.classList.remove('new-quote'), 1000);
      }
    }
  }
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
