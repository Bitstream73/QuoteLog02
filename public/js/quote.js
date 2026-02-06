async function renderQuote(id) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading quote...</div>';
  try {
    const data = await API.get(`/quotes/${id}`);
    if (!data.quote) { content.innerHTML = '<div class="empty-state"><h3>Quote not found</h3><p><a href="/" onclick="navigate(event, \'/\')" style="color:var(--accent)">Back to home</a></p></div>'; return; }
    const q = data.quote;
    const date = q.published_date ? formatDateTime(q.published_date * 1000) : 'Unknown date';
    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigate(event, '/')" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>
      <div class="quote-detail-text">${escapeHtml(q.text)}</div>
      <div style="margin-bottom:2rem;font-family:var(--font-ui);font-size:0.9rem;color:var(--text-secondary)">
        <span style="font-weight:600;color:var(--text-primary);cursor:pointer" onclick="navigate(event, '/author/${encodeURIComponent(q.author)}')">${escapeHtml(q.author)}</span>
        <span style="margin:0 0.5rem">&middot;</span>
        <span>${date}</span>
      </div>
    `;
    html += '<h2 style="margin-bottom:1rem;font-family:var(--font-headline);font-size:1.3rem">Sources</h2>';
    if (data.sources.length === 0) { html += '<p style="color:var(--text-muted);font-family:var(--font-ui)">No additional sources found.</p>'; }
    else { html += '<ul class="sources-list">'; for (const s of data.sources) { html += `<li><a href="${escapeHtml(s.source_url || '#')}" target="_blank">${escapeHtml(s.source_name || 'Source')}</a></li>`; } html += '</ul>'; }
    if (data.relatedQuotes.length > 0) {
      html += '<h2 style="margin:2.5rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem;padding-top:1.5rem;border-top:1px solid var(--border)">More from ' + escapeHtml(q.author) + '</h2>';
      for (const rq of data.relatedQuotes) { html += `<a href="/quote/${rq.id}" class="card-link" onclick="navigate(event, '/quote/${rq.id}')"><div class="card"><div class="quote-text">${escapeHtml(rq.text.substring(0, 150))}${rq.text.length > 150 ? '...' : ''}</div></div></a>`; }
    }
    content.innerHTML = html;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`; }
}
