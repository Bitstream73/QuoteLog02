// Analytics page - Trending Topics & Keywords

let _analyticsDays = 30;

async function renderAnalytics() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="analytics-page">
      <div class="analytics-header">
        <h1>Analytics</h1>
        <div class="analytics-period">
          <select id="analytics-period" onchange="changeAnalyticsPeriod(this.value)">
            <option value="7">Last 7 days</option>
            <option value="30" selected>Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
          </select>
        </div>
      </div>
      <div class="analytics-loading">Loading analytics...</div>
    </div>
  `;

  await loadAnalytics();
}

async function changeAnalyticsPeriod(days) {
  _analyticsDays = parseInt(days);
  await loadAnalytics();
}

async function loadAnalytics() {
  try {
    const data = await API.get(`/analytics/overview?days=${_analyticsDays}`);
    renderAnalyticsData(data);
  } catch (err) {
    const content = document.querySelector('.analytics-page');
    if (content) {
      const loading = content.querySelector('.analytics-loading');
      if (loading) {
        loading.innerHTML = `<p class="error-text">Failed to load analytics: ${err.message}</p>`;
      }
    }
  }
}

function renderAnalyticsData(data) {
  const page = document.querySelector('.analytics-page');
  if (!page) return;

  // Remove loading
  const loading = page.querySelector('.analytics-loading');
  if (loading) loading.remove();

  // Remove existing content sections (keep header)
  page.querySelectorAll('.analytics-section').forEach(el => el.remove());
  page.querySelectorAll('.analytics-stats').forEach(el => el.remove());

  // Stats summary
  const statsHtml = `
    <div class="analytics-stats">
      <div class="stat-card">
        <div class="stat-number">${data.total_quotes.toLocaleString()}</div>
        <div class="stat-label">Quotes</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.total_authors.toLocaleString()}</div>
        <div class="stat-label">Authors</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.topics.length}</div>
        <div class="stat-label">Topics</div>
      </div>
      <div class="stat-card">
        <div class="stat-number">${data.keywords.length}</div>
        <div class="stat-label">Keywords</div>
      </div>
    </div>
  `;

  // Topics section
  const topicsHtml = `
    <div class="analytics-section">
      <h2>Trending Topics</h2>
      <p class="analytics-subtitle">Broad subject categories across all quotes</p>
      <div class="topics-cloud">
        ${data.topics.length > 0 ? data.topics.map(t => `
          <a href="#" class="topic-tag" onclick="navigateToTopic(event, '${escapeAttr(t.slug)}')" title="${t.quote_count} quotes">
            <span class="topic-name">${escapeHtml(t.name)}</span>
            <span class="topic-count">${t.quote_count}</span>
          </a>
        `).join('') : '<p class="analytics-empty">No topics yet. Topics are extracted as new quotes are processed.</p>'}
      </div>
    </div>
  `;

  // Keywords section - grouped by type
  const keywordsByType = {};
  for (const kw of data.keywords) {
    const type = kw.keyword_type || 'concept';
    if (!keywordsByType[type]) keywordsByType[type] = [];
    keywordsByType[type].push(kw);
  }

  const typeLabels = {
    person: 'People',
    organization: 'Organizations',
    event: 'Events',
    legislation: 'Legislation',
    location: 'Locations',
    concept: 'Concepts',
  };

  const typeOrder = ['person', 'event', 'organization', 'location', 'legislation', 'concept'];

  let keywordsInnerHtml = '';
  if (data.keywords.length > 0) {
    // Show all keywords in a single cloud, but with type indicators
    keywordsInnerHtml = `
      <div class="keywords-cloud">
        ${data.keywords.map(kw => `
          <a href="#" class="keyword-tag keyword-type-${kw.keyword_type}" onclick="navigateToKeyword(event, ${kw.id})" title="${kw.quote_count} quotes - ${typeLabels[kw.keyword_type] || kw.keyword_type}">
            <span class="keyword-name">${escapeHtml(kw.name)}</span>
            <span class="keyword-count">${kw.quote_count}</span>
          </a>
        `).join('')}
      </div>
    `;

    // Also show grouped view
    const groupedSections = typeOrder
      .filter(type => keywordsByType[type]?.length > 0)
      .map(type => `
        <div class="keyword-group">
          <h4>${typeLabels[type]}</h4>
          <div class="keywords-cloud">
            ${keywordsByType[type].map(kw => `
              <a href="#" class="keyword-tag keyword-type-${kw.keyword_type}" onclick="navigateToKeyword(event, ${kw.id})" title="${kw.quote_count} quotes">
                <span class="keyword-name">${escapeHtml(kw.name)}</span>
                <span class="keyword-count">${kw.quote_count}</span>
              </a>
            `).join('')}
          </div>
        </div>
      `).join('');

    keywordsInnerHtml += `<div class="keyword-groups">${groupedSections}</div>`;
  } else {
    keywordsInnerHtml = '<p class="analytics-empty">No keywords yet. Keywords are extracted as new quotes are processed.</p>';
  }

  const keywordsHtml = `
    <div class="analytics-section">
      <h2>Trending Keywords</h2>
      <p class="analytics-subtitle">Specific people, events, organizations, and concepts</p>
      ${keywordsInnerHtml}
    </div>
  `;

  // Top Authors section
  const authorsHtml = `
    <div class="analytics-section">
      <h2>Top Authors</h2>
      <div class="analytics-authors-list">
        ${data.authors.map((a, i) => `
          <a href="#" class="analytics-author-row" onclick="navigate(event, '/author/${a.id}')">
            <span class="author-rank">${i + 1}</span>
            <img src="${a.photo_url || '/img/default-avatar.svg'}" alt="" class="author-thumb" onerror="this.src='/img/default-avatar.svg'">
            <div class="author-info">
              <span class="author-name">${escapeHtml(a.canonical_name)}</span>
              <span class="author-category">${escapeHtml(a.category || 'Other')}</span>
            </div>
            <span class="author-quote-count">${a.quote_count}</span>
          </a>
        `).join('')}
      </div>
    </div>
  `;

  page.insertAdjacentHTML('beforeend', statsHtml + topicsHtml + keywordsHtml + authorsHtml);
}

function navigateToTopic(event, slug) {
  event.preventDefault();
  navigate(null, `/analytics/topic/${slug}`);
}

function navigateToKeyword(event, id) {
  event.preventDefault();
  navigate(null, `/analytics/keyword/${id}`);
}

async function renderTopicDetail(slug) {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="analytics-page"><div class="analytics-loading">Loading topic...</div></div>`;

  try {
    const data = await API.get(`/analytics/topic/${encodeURIComponent(slug)}`);
    content.innerHTML = `
      <div class="analytics-page">
        <div class="analytics-header">
          <h1><a href="#" onclick="navigate(event, '/analytics')" class="back-link">Analytics</a> / ${escapeHtml(data.topic.name)}</h1>
          <span class="analytics-subtitle">${data.total} quotes in this topic</span>
        </div>
        <div class="topic-quotes-list">
          ${data.quotes.map(q => renderQuoteCard(q)).join('')}
        </div>
        ${data.total > data.quotes.length ? `
          <div class="load-more-container">
            <button class="btn" onclick="loadMoreTopicQuotes('${escapeAttr(slug)}', 2)">Load more</button>
          </div>
        ` : ''}
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="analytics-page"><p class="error-text">Failed to load topic: ${err.message}</p></div>`;
  }
}

