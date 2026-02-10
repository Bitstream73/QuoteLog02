// Author Detail Page

// Build quote HTML for author page (matches homepage metadata)
function buildAuthorQuoteHtml(q, authorName, authorCategoryContext) {
  const isLong = q.text.length > 280;
  const truncatedText = isLong ? q.text.substring(0, 280) + '...' : q.text;

  // Store full text for show more toggle
  if (typeof _quoteTexts !== 'undefined') {
    _quoteTexts[q.id] = q.text;
  }

  // Quote type indicator (direct vs indirect)
  const quoteTypeHtml = q.quoteType === 'indirect'
    ? `<span class="quote-type-badge quote-type-indirect">Indirect</span>`
    : '';

  // Publish date
  const dateStr = formatDateTime(q.articlePublishedAt || q.createdAt);
  const dateHtml = dateStr ? `<span class="quote-date-inline">${dateStr}</span>` : '';

  // Primary source display — links to article page when available
  const primarySource = q.primarySourceName || q.primarySourceDomain || '';
  const primarySourceHtml = primarySource
    ? (q.articleId
      ? `<a href="/article/${q.articleId}" onclick="navigate(event, '/article/${q.articleId}')" class="quote-primary-source quote-primary-source-link">${escapeHtml(primarySource)}</a>`
      : `<span class="quote-primary-source">${escapeHtml(primarySource)}</span>`)
    : '';

  // Article title — clickable link to article detail page
  const articleTitleHtml = q.articleTitle && q.articleId
    ? `<a href="/article/${q.articleId}" onclick="navigate(event, '/article/${q.articleId}')" class="quote-article-title-link">${escapeHtml(q.articleTitle)}</a>`
    : q.articleTitle
    ? `<span class="quote-article-title">${escapeHtml(q.articleTitle)}</span>`
    : '';

  // Context section
  const contextHtml = q.context
    ? `<div class="quote-context">${escapeHtml(q.context)}</div>`
    : '';

  // Share buttons — build share data with author info
  const shareQ = {
    id: q.id,
    text: q.text,
    personName: authorName,
    personCategoryContext: authorCategoryContext || '',
    context: q.context || '',
    articleTitle: q.articleTitle || '',
    primarySourceName: q.primarySourceName || q.primarySourceDomain || '',
    articlePublishedAt: q.articlePublishedAt || q.createdAt || '',
  };
  const shareHtml = buildShareHtml(shareQ);

  // Vote controls
  const voteHtml = typeof renderVoteControls === 'function'
    ? renderVoteControls(q.id, q.voteScore || 0, q.userVote || 0)
    : '';

  return `
    <div class="quote-entry" id="qe-${q.id}">
      <div class="quote-entry-with-vote">
        ${voteHtml}
        <div class="quote-entry-content">
          <div class="quote-text-row">
            <p class="quote-text" id="qt-${q.id}">${escapeHtml(truncatedText)}</p>
            ${isLong ? `<a href="#" class="show-more-toggle" onclick="toggleQuoteText(event, ${q.id})">show more</a>` : ''}
          </div>
          <div class="quote-author-block">
            <div class="quote-author-row">
              ${quoteTypeHtml}
              ${dateHtml}
            </div>
          </div>
          ${contextHtml}
          <div class="quote-sources-row">
            ${primarySourceHtml}
            ${articleTitleHtml}
          </div>
          ${shareHtml}
        </div>
      </div>
    </div>
  `;
}

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

    const avatarInner = a.photoUrl
      ? `<img src="${escapeHtml(a.photoUrl)}" alt="${escapeHtml(a.name)}" class="author-avatar-img" onerror="this.outerHTML='<div class=\\'author-avatar\\'>${initial}</div>'">`
      : `<div class="author-avatar">${initial}</div>`;

    let html = `
      <p style="margin-bottom:1.5rem;font-family:var(--font-ui);font-size:0.85rem">
        <a href="/" onclick="navigate(event, '/')" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
      </p>

      <div class="author-header">
        <div class="author-avatar-wrap">${avatarInner}</div>
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

    // Chart section
    html += `
      <div class="author-charts-section" id="author-charts">
        <div class="chart-row">
          <div class="chart-panel">
            <h3>Quote Activity (30 days)</h3>
            <div class="chart-container" style="height:220px"><canvas id="chart-author-timeline"></canvas></div>
          </div>
          <div class="chart-panel">
            <h3>Topic Distribution</h3>
            <div class="chart-container" style="height:220px"><canvas id="chart-author-topics"></canvas></div>
          </div>
        </div>
        <div class="chart-panel" id="chart-author-peers-panel" style="display:none">
          <h3>vs. Peers</h3>
          <div class="chart-container" style="height:220px"><canvas id="chart-author-peers"></canvas></div>
        </div>
      </div>
    `;

    html += '<h2 style="margin:2rem 0 1rem;font-family:var(--font-headline);font-size:1.3rem">Quotes</h2>';

    if (quotesData.quotes.length === 0) {
      html += '<p style="color:var(--text-muted);font-family:var(--font-ui)">No quotes found for this author.</p>';
    } else {
      for (const q of quotesData.quotes) {
        html += buildAuthorQuoteHtml(q, a.name, a.categoryContext);
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

    // Load charts after DOM is set
    loadAuthorCharts(id);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function loadAuthorCharts(authorId) {
  if (typeof initChartDefaults === 'function') initChartDefaults();
  try {
    const data = await API.get(`/analytics/trends/author/${authorId}?period=month`);

    // Timeline chart
    if (data.timeline && data.timeline.length > 0 && typeof createTimelineChart === 'function') {
      const labels = data.timeline.map(b => b.bucket.slice(5));
      const values = data.timeline.map(b => b.count);
      createTimelineChart('chart-author-timeline', labels, [{ label: 'Quotes', data: values }]);
    }

    // Topic doughnut
    if (data.topics && data.topics.length > 0 && typeof createDoughnutChart === 'function') {
      const topicLabels = data.topics.map(t => t.keyword);
      const topicValues = data.topics.map(t => t.count);
      createDoughnutChart('chart-author-topics', topicLabels, topicValues);
    }

    // Peer comparison
    if (data.peers && data.peers.length > 0 && typeof createTimelineChart === 'function') {
      const peersPanel = document.getElementById('chart-author-peers-panel');
      if (peersPanel) peersPanel.style.display = '';

      // Merge all buckets from author + peers
      const bucketSet = new Set();
      for (const b of data.timeline) bucketSet.add(b.bucket);
      for (const peer of data.peers) {
        for (const b of peer.buckets) bucketSet.add(b.bucket);
      }
      const allBuckets = Array.from(bucketSet).sort();
      const peerLabels = allBuckets.map(b => b.slice(5));

      // Author dataset
      const authorMap = {};
      for (const b of data.timeline) authorMap[b.bucket] = b.count;
      const datasets = [{ label: data.author.name, data: allBuckets.map(b => authorMap[b] || 0) }];

      // Peer datasets
      for (const peer of data.peers) {
        const peerMap = {};
        for (const b of peer.buckets) peerMap[b.bucket] = b.count;
        datasets.push({ label: peer.name, data: allBuckets.map(b => peerMap[b] || 0) });
      }

      createTimelineChart('chart-author-peers', peerLabels, datasets);
    }
  } catch (err) {
    console.error('Failed to load author charts:', err);
  }
}

async function loadAuthorQuotesPage(authorId, page) {
  try {
    const quotesData = await API.get(`/authors/${authorId}/quotes?page=${page}&limit=50`);

    // Get author info from the header
    const nameEl = document.querySelector('.page-title');
    const authorName = nameEl ? nameEl.textContent : '';
    const descEl = document.querySelector('.author-disambiguation');
    const authorCategoryContext = descEl ? descEl.textContent : '';

    const quotesContainer = nameEl.closest('.author-header').parentElement;
    const existingQuotes = quotesContainer.querySelectorAll('.quote-entry, .pagination');
    existingQuotes.forEach(el => el.remove());

    let html = '';
    for (const q of quotesData.quotes) {
      html += buildAuthorQuoteHtml(q, authorName, authorCategoryContext);
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
