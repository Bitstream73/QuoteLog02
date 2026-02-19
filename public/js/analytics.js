// Analytics page

let _analyticsDays = 30;

async function renderAnalytics() {
  // Update page metadata
  if (typeof updatePageMeta === 'function') {
    updatePageMeta('Analytics', 'Explore trends in public statements, top quoted figures, and source analytics.', '/analytics');
  }
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
    const [data, trendingData] = await Promise.all([
      API.get(`/analytics/overview?days=${_analyticsDays}`),
      API.get('/analytics/trending-quotes'),
    ]);
    renderAnalyticsData(data, trendingData);
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

async function renderAnalyticsData(data, trendingData) {
  const page = document.querySelector('.analytics-page');
  if (!page) return;

  // Remove loading
  const loading = page.querySelector('.analytics-loading');
  if (loading) loading.remove();

  // Remove existing content sections (keep header)
  page.querySelectorAll('.analytics-section').forEach(el => el.remove());
  page.querySelectorAll('.analytics-stats').forEach(el => el.remove());
  page.querySelectorAll('.analytics-qotd-section').forEach(el => el.remove());

  // Build QotD/W/M section
  let qotdHtml = '';
  if (trendingData) {
    // Fetch importance statuses for featured quotes
    const featuredKeys = [];
    if (trendingData.quote_of_day) featuredKeys.push(`quote:${trendingData.quote_of_day.id}`);
    if (trendingData.quote_of_week) featuredKeys.push(`quote:${trendingData.quote_of_week.id}`);
    if (trendingData.quote_of_month) featuredKeys.push(`quote:${trendingData.quote_of_month.id}`);
    if (featuredKeys.length > 0 && typeof fetchImportantStatuses === 'function') {
      await fetchImportantStatuses(featuredKeys);
    }
    const impStatuses = typeof _importantStatuses !== 'undefined' ? _importantStatuses : {};

    if (trendingData.quote_of_day || trendingData.quote_of_week || trendingData.quote_of_month) {
      qotdHtml += '<div class="analytics-qotd-section">';

      if (trendingData.quote_of_day && typeof buildQuoteBlockHtml === 'function') {
        qotdHtml += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">QUOTE OF THE DAY</h2><hr class="topic-section-rule"></div>`;
        qotdHtml += buildQuoteBlockHtml(trendingData.quote_of_day, impStatuses[`quote:${trendingData.quote_of_day.id}`] || false, { variant: 'hero' });
      }

      if (trendingData.quote_of_week && typeof buildQuoteBlockHtml === 'function') {
        qotdHtml += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">QUOTE OF THE WEEK</h2><hr class="topic-section-rule"></div>`;
        qotdHtml += buildQuoteBlockHtml(trendingData.quote_of_week, impStatuses[`quote:${trendingData.quote_of_week.id}`] || false, { variant: 'featured' });
      }

      if (trendingData.quote_of_month && typeof buildQuoteBlockHtml === 'function') {
        qotdHtml += `<div class="trending-section-header"><hr class="topic-section-rule"><h2 class="trending-section-heading">QUOTE OF THE MONTH</h2><hr class="topic-section-rule"></div>`;
        qotdHtml += buildQuoteBlockHtml(trendingData.quote_of_month, impStatuses[`quote:${trendingData.quote_of_month.id}`] || false, { variant: 'featured' });
      }

      qotdHtml += `<p class="trending-disclaimer"><em>*Trending quotes change over time as views and shares change</em></p>`;
      qotdHtml += '</div>';
    }
  }

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

  page.insertAdjacentHTML('beforeend', qotdHtml + statsHtml + authorsHtml);
}

function renderQuoteCard(q) {
  const truncated = q.text.length > 200 ? q.text.substring(0, 200) + '...' : q.text;

  // Populate _quoteMeta so runInlineFactCheck has data
  if (typeof _quoteMeta !== 'undefined') {
    _quoteMeta[q.id] = {
      text: q.text,
      personName: q.canonical_name || q.person_name || '',
      personCategoryContext: q.category_context || q.person_category_context || '',
      context: q.context || '',
    };
  }

  const verdict = q.fact_check_verdict || q.factCheckVerdict || null;
  const badgeHtml = typeof buildVerdictBadgeHtml === 'function' ? buildVerdictBadgeHtml(q.id, verdict) : '';

  return `
    <div class="analytics-quote-card" onclick="navigate(null, '/quote/${q.id}')">
      ${badgeHtml}
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
