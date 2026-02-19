// Author Detail Page

let _authorQuoteSortBy = 'date';

// Build quote HTML for author page — reuses homepage buildQuoteBlockHtml
function buildAuthorQuoteHtml(q, authorName, authorCategoryContext, authorId, authorPhotoUrl, options = {}) {
  // Map author-endpoint fields to the format buildQuoteBlockHtml expects
  const mapped = {
    id: q.id,
    text: q.text,
    context: q.context,
    person_name: authorName,
    person_id: authorId,
    photo_url: authorPhotoUrl || '',
    person_category_context: authorCategoryContext || '',
    article_id: q.articleId || '',
    article_title: q.articleTitle || '',
    article_url: q.articleUrl || '',
    source_domain: q.primarySourceDomain || '',
    source_name: q.primarySourceName || '',
    quote_datetime: q.quoteDateTime || q.articlePublishedAt || q.createdAt || '',
    importants_count: q.importantsCount || q.importants_count || q.voteScore || 0,
    share_count: q.shareCount || q.share_count || 0,
    view_count: q.viewCount || q.view_count || 0,
    is_visible: q.isVisible,
  };
  const isImp = typeof _importantStatuses !== 'undefined' ? (_importantStatuses[`quote:${q.id}`] || false) : false;
  return buildQuoteBlockHtml(mapped, isImp, options);
}

async function renderAuthor(id) {
  const content = document.getElementById('content');
  content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(3) : '<div class="loading">Loading author...</div>';

  const sortParam = _authorQuoteSortBy === 'importance' ? '&sort=importance' : '';

  try {
    const [authorData, quotesData] = await Promise.all([
      API.get(`/authors/${id}`),
      API.get(`/authors/${id}/quotes?limit=50${sortParam}`),
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

    // Update page metadata
    if (typeof updatePageMeta === 'function') {
      updatePageMeta(`${a.name} - Quotes`, a.disambiguation || a.categoryContext || `${a.quoteCount} quotes tracked`, `/author/${a.id}`);
    }

    const avatarPlaceholder = `<div class="author-avatar">${initial}</div>`;
    const avatarInner = a.photoUrl
      ? `<img src="${escapeHtml(a.photoUrl)}" alt="${escapeHtml(a.name)}" class="author-avatar-img" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src}else{this.outerHTML='<div class=\\'author-avatar\\'>${initial}</div>'}">`
      : (typeof isAdmin !== 'undefined' && isAdmin
        ? `<a href="https://www.google.com/search?tbm=isch&q=${encodeURIComponent((a.name || '') + ' ' + (a.disambiguation || ''))}" target="_blank" rel="noopener" class="admin-headshot-search" title="Search Google Images">${avatarPlaceholder}</a>`
        : avatarPlaceholder);

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
          ${typeof isAdmin !== 'undefined' && isAdmin && typeof buildAdminActionsHtml === 'function' ? `
            <div class="admin-inline-actions" style="margin-top:0.5rem">
              <button onclick="adminEditAuthorName(${a.id}, '${escapeHtml(a.name)}', '${escapeHtml(a.disambiguation || '')}')" title="Edit name">Edit Name</button>
              <button onclick="adminEditCategory(${a.id}, '${escapeHtml(a.name)}')" title="Edit category">Category</button>
              <button onclick="adminChangeHeadshot(${a.id}, '${escapeHtml(a.name)}')" title="Change photo">Photo</button>
            </div>
          ` : ''}
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

    // Quotes heading with sort controls
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin:2rem 0 1rem">
      <h2 style="margin:0;font-family:var(--font-headline);font-size:1.3rem">Quotes</h2>
      <div class="tab-sort-controls">
        Sort: <a class="sort-toggle-text ${_authorQuoteSortBy === 'date' ? 'active' : ''}" onclick="switchAuthorQuoteSort('date')">Date</a>
        <span class="sort-toggle-divider">|</span>
        <a class="sort-toggle-text ${_authorQuoteSortBy === 'importance' ? 'active' : ''}" onclick="switchAuthorQuoteSort('importance')">Importance</a>
      </div>
    </div>`;

    if (quotesData.quotes.length === 0) {
      html += '<p style="color:var(--text-muted);font-family:var(--font-ui)">No quotes found for this author.</p>';
    } else {
      // Fetch important statuses for all quotes (+ featured)
      const statusKeys = quotesData.quotes.map(q => `quote:${q.id}`);
      if (quotesData.featuredQuote) statusKeys.push(`quote:${quotesData.featuredQuote.id}`);
      if (typeof fetchImportantStatuses === 'function') {
        await fetchImportantStatuses(statusKeys);
      }

      // Featured quote
      if (quotesData.featuredQuote) {
        html += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">MOST NOTABLE</h2><hr class="topic-section-rule"></div>`;
        html += buildAuthorQuoteHtml(quotesData.featuredQuote, a.name, a.categoryContext, a.id, a.photoUrl, { variant: 'featured' });
      }

      // Quote list
      html += '<div id="author-quotes-list">';
      for (const q of quotesData.quotes) {
        html += buildAuthorQuoteHtml(q, a.name, a.categoryContext, a.id, a.photoUrl);
      }
      html += '</div>';

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

    // Chart section at bottom
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

    content.innerHTML = html;

    // Load charts after DOM is set
    loadAuthorCharts(id);
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

function switchAuthorQuoteSort(sortBy) {
  _authorQuoteSortBy = sortBy;
  // Get author ID from current URL
  const match = window.location.pathname.match(/\/author\/(.+)/);
  if (match) renderAuthor(match[1]);
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
  const sortParam = _authorQuoteSortBy === 'importance' ? '&sort=importance' : '';
  try {
    const quotesData = await API.get(`/authors/${authorId}/quotes?page=${page}&limit=50${sortParam}`);

    // Get author info from the header
    const nameEl = document.querySelector('.page-title');
    const authorName = nameEl ? nameEl.textContent : '';
    const descEl = document.querySelector('.author-disambiguation');
    const authorCategoryContext = descEl ? descEl.textContent : '';

    const quotesContainer = nameEl.closest('.author-header').parentElement;
    const existingQuotes = quotesContainer.querySelectorAll('.quote-entry, .pagination');
    existingQuotes.forEach(el => el.remove());

    // Fetch important statuses
    if (typeof fetchImportantStatuses === 'function') {
      await fetchImportantStatuses(quotesData.quotes.map(q => `quote:${q.id}`));
    }

    // Get author id and photo from the page
    const avatarImg = document.querySelector('.author-avatar-img');
    const authorPhotoUrl = avatarImg ? avatarImg.src : '';
    const authorIdMatch = window.location.pathname.match(/\/author\/(\d+)/);
    const authorId = authorIdMatch ? authorIdMatch[1] : '';

    let html = '';
    for (const q of quotesData.quotes) {
      html += buildAuthorQuoteHtml(q, authorName, authorCategoryContext, authorId, authorPhotoUrl);
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
