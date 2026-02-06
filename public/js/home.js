// Homepage - Quote List Display

// Store full quote texts for show more/less toggle
const _quoteTexts = {};

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
 * Build HTML for a single quote entry with new layout:
 * |Headshot| |Quote text| - |Author|
 * |       | |Primary Source| |addl. sources|
 * |       | |twirl down context|
 */
function buildQuoteEntryHtml(q) {
  const isLong = q.text.length > 280;
  const truncatedText = isLong ? q.text.substring(0, 280) + '...' : q.text;

  if (isLong) {
    _quoteTexts[q.id] = q.text;
  }

  // Headshot or initial placeholder
  const initial = (q.personName || '?').charAt(0).toUpperCase();
  const headshotHtml = q.photoUrl
    ? `<img src="${escapeHtml(q.photoUrl)}" alt="${escapeHtml(q.personName)}" class="quote-headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'">`
    : `<div class="quote-headshot-placeholder">${initial}</div>`;

  // Source links
  const sourceLinks = (q.sourceUrls || [])
    .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
    .join(' ');

  // Primary source display
  const primarySource = q.primarySourceName || q.primarySourceDomain || '';
  const primarySourceHtml = primarySource
    ? `<span class="quote-primary-source">${escapeHtml(primarySource)}</span>`
    : '';

  // Article title
  const articleTitleHtml = q.articleTitle
    ? `<span class="quote-article-title">${escapeHtml(q.articleTitle)}</span>`
    : '';

  // Publish date
  const dateStr = q.articlePublishedAt
    ? new Date(q.articlePublishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';
  const dateHtml = dateStr ? `<span class="quote-date-inline">${dateStr}</span>` : '';

  // Visibility toggle (admin only)
  const hiddenClass = q.isVisible === 0 ? ' quote-hidden' : '';
  const visibilityBtn = isAdmin
    ? `<button class="btn-visibility" onclick="toggleVisibility(event, ${q.id}, ${q.isVisible === 0 ? 'true' : 'false'})" title="${q.isVisible === 0 ? 'Show quote' : 'Hide quote'}">${q.isVisible === 0 ? '&#x1f441;&#xfe0f;&#x200d;&#x1f5e8;' : '&#x1f441;'}</button>`
    : '';

  // Context section (expandable)
  const contextHtml = q.context
    ? `<div class="quote-context-toggle" onclick="toggleContext(event, ${q.id})">
        <span class="context-arrow" id="ctx-arrow-${q.id}">&#x25b6;</span> Context
      </div>
      <div class="quote-context" id="ctx-${q.id}" style="display:none">${escapeHtml(q.context)}</div>`
    : '';

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
            ${dateHtml}
            ${visibilityBtn}
          </div>
          <div class="quote-sources-row">
            ${primarySourceHtml}
            ${sourceLinks}
            ${articleTitleHtml}
          </div>
          ${contextHtml}
        </div>
      </div>
    </div>
  `;
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
 * Render the homepage with quotes
 */
async function renderHome() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading quotes...</div>';

  try {
    const [quotesData, reviewStats] = await Promise.all([
      API.get('/quotes?page=1&limit=50'),
      API.get('/review/stats').catch(() => ({ pending: 0 })),
    ]);

    // Update review badge
    updateReviewBadge(reviewStats.pending);

    let html = `
      <h1 class="page-title">Latest Quotes</h1>
      <p class="page-subtitle">Noteworthy quotes extracted from today's news</p>
    `;

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

      for (const q of quotesData.quotes) {
        html += buildQuoteEntryHtml(q);
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

/**
 * Load a specific page of quotes
 */
async function loadQuotesPage(page) {
  const content = document.getElementById('content');
  try {
    const quotesData = await API.get(`/quotes?page=${page}&limit=50`);

    let html = `
      <h1 class="page-title">Latest Quotes</h1>
      <p class="page-subtitle">Noteworthy quotes extracted from today's news</p>
      <p class="quote-count">Page ${page} of ${quotesData.totalPages} &middot; ${quotesData.total} quotes collected</p>
    `;

    for (const q of quotesData.quotes) {
      html += buildQuoteEntryHtml(q);
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
        wrapper.innerHTML = buildQuoteEntryHtml(q);
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