async function renderKeywordDetail(id) {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="analytics-page"><div class="analytics-loading">Loading keyword...</div></div>`;

  try {
    const data = await API.get(`/analytics/keyword/${id}`);
    const typeLabels = { person: 'Person', organization: 'Organization', event: 'Event', legislation: 'Legislation', location: 'Location', concept: 'Concept' };
    content.innerHTML = `
      <div class="analytics-page">
        <div class="analytics-header">
          <h1><a href="#" onclick="navigate(event, '/analytics')" class="back-link">Analytics</a> / ${escapeHtml(data.keyword.name)}</h1>
          <span class="analytics-subtitle">${typeLabels[data.keyword.keyword_type] || 'Keyword'} &middot; ${data.total} quotes</span>
        </div>
        <div class="topic-quotes-list">
          ${data.quotes.map(q => renderQuoteCard(q)).join('')}
        </div>
        ${data.total > data.quotes.length ? `
          <div class="load-more-container">
            <button class="btn" onclick="loadMoreKeywordQuotes(${id}, 2)">Load more</button>
          </div>
        ` : ''}
      </div>
    `;
  } catch (err) {
    content.innerHTML = `<div class="analytics-page"><p class="error-text">Failed to load keyword: ${err.message}</p></div>`;
  }
}

function renderQuoteCard(q) {
  const truncated = q.text.length > 200 ? q.text.substring(0, 200) + '...' : q.text;
  return `
    <div class="analytics-quote-card" onclick="navigate(null, '/quote/${q.id}')">
      <div class="quote-card-header">
        <img src="${q.photo_url || '/img/default-avatar.svg'}" alt="" class="author-thumb" onerror="this.src='/img/default-avatar.svg'">
        <div>
          <a href="#" onclick="event.stopPropagation(); navigate(event, '/author/${q.person_id}')" class="quote-card-author">${escapeHtml(q.canonical_name)}</a>
          <span class="quote-card-date">${formatDateShort(q.created_at)}</span>
        </div>
      </div>
      <blockquote class="quote-card-text">&ldquo;${escapeHtml(truncated)}&rdquo;</blockquote>
      ${q.context ? `<p class="quote-card-context">${escapeHtml(q.context)}</p>` : ''}
    </div>
  `;
}

function formatDateShort(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return str.replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
