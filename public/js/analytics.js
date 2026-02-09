// Analytics Modal — Tabbed interface for quote insights

let _analyticsCurrentTab = 'overview';
let _analyticsCurrentPeriod = 'week';

function openAnalytics(e) {
  if (e) e.preventDefault();
  const modal = document.getElementById('analytics-modal');
  if (!modal) return;
  modal.style.display = '';
  document.body.style.overflow = 'hidden';
  _analyticsCurrentTab = 'overview';
  _analyticsCurrentPeriod = 'week';
  switchAnalyticsTab('overview');
}

function closeAnalytics() {
  const modal = document.getElementById('analytics-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

function switchAnalyticsTab(tab) {
  _analyticsCurrentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.analytics-tab').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
  });

  // Load content
  const body = document.getElementById('analytics-body');
  if (!body) return;
  body.innerHTML = '<div class="analytics-loading">Loading...</div>';

  if (tab === 'overview') loadOverview();
  else if (tab === 'quotes') loadTopQuotes(_analyticsCurrentPeriod);
  else if (tab === 'authors') loadTopAuthors(_analyticsCurrentPeriod);
  else if (tab === 'topics') loadTrendingTopics(_analyticsCurrentPeriod);
}

function renderPeriodSelector(activePeriod, onChangeFn) {
  const periods = ['day', 'week', 'month', 'year'];
  const labels = { day: 'Day', week: 'Week', month: 'Month', year: 'Year' };
  return `
    <div class="period-selector">
      ${periods.map(p => `
        <button class="period-btn${p === activePeriod ? ' active' : ''}"
                onclick="${onChangeFn}('${p}')">${labels[p]}</button>
      `).join('')}
    </div>
  `;
}

