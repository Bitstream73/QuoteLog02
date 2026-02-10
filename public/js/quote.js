async function renderQuote(id) {
  const content = document.getElementById('content');
  content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(1) : '<div class="loading">Loading quote...</div>';
  try {
    const data = await API.get(`/quotes/${id}`);
    if (!data.quote) {
      content.innerHTML = '<div class="empty-state"><h3>Quote not found</h3><p><a href="/" onclick="navigate(event, \'/\')" style="color:var(--accent)">Back to home</a></p></div>';
      return;
    }
    const q = data.quote;
    const dateStr = formatDateTime(q.createdAt);

    // Headshot
    const initial = (q.personName || '?').charAt(0).toUpperCase();
    const placeholderDiv = `<div class="quote-headshot-placeholder">${initial}</div>`;
    const headshotHtml = q.photoUrl
      ? `<img src="${escapeHtml(q.photoUrl)}" alt="${escapeHtml(q.personName)}" class="quote-headshot" onerror="this.outerHTML='<div class=\\'quote-headshot-placeholder\\'>${initial}</div>'">`
      : (typeof isAdmin !== 'undefined' && isAdmin
        ? `<a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((q.personName || '') + ' ' + (q.personDisambiguation || ''))}" target="_blank" rel="noopener" class="admin-headshot-search" title="Search Google Images">${placeholderDiv}</a>`
        : placeholderDiv);

    // Quote type
    const quoteTypeHtml = q.quoteType === 'indirect'
      ? `<span class="quote-type-badge quote-type-indirect">Indirect</span>`
      : '';

    // Vote controls for detail page
    const voteHtml = typeof renderVoteControls === 'function'
      ? renderVoteControls(q.id, q.voteScore || 0, q.userVote || 0)
      : '';

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>
      <div class="quote-detail-card">
        <div class="quote-layout" style="gap:1.25rem">
          ${voteHtml}
          <div class="quote-headshot-col">${headshotHtml}</div>
          <div class="quote-content-col">
            <div class="quote-detail-text">${escapeHtml(q.text)}</div>
            <div class="quote-author-block" style="margin-top:0.75rem">
              <div class="quote-author-row">
                <a href="/author/${q.personId}" onclick="navigate(event, '/author/${q.personId}')" class="author-link">${escapeHtml(q.personName)}</a>
                ${quoteTypeHtml}
              </div>
              ${q.personDisambiguation ? `<div class="quote-author-description">${escapeHtml(q.personDisambiguation)}</div>` : ''}
            </div>
            ${q.context ? `<div class="quote-context" style="margin-top:0.75rem">${escapeHtml(q.context)}</div>` : ''}
            ${dateStr ? `<div class="quote-date-inline" style="margin-top:0.5rem">${dateStr}</div>` : ''}
            ${typeof buildAdminActionsHtml === 'function' ? buildAdminActionsHtml({
              id: q.id, personId: q.personId, personName: q.personName,
              text: q.text, context: q.context, isVisible: q.isVisible,
              personCategory: null, personCategoryContext: null,
              disambiguation: q.personDisambiguation
            }) : ''}
          </div>
        </div>
      </div>
    `;

    // Articles / Sources
    if (data.articles && data.articles.length > 0) {
      html += '<h2 style="margin:2rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem">Sources</h2>';
      html += '<div class="quote-detail-sources">';
      for (const a of data.articles) {
        const sourceName = a.source_name || a.domain || 'Source';
        const articleDate = a.published_at ? formatDateTime(a.published_at) : '';
        html += `
          <div class="quote-detail-source-item">
            <a href="/article/${a.id}" onclick="navigate(event, '/article/${a.id}')" class="quote-article-title-link">${escapeHtml(a.title || 'Untitled Article')}</a>
            <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.25rem">
              <span class="quote-primary-source">${escapeHtml(sourceName)}</span>
              ${articleDate ? `<span class="quote-date-inline">${articleDate}</span>` : ''}
              ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="font-family:var(--font-ui);font-size:0.75rem;color:var(--accent);text-decoration:none">View original &rarr;</a>` : ''}
            </div>
          </div>
        `;
      }
      html += '</div>';
    }

    // Share buttons
    html += `<div style="margin-top:1.5rem">${buildShareHtml(q)}</div>`;

    // Related quotes from same person
    if (data.relatedQuotes && data.relatedQuotes.length > 0) {
      html += `<h2 style="margin:2.5rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem;padding-top:1.5rem;border-top:1px solid var(--border)">More from ${escapeHtml(q.personName)}</h2>`;
      for (const rq of data.relatedQuotes) {
        html += `<a href="/quote/${rq.id}" class="card-link" onclick="navigate(event, '/quote/${rq.id}')"><div class="card"><div class="quote-text">${escapeHtml(rq.text)}</div><div class="quote-date-inline" style="margin-top:0.5rem">${formatDateTime(rq.createdAt)}</div></div></a>`;
      }
    }

    // Variants
    if (data.variants && data.variants.length > 0) {
      html += `<h2 style="margin:2.5rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem;padding-top:1.5rem;border-top:1px solid var(--border)">Variants</h2>`;
      html += '<p style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-muted);margin-bottom:1rem">Same quote reported with different wording across sources.</p>';
      for (const v of data.variants) {
        html += `<div class="quote-entry" style="padding:1rem 0"><p class="quote-text">${escapeHtml(v.text)}</p></div>`;
      }
    }

    content.innerHTML = html;
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}
