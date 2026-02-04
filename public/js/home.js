// Homepage - Quote List Display

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
      <h1 class="page-title">Quote Log</h1>
      <p class="page-subtitle">AI-powered quote extraction from news articles</p>
    `;

    if (quotesData.quotes.length === 0) {
      html += `
        <div class="empty-state">
          <h3>No quotes yet</h3>
          <p>Quotes will appear here as they are extracted from news articles.</p>
          <p>Add news sources in <a href="/settings" onclick="navigate(event, '/settings')">Settings</a> to start extracting quotes.</p>
        </div>
      `;
    } else {
      html += `<p class="quote-count">Showing ${quotesData.quotes.length} of ${quotesData.total} quotes</p>`;

      for (const q of quotesData.quotes) {
        const truncatedText = q.text.length > 280 ? q.text.substring(0, 280) + '...' : q.text;
        const sourceLinks = (q.sourceUrls || [])
          .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
          .join(' ');

        html += `
          <div class="quote-entry">
            <blockquote>
              <p class="quote-text">"${escapeHtml(truncatedText)}"</p>
              <cite>
                &mdash; <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
              </cite>
            </blockquote>
            <div class="quote-sources">
              ${sourceLinks}
            </div>
          </div>
        `;
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
      <h1 class="page-title">Quote Log</h1>
      <p class="page-subtitle">AI-powered quote extraction from news articles</p>
      <p class="quote-count">Showing page ${page} of ${quotesData.totalPages} (${quotesData.total} total quotes)</p>
    `;

    for (const q of quotesData.quotes) {
      const truncatedText = q.text.length > 280 ? q.text.substring(0, 280) + '...' : q.text;
      const sourceLinks = (q.sourceUrls || [])
        .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
        .join(' ');

      html += `
        <div class="quote-entry">
          <blockquote>
            <p class="quote-text">"${escapeHtml(truncatedText)}"</p>
            <cite>
              &mdash; <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
            </cite>
          </blockquote>
          <div class="quote-sources">
            ${sourceLinks}
          </div>
        </div>
      `;
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
        const sourceLinks = (q.sourceUrls || [])
          .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
          .join(' ');

        const newEntry = document.createElement('div');
        newEntry.className = 'quote-entry new-quote';
        newEntry.innerHTML = `
          <blockquote>
            <p class="quote-text">"${escapeHtml(q.text)}"</p>
            <cite>
              &mdash; <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
            </cite>
          </blockquote>
          <div class="quote-sources">
            ${sourceLinks}
          </div>
        `;

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