async function loadOverview() {
  const body = document.getElementById('analytics-body');
  try {
    const data = await API.get('/analytics/overview');

    let html = `
      <div class="stat-cards">
        <div class="stat-card">
          <div class="stat-value">${data.quotes_today}</div>
          <div class="stat-label">Quotes Today</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${data.quotes_this_week}</div>
          <div class="stat-label">This Week</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${data.quotes_total.toLocaleString()}</div>
          <div class="stat-label">Total Quotes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${data.articles_today}</div>
          <div class="stat-label">Articles Today</div>
        </div>
      </div>
    `;

    // Top author today
    if (data.top_author_today) {
      const a = data.top_author_today;
      const initial = (a.name || '?').charAt(0).toUpperCase();
      const avatarHtml = a.photo_url
        ? `<img src="${escapeHtml(a.photo_url)}" alt="${escapeHtml(a.name)}" class="analytics-avatar" onerror="this.outerHTML='<div class=\\'analytics-avatar-placeholder\\'>${initial}</div>'">`
        : `<div class="analytics-avatar-placeholder">${initial}</div>`;
      html += `
        <div class="analytics-section">
          <h3 class="analytics-section-title">Top Author Today</h3>
          <div class="analytics-highlight-row">
            ${avatarHtml}
            <div>
              <strong>${escapeHtml(a.name)}</strong>
              <span class="analytics-meta">${a.quote_count} quote${a.quote_count !== 1 ? 's' : ''}</span>
            </div>
          </div>
        </div>
      `;
    }

    // Most upvoted today
    if (data.most_upvoted_today && data.most_upvoted_today.vote_score > 0) {
      const q = data.most_upvoted_today;
      const truncText = q.text.length > 150 ? q.text.substring(0, 150) + '...' : q.text;
      html += `
        <div class="analytics-section">
          <h3 class="analytics-section-title">Most Upvoted Today</h3>
          <div class="analytics-quote-highlight">
            <p class="analytics-quote-text">"${escapeHtml(truncText)}"</p>
            <div class="analytics-quote-meta">
              <span>${escapeHtml(q.person_name)}</span>
              <span class="analytics-vote-badge">+${q.vote_score}</span>
            </div>
          </div>
        </div>
      `;
    }

    // Quotes per day sparkline (last 14 days)
    if (data.quotes_per_day && data.quotes_per_day.length > 0) {
      const recent = data.quotes_per_day.slice(-14);
      const maxCount = Math.max(...recent.map(d => d.count), 1);
      const bars = recent.map(d => {
        const pct = Math.round((d.count / maxCount) * 100);
        const dateLabel = d.date.slice(5); // MM-DD
        return `<div class="sparkline-bar" style="height:${pct}%" title="${dateLabel}: ${d.count} quotes"></div>`;
      }).join('');

      html += `
        <div class="analytics-section">
          <h3 class="analytics-section-title">Quotes Per Day (Last 14 Days)</h3>
          <div class="sparkline">${bars}</div>
        </div>
      `;
    }

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div class="analytics-error">Failed to load overview: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadTopQuotes(period) {
  _analyticsCurrentPeriod = period;
  const body = document.getElementById('analytics-body');
  try {
    const data = await API.get(`/analytics/quotes?period=${period}`);

    let html = renderPeriodSelector(period, 'loadTopQuotes');

    if (data.quotes.length === 0) {
      html += '<div class="analytics-empty">No quotes found for this period.</div>';
    } else {
      html += '<div class="analytics-quote-list">';
      for (const q of data.quotes) {
        const truncText = q.text.length > 200 ? q.text.substring(0, 200) + '...' : q.text;
        const initial = (q.person_name || '?').charAt(0).toUpperCase();
        const avatarHtml = q.photo_url
          ? `<img src="${escapeHtml(q.photo_url)}" alt="" class="analytics-avatar-sm" onerror="this.outerHTML='<div class=\\'analytics-avatar-placeholder-sm\\'>${initial}</div>'">`
          : `<div class="analytics-avatar-placeholder-sm">${initial}</div>`;

        html += `
          <div class="analytics-quote-item">
            <div class="analytics-quote-score">
              <span class="analytics-vote-badge">${q.vote_score >= 0 ? '+' : ''}${q.vote_score}</span>
            </div>
            <div class="analytics-quote-body">
              <p class="analytics-quote-text">"${escapeHtml(truncText)}"</p>
              <div class="analytics-quote-meta">
                ${avatarHtml}
                <span>${escapeHtml(q.person_name)}</span>
                <span class="analytics-meta">${q.upvotes} up / ${q.downvotes} down</span>
              </div>
            </div>
          </div>
        `;
      }
      html += '</div>';
    }

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div class="analytics-error">Failed to load quotes: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadTopAuthors(period) {
  _analyticsCurrentPeriod = period;
  const body = document.getElementById('analytics-body');
  try {
    const data = await API.get(`/analytics/authors?period=${period}`);

    let html = renderPeriodSelector(period, 'loadTopAuthors');

    if (data.authors.length === 0) {
      html += '<div class="analytics-empty">No authors found for this period.</div>';
    } else {
      html += `
        <table class="analytics-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Author</th>
              <th>Category</th>
              <th>Quotes</th>
              <th>Votes</th>
            </tr>
          </thead>
          <tbody>
      `;
      data.authors.forEach((a, i) => {
        const initial = (a.name || '?').charAt(0).toUpperCase();
        const avatarHtml = a.photo_url
          ? `<img src="${escapeHtml(a.photo_url)}" alt="" class="analytics-avatar-sm" onerror="this.outerHTML='<div class=\\'analytics-avatar-placeholder-sm\\'>${initial}</div>'">`
          : `<div class="analytics-avatar-placeholder-sm">${initial}</div>`;

        html += `
          <tr>
            <td class="analytics-rank">${i + 1}</td>
            <td class="analytics-author-cell">
              ${avatarHtml}
              <span>${escapeHtml(a.name)}</span>
            </td>
            <td>${escapeHtml(a.category || 'Other')}</td>
            <td>${a.quote_count}</td>
            <td>${a.total_vote_score >= 0 ? '+' : ''}${a.total_vote_score}</td>
          </tr>
        `;
      });
      html += '</tbody></table>';
    }

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div class="analytics-error">Failed to load authors: ${escapeHtml(err.message)}</div>`;
  }
}

async function loadTrendingTopics(period) {
  _analyticsCurrentPeriod = period;
  const body = document.getElementById('analytics-body');
  try {
    const data = await API.get(`/analytics/topics?period=${period}`);

    let html = renderPeriodSelector(period, 'loadTrendingTopics');

    if (data.topics.length === 0) {
      html += '<div class="analytics-empty">No trending topics for this period.</div>';
    } else {
      html += '<div class="analytics-topic-list">';
      for (const t of data.topics) {
        const trendIcon = t.trend === 'up' ? '&#x25B2;' : t.trend === 'down' ? '&#x25BC;' : '&#x25CF;';
        const trendClass = `trend-${t.trend}`;
        html += `
          <div class="analytics-topic-item">
            <span class="analytics-topic-keyword">${escapeHtml(t.keyword)}</span>
            <span class="analytics-topic-count">${t.count}</span>
            <span class="analytics-topic-trend ${trendClass}">${trendIcon}</span>
          </div>
        `;
      }
      html += '</div>';
    }

    body.innerHTML = html;
  } catch (err) {
    body.innerHTML = `<div class="analytics-error">Failed to load topics: ${escapeHtml(err.message)}</div>`;
  }
}
