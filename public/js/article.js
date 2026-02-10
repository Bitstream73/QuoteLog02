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

    let html = `
      <div class="article-sticky-header">
        <p style="margin-bottom:0.5rem;font-family:var(--font-ui);font-size:0.85rem">
          <a href="/" onclick="navigateBackToQuotes(event)" style="color:var(--accent);text-decoration:none">&larr; Back to quotes</a>
        </p>
        <h1 class="page-title" style="font-size:1.8rem;margin-bottom:0.5rem">${escapeHtml(a.title || 'Untitled Article')}</h1>
        <div style="font-family:var(--font-ui);font-size:0.85rem;color:var(--text-secondary);display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center">
          ${sourceLabel ? `<span class="quote-primary-source">${escapeHtml(sourceLabel)}</span>` : ''}
          ${dateStr ? `<span>${dateStr}</span>` : ''}
          ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" style="color:var(--accent);text-decoration:none">View original article &rarr;</a>` : ''}
          ${isAdmin ? `<label class="top-story-label" title="Mark as Top Story">
            <input type="checkbox" ${a.isTopStory ? 'checked' : ''} onchange="toggleArticleTopStory(${a.id}, this.checked)">
            <span class="top-story-label-text">Top Story</span>
          </label>` : ''}
        </div>
      </div>
    `;

    if (data.quotes.length === 0) {
      html += '<div class="empty-state"><h3>No quotes from this article</h3></div>';
    } else {
      html += `<p class="quote-count">${data.quotes.length} quote${data.quotes.length !== 1 ? 's' : ''} from this article</p>`;

      // Chart section (only if 2+ quotes)
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

      for (const q of data.quotes) {
        // Re-use buildQuoteEntryHtml — strip article title/source (already in header) but keep date
        html += buildQuoteEntryHtml({
          ...q,
          articleId: null,
          articleTitle: null,
          articlePublishedAt: a.publishedAt,
          articleUrl: null,
          primarySourceDomain: null,
          primarySourceName: null,
        }, false);
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
