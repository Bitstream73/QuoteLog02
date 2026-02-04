async function renderHome() {
  const content = document.getElementById('content');
  content.innerHTML = '<div class="loading">Loading quotes...</div>';
  try {
    const [quotesData, logsStats] = await Promise.all([API.get('/quotes?page=1&limit=20'), API.get('/logs/stats').catch(() => null)]);
    let errorBadge = '';
    if (logsStats && logsStats.errorCount24h > 0) { errorBadge = `<span class="error-badge">${logsStats.errorCount24h} errors</span>`; }
    let html = `<h1 class="page-title">Quote Log ${errorBadge}</h1><p class="page-subtitle">AI-powered quote extraction from news articles</p>`;
    if (quotesData.quotes.length === 0) {
      html += '<div class="empty-state"><h3>No quotes yet</h3><p>Quotes will appear here as they are extracted from news articles.</p></div>';
    } else {
      for (const q of quotesData.quotes) {
        const date = q.published_date ? new Date(q.published_date * 1000).toLocaleDateString() : 'Unknown date';
        const truncatedText = q.text.length > 200 ? q.text.substring(0, 200) + '...' : q.text;
        html += `<a href="/quote/${q.id}" class="card-link" onclick="navigate(event, '/quote/${q.id}')"><div class="card"><div class="quote-text">${escapeHtml(truncatedText)}</div><div class="quote-meta"><span class="quote-author" onclick="event.preventDefault(); event.stopPropagation(); navigate(event, '/author/${encodeURIComponent(q.author)}')">${escapeHtml(q.author)}</span><span>${escapeHtml(q.source_name || '')} &middot; ${date}</span></div></div></a>`;
      }
    }
    content.innerHTML = html;
  } catch (err) { content.innerHTML = `<div class="empty-state"><h3>Error loading quotes</h3><p>${escapeHtml(err.message)}</p></div>`; }
}
function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
