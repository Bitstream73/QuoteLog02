// Author Detail Page

async function renderAuthor(id) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading author...</div>';

  try {
    const [authorData, quotesData] = await Promise.all([
      API.get(`/authors/${id}`),
      API.get(`/authors/${id}/quotes?limit=50`),
    ]);

    if (!authorData.author) {
      content.innerHTML = `
        <div class="empty-state">
          <h3>Author not found</h3>
          <p><a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">Back to home</a></p>
        </div>
      `;
      return;
    }

    const a = authorData.author;
    const aliases = authorData.aliases || [];
    const initial = a.name.charAt(0).toUpperCase();

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigate(event, '/')" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>

      <div class="author-header">
        <div class="author-avatar">${initial}</div>
        <div class="author-info">
          <h1 class="page-title">${escapeHtml(a.name)}</h1>
          ${a.disambiguation ? `<p class="author-disambiguation">${escapeHtml(a.disambiguation)}</p>` : ''}
          <p class="page-subtitle" style="border-bottom:none;padding-bottom:0;margin-bottom:0">${a.quoteCount} quote${a.quoteCount !== 1 ? 's' : ''}</p>
        </div>
      </div>
    `;

    // Show aliases if any
    if (aliases.length > 1) {
      const aliasNames = aliases.map(al => al.alias).filter(al => al !== a.name);
      if (aliasNames.length > 0) {
        html += `
          <div class="author-aliases">
            <strong>Also known as:</strong> ${aliasNames.map(n => escapeHtml(n)).join(', ')}
          </div>
        `;
      }
    }

    html += '<h2 style="margin:2rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem">Quotes</h2>';

    if (quotesData.quotes.length === 0) {
      html += '<p style="color:var(--text-muted);font-family:var(--font-ui)">No quotes found for this author.</p>';
    } else {
      for (const q of quotesData.quotes) {
        const date = q.createdAt ? new Date(q.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
        const sourceLinks = (q.sourceUrls || [])
          .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
          .join(' ');

        html += `
          <div class="quote-entry">
            <blockquote>
              <p class="quote-text">"${escapeHtml(q.text)}"</p>
            </blockquote>
            <div class="quote-sources">
              ${sourceLinks}
            </div>
            <div class="quote-date">${date}</div>
          </div>
        `;
      }

      // Pagination
      if (quotesData.totalPages > 1) {
        html += `
          <div class="pagination">
            <span class="pagination-info">Page 1 of ${quotesData.totalPages}</span>
            <button class="page-btn" onclick="loadAuthorQuotesPage('${id}', 2)">Next &rarr;</button>
          </div>
        `;
      }
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadAuthorQuotesPage(authorId, page) {
  try {
    const quotesData = await API.get(`/authors/${authorId}/quotes?page=${page}&limit=50`);

    const quotesContainer = document.querySelector('.page-title').closest('.author-header').parentElement;
    const existingQuotes = quotesContainer.querySelectorAll('.quote-entry, .pagination');
    existingQuotes.forEach(el => el.remove());

    let html = '';
    for (const q of quotesData.quotes) {
      const date = q.createdAt ? new Date(q.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
      const sourceLinks = (q.sourceUrls || [])
        .map(url => `<a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="source-link">${escapeHtml(extractDomain(url))}</a>`)
        .join(' ');

      html += `
        <div class="quote-entry">
          <blockquote>
            <p class="quote-text">"${escapeHtml(q.text)}"</p>
          </blockquote>
          <div class="quote-sources">
            ${sourceLinks}
          </div>
          <div class="quote-date">${date}</div>
        </div>
      `;
    }

    // Pagination
    html += '<div class="pagination">';
    if (page > 1) {
      html += `<button class="page-btn" onclick="loadAuthorQuotesPage('${authorId}', ${page - 1})">&larr; Previous</button>`;
    }
    html += `<span class="pagination-info">Page ${page} of ${quotesData.totalPages}</span>`;
    if (page < quotesData.totalPages) {
      html += `<button class="page-btn" onclick="loadAuthorQuotesPage('${authorId}', ${page + 1})">Next &rarr;</button>`;
    }
    html += '</div>';

    quotesContainer.insertAdjacentHTML('beforeend', html);
  } catch (err) {
    console.error('Error loading author quotes page:', err);
  }
}
