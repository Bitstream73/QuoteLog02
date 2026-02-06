async function renderArticle(id) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading article...</div>';

  try {
    const data = await API.get(`/articles/${id}`);
    if (!data.article) {
      content.innerHTML = '<div class="empty-state"><h3>Article not found</h3><p><a href="/" onclick="navigate(event, \'/\')" style="color:var(--accent)">Back to home</a></p></div>';
      return;
    }

    const a = data.article;
    const dateStr = formatDateTime(a.publishedAt);
    const sourceLabel = a.sourceName || a.sourceDomain || '';

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigate(event, '/')" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>
      <h1 class="page-title" style="font-size:1.8rem;margin-bottom:0.5rem">${escapeHtml(a.title || 'Untitled Article')}</h1>
      <div style="margin-bottom:2rem;font-family:var(--font-ui);font-size:0.85rem;color:var(--text-secondary);display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center">
        ${sourceLabel ? `<span class="quote-primary-source">${escapeHtml(sourceLabel)}</span>` : ''}
        ${dateStr ? `<span>${dateStr}</span>` : ''}
        ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">View original article &rarr;</a>` : ''}
      </div>
    `;

    if (data.quotes.length === 0) {
      html += '<div class="empty-state"><h3>No quotes from this article</h3></div>';
    } else {
      html += `<p class="quote-count">${data.quotes.length} quote${data.quotes.length !== 1 ? 's' : ''} from this article</p>`;
      for (const q of data.quotes) {
        // Re-use buildQuoteEntryHtml — pass as non-grouped with article metadata stripped (already in header)
        html += buildQuoteEntryHtml({
          ...q,
          articleId: null,
          articleTitle: null,
          articlePublishedAt: null,
          articleUrl: null,
          primarySourceDomain: null,
          primarySourceName: null,
        }, false);
      }
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}
