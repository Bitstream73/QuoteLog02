async function renderAuthor(id) {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading author...</div>';
  try {
    const data = await API.get(`/authors/${id}`);
    if (!data.author) { content.innerHTML = '<div class="empty-state"><h3>Author not found</h3><p><a href="/" onclick="navigate(event, '/')">Back to home</a></p></div>'; return; }
    const a = data.author;
    let html = `<p style="margin-bottom:1rem"><a href="/" onclick="navigate(event, '/')" style="color:var(--accent)">&larr; Back to quotes</a></p><div class="author-header"><div class="author-avatar">${a.name.charAt(0).toUpperCase()}</div><div><h1 class="page-title">${escapeHtml(a.name)}</h1><p class="page-subtitle">${data.quotes.length} quote${data.quotes.length !== 1 ? 's' : ''}</p></div></div>`;
    if (a.bio) { html += `<p style="margin-bottom:2rem;color:var(--text-secondary)">${escapeHtml(a.bio)}</p>`; }
    html += '<h2 style="margin-bottom:1rem">Quotes</h2>';
    if (data.quotes.length === 0) { html += '<p style="color:var(--text-muted)">No quotes found.</p>'; }
    else { for (const q of data.quotes) { const date = q.published_date ? new Date(q.published_date * 1000).toLocaleDateString() : ''; html += `<a href="/quote/${q.id}" class="card-link" onclick="navigate(event, '/quote/${q.id}')"><div class="card"><div class="quote-text">${escapeHtml(q.text.substring(0, 200))}${q.text.length > 200 ? '...' : ''}</div><div class="quote-meta"><span>${escapeHtml(q.source_name || '')}</span><span>${date}</span></div></div></a>`; } }
    content.innerHTML = html;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`; }
}
