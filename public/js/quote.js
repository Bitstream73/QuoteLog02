async function renderQuote(id) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading quote...</div>';
  try {
    const data = await API.get(`/quotes/${id}`);
    if (!data.quote) { content.innerHTML = '<div class="empty-state"><h3>Quote not found</h3><p><a href="/" onclick="navigate(event, '/')">Back to home</a></p></div>'; return; }
    const q = data.quote;
    const date = q.published_date ? new Date(q.published_date * 1000).toLocaleDateString() : 'Unknown date';
    let html = `<p style="margin-bottom:1rem"><a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">&larr; Back to quotes</a></p><div class="quote-detail-text">${escapeHtml(q.text)}</div><div style="margin-bottom:2rem"><span class="quote-author" onclick="navigate(event, '/author/${encodeURIComponent(q.author)}')">${escapeHtml(q.author)}</span> &middot; ${date}</div>`;
    html += '<h2 style="margin-bottom:1rem">Sources</h2>';
    if (data.sources.length === 0) { html += '<p style="color:var(--text-muted)">No additional sources found.</p>'; }
    else { html += '<ul class="sources-list">'; for (const s of data.sources) { html += `<li><a href="${escapeHtml(s.source_url || '#')}" target="_blank">${escapeHtml(s.source_name || 'Source')}</a></li>`; } html += '</ul>'; }
    if (data.relatedQuotes.length > 0) { html += '<h2 style="margin:2rem 0 1rem">More from ' + escapeHtml(q.author) + '</h2>'; for (const rq of data.relatedQuotes) { html += `<a href="/quote/${rq.id}" class="card-link" onclick="navigate(event, '/quote/${rq.id}')"><div class="card"><div class="quote-text">${escapeHtml(rq.text.substring(0, 150))}${rq.text.length > 150 ? '...' : ''}</div></div></a>`; } }
    content.innerHTML = html;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`; }
}
