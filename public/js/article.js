async function renderArticle(id) {
  const content = document.getElementById('content');
  content.innerHTML = typeof buildSkeletonHtml === 'function' ? buildSkeletonHtml(3) : '<div class="loading">Loading article...</div>';

  try {
    const data = await API.get(`/articles/${id}`);
    if (!data.article) {
      content.innerHTML = '<div class="empty-state"><h3>Article not found</h3><p><a href="/" onclick="navigate(event, \'/\')" style="color:var(--accent)">Back to home</a></p></div>';
      return;
    }

    const a = data.article;
    const dateStr = formatDateTime(a.publishedAt);
    const sourceLabel = a.sourceName || a.sourceDomain || '';

    const shareHtml = typeof buildShareButtonsHtml === 'function'
      ? buildShareButtonsHtml('article', a.id, a.title, sourceLabel)
      : '';
    const importantHtml = typeof renderImportantButton === 'function'
      ? renderImportantButton('article', a.id, a.importantsCount || a.importants_count || 0, false)
      : '';

    let html = `
      <div class="article-sticky-header">
        <p style="margin-bottom:0.5rem;font-family:var(--font-ui);font-size:var(--text-sm)">
          <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
        </p>
        <h1 class="page-title" style="font-size:1.8rem;margin-bottom:0.5rem">${escapeHtml(a.title || 'Untitled Source')}</h1>
        <div style="font-family:var(--font-ui);font-size:var(--text-sm);color:var(--text-muted);margin-bottom:0.5rem">
          ${sourceLabel ? `<span>${escapeHtml(sourceLabel)}</span>` : ''}
          ${dateStr ? `<span style="margin-left:0.5rem">&middot; ${dateStr}</span>` : ''}
          <span style="margin-left:0.5rem">&middot; ${data.quotes.length} quote${data.quotes.length !== 1 ? 's' : ''}</span>
        </div>
        <div style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap">
          ${shareHtml}
          ${importantHtml}
          ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none;font-size:var(--text-sm);font-family:var(--font-ui)">View original &rarr;</a>` : ''}
          ${isAdmin ? `<label class="top-story-label" title="Mark as Top Story">
            <input type="checkbox" ${a.isTopStory ? 'checked' : ''} onchange="toggleArticleTopStory(${a.id}, this.checked)">
            <span class="top-story-label-text">Top Story</span>
          </label>` : ''}
        </div>
      </div>
    `;

    if (data.quotes.length === 0) {
      html += '<div class="empty-state"><h3>No quotes from this source</h3></div>';
    } else {
      // Group consecutive quotes by speaker
      const groups = [];
      let currentGroup = null;
      for (const q of data.quotes) {
        const pid = q.personId || q.person_id;
        if (currentGroup && currentGroup.personId === pid) {
          currentGroup.quotes.push(q);
        } else {
          currentGroup = { personId: pid, name: q.personName, photo: q.photoUrl, role: q.personDisambiguation, quotes: [q] };
          groups.push(currentGroup);
        }
      }

      // Two-column grid for quotes at 768px+
      html += '<div class="article-quotes-grid">';
      for (const group of groups) {
        const initial = (group.name || '?').charAt(0).toUpperCase();
        const avatarHtml = group.photo
          ? `<img src="${escapeHtml(group.photo)}" alt="${escapeHtml(group.name)}" class="speaker-group__avatar" onerror="this.outerHTML='<div class=\\'speaker-group__avatar-placeholder\\'>${initial}</div>'" loading="lazy">`
          : `<div class="speaker-group__avatar-placeholder">${initial}</div>`;

        // Speaker header spans full width in grid
        html += `<div class="speaker-group">
          <div class="speaker-group__header" onclick="navigateTo('/author/${group.personId}')">
            ${avatarHtml}
            <div>
              <span class="speaker-group__name">${escapeHtml(group.name)}</span>
              ${group.role ? `<span class="speaker-group__role">${escapeHtml(group.role)}</span>` : ''}
            </div>
          </div>`;

        for (let i = 0; i < group.quotes.length; i++) {
          const q = group.quotes[i];
          if (i > 0) html += '<hr class="speaker-group__divider">';
          html += typeof buildQuoteBlockHtml === 'function'
            ? buildQuoteBlockHtml({
                ...q,
                articleId: null,
                articleTitle: null,
                articlePublishedAt: a.publishedAt,
                articleUrl: null,
                primarySourceDomain: null,
                primarySourceName: null,
                person_name: q.personName,
                person_id: q.personId,
                importants_count: q.importantsCount || q.importants_count || 0,
              }, [], false, { showAvatar: false })
            : `<div class="quote-block"><p class="quote-block__text">${escapeHtml(q.text)}</p></div>`;
        }
        html += '</div>';
      }
      html += '</div>';

      // Chart section at bottom (only if 2+ quotes)
      if (data.quotes.length >= 2) {
        html += `
          <div class="article-charts-section" id="article-charts">
            <div class="chart-row">
              <div class="chart-panel">
                <h3>Quotes by Author</h3>
                <div class="chart-container" style="height:200px"><canvas id="chart-article-authors"></canvas></div>
              </div>
              <div class="chart-panel">
                <h3>Topic Distribution</h3>
                <div class="chart-container" style="height:200px"><canvas id="chart-article-topics"></canvas></div>
              </div>
            </div>
          </div>
        `;
      }
    }

    content.innerHTML = html;

    // Load charts after DOM is set (only if 2+ quotes)
    if (data.quotes.length >= 2) {
      loadArticleCharts(id);
    }
  } catch (err) {
    content.innerHTML = `<div class="empty-state"><h3>Error</h3><p>${escapeHtml(err.message)}</p></div>`;
  }
}

async function toggleArticleTopStory(articleId, isTopStory) {
  try {
    await API.patch(`/articles/${articleId}`, { is_top_story: isTopStory ? 1 : 0 });
    showToast(isTopStory ? 'Article marked as top story' : 'Article removed from top stories', 'success');
  } catch (err) {
    showToast('Error: ' + err.message, 'error', 5000);
  }
}

async function loadArticleCharts(articleId) {
  if (typeof initChartDefaults === 'function') initChartDefaults();
  try {
    const data = await API.get(`/analytics/trends/article/${articleId}`);

    // Horizontal bar chart: quotes per author (only if 2+ authors)
    if (data.authors && data.authors.length >= 2 && typeof createBarChart === 'function') {
      const authorLabels = data.authors.map(a => a.name);
      const authorValues = data.authors.map(a => a.quote_count);
      createBarChart('chart-article-authors', authorLabels, authorValues);
    }

    // Doughnut: topic distribution (only if 2+ topics)
    if (data.topics && data.topics.length >= 2 && typeof createDoughnutChart === 'function') {
      const topicLabels = data.topics.map(t => t.keyword);
      const topicValues = data.topics.map(t => t.count);
      createDoughnutChart('chart-article-topics', topicLabels, topicValues);
    }
  } catch (err) {
    console.error('Failed to load article charts:', err);
  }
}
