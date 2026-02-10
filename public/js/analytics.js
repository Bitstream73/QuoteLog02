// Analytics Dashboard — Full page with interactive charts and comparison tools

var _dashPeriod = 'month';
var _authorCompareIds = [];
var _topicCompareKeywords = [];
var _authorChartType = 'line';
var _topicChartType = 'line';
var _customPieMetric = 'category';
var _debounceTimers = {};

// --- Legacy modal compat (nav link now navigates to /analytics) ---
function openAnalytics(e) {
  if (e) e.preventDefault();
  navigate(null, '/analytics');
}
function closeAnalytics() {
  if (typeof destroyAllCharts === 'function') destroyAllCharts();
}

// --- Period selector (reused by sub-sections) ---
function renderDashPeriodSelector(activePeriod, onChangeFn) {
  var periods = ['day', 'week', 'month', 'year'];
  var labels = { day: '24h', week: '7 days', month: '30 days', year: '365 days' };
  return '<div class="dash-period-selector">' +
    periods.map(function(p) {
      return '<button class="dash-period-btn' + (p === activePeriod ? ' active' : '') +
             '" onclick="' + onChangeFn + '(\'' + p + '\')">' + labels[p] + '</button>';
    }).join('') + '</div>';
}

// --- Main page render ---
function renderAnalyticsPage() {
  var content = document.getElementById('content');
  if (!content) return;

  content.innerHTML = '\
<div class="dash">\
  <div class="dash-header">\
    <div class="dash-header-left">\
      <h1 class="dash-title">Analytics Dashboard</h1>\
      <p class="dash-subtitle">Insights and trends across your quote collection</p>\
    </div>\
    <div id="dash-period-wrap">' + renderDashPeriodSelector(_dashPeriod, 'changeDashPeriod') + '</div>\
  </div>\
  <div class="dash-kpi-row" id="dash-kpis"></div>\
  <div class="dash-section" id="sect-timeline">\
    <div class="dash-section-header"><h2>Quote Activity</h2></div>\
    <div class="chart-container" style="height:300px"><canvas id="chart-dash-timeline"></canvas></div>\
  </div>\
  <div class="dash-grid-2">\
    <div class="dash-section">\
      <div class="dash-section-header"><h2>Categories</h2></div>\
      <div class="chart-container" style="height:320px"><canvas id="chart-dash-categories"></canvas></div>\
    </div>\
    <div class="dash-section">\
      <div class="dash-section-header"><h2>Top Sources</h2></div>\
      <div class="chart-container" style="height:320px"><canvas id="chart-dash-sources"></canvas></div>\
    </div>\
  </div>\
  <div class="dash-section" id="sect-author-compare">\
    <div class="dash-section-header">\
      <h2>Compare Authors</h2>\
      <div class="dash-chart-toggle" id="author-chart-toggle">\
        <button class="dash-toggle-btn active" onclick="setAuthorChartType(\'line\')">Line</button>\
        <button class="dash-toggle-btn" onclick="setAuthorChartType(\'bar\')">Bar</button>\
      </div>\
    </div>\
    <div class="dash-compare-builder">\
      <div class="dash-compare-search-wrap">\
        <input type="text" class="dash-compare-input" id="author-compare-input"\
               placeholder="Search authors to compare..." oninput="debounceAuthorSearch()">\
        <div class="dash-compare-dropdown" id="author-compare-dropdown"></div>\
      </div>\
      <div class="dash-compare-tags" id="author-compare-tags"></div>\
    </div>\
    <div class="chart-container" style="height:320px"><canvas id="chart-author-compare"></canvas></div>\
  </div>\
  <div class="dash-section" id="sect-topic-compare">\
    <div class="dash-section-header">\
      <h2>Compare Topics</h2>\
      <div class="dash-chart-toggle" id="topic-chart-toggle">\
        <button class="dash-toggle-btn active" onclick="setTopicChartType(\'line\')">Line</button>\
        <button class="dash-toggle-btn" onclick="setTopicChartType(\'bar\')">Bar</button>\
      </div>\
    </div>\
    <div class="dash-compare-builder">\
      <div class="dash-compare-search-wrap">\
        <input type="text" class="dash-compare-input" id="topic-compare-input"\
               placeholder="Search topics to compare..." oninput="debounceTopicSearch()">\
        <div class="dash-compare-dropdown" id="topic-compare-dropdown"></div>\
      </div>\
      <div class="dash-compare-tags" id="topic-compare-tags"></div>\
    </div>\
    <div class="chart-container" style="height:320px"><canvas id="chart-topic-compare"></canvas></div>\
  </div>\
  <div class="dash-section" id="sect-custom-pie">\
    <div class="dash-section-header">\
      <h2>Custom Breakdown</h2>\
      <select class="dash-pie-select" id="custom-pie-select" onchange="changeCustomPie(this.value)">\
        <option value="category" selected>By Category</option>\
        <option value="source">By Source</option>\
        <option value="quote_type">By Quote Type</option>\
        <option value="top_authors">By Author (Top 10)</option>\
      </select>\
    </div>\
    <div class="dash-grid-2">\
      <div class="chart-container" style="height:320px"><canvas id="chart-custom-doughnut"></canvas></div>\
      <div class="chart-container" style="height:320px"><canvas id="chart-custom-bar"></canvas></div>\
    </div>\
  </div>\
  <div class="dash-grid-2">\
    <div class="dash-section">\
      <div class="dash-section-header"><h2>Top Authors</h2></div>\
      <div id="dash-top-authors" class="dash-ranking-list"></div>\
    </div>\
    <div class="dash-section">\
      <div class="dash-section-header"><h2>Trending Topics</h2></div>\
      <div id="dash-trending-topics" class="dash-topic-cloud"></div>\
    </div>\
  </div>\
  <div class="dash-section" id="sect-category-trends">\
    <div class="dash-section-header"><h2>Category Trends Over Time</h2></div>\
    <div class="chart-container" style="height:320px"><canvas id="chart-dash-cat-trends"></canvas></div>\
  </div>\
  <div class="dash-section" id="sect-heatmap">\
    <div class="dash-section-header"><h2>Activity Pattern</h2></div>\
    <div id="dash-heatmap" class="dash-heatmap-wrap"></div>\
  </div>\
</div>';

  if (typeof initChartDefaults === 'function') initChartDefaults();
  loadDashboard(_dashPeriod);
}

function changeDashPeriod(period) {
  _dashPeriod = period;
  if (typeof destroyAllCharts === 'function') destroyAllCharts();
  var wrap = document.getElementById('dash-period-wrap');
  if (wrap) wrap.innerHTML = renderDashPeriodSelector(period, 'changeDashPeriod');
  loadDashboard(period);
}

function loadDashboard(period) {
  loadKPIs(period);
  loadActivityTimeline(period);
  loadCategoryBreakdown(period);
  loadSourceBreakdown(period);
  loadTopAuthorsRanking(period);
  loadTrendingTopicsList(period);
  loadCategoryTrends(period);
  loadHeatmap(period);
  loadCustomPie(period);
  // Load comparisons (renders hint text when empty, chart when items selected)
  loadAuthorComparison();
  loadTopicComparison();
}

// --- KPIs ---
async function loadKPIs(period) {
  var el = document.getElementById('dash-kpis');
  if (!el) return;
  el.innerHTML = '<div class="dash-kpi-card skeleton"></div>'.repeat(6);
  try {
    var data = await API.get('/analytics/overview');
    var authorData = await API.get('/analytics/authors?period=' + period);
    var sourceData = await API.get('/analytics/sources/breakdown?period=' + period);
    var uniqueAuthors = authorData.authors ? authorData.authors.length : 0;
    var uniqueSources = sourceData.sources ? sourceData.sources.length : 0;

    el.innerHTML = '\
      <div class="dash-kpi-card"><div class="dash-kpi-value">' + data.quotes_today.toLocaleString() + '</div><div class="dash-kpi-label">Quotes Today</div></div>\
      <div class="dash-kpi-card"><div class="dash-kpi-value">' + data.quotes_this_week.toLocaleString() + '</div><div class="dash-kpi-label">This Week</div></div>\
      <div class="dash-kpi-card"><div class="dash-kpi-value">' + data.quotes_total.toLocaleString() + '</div><div class="dash-kpi-label">Total Quotes</div></div>\
      <div class="dash-kpi-card"><div class="dash-kpi-value">' + data.articles_today.toLocaleString() + '</div><div class="dash-kpi-label">Articles Today</div></div>\
      <div class="dash-kpi-card"><div class="dash-kpi-value">' + uniqueAuthors + '</div><div class="dash-kpi-label">Active Authors</div></div>\
      <div class="dash-kpi-card"><div class="dash-kpi-value">' + uniqueSources + '</div><div class="dash-kpi-label">Active Sources</div></div>';
  } catch (err) {
    el.innerHTML = '<div class="dash-error">Failed to load KPIs</div>';
  }
}

// --- Activity Timeline ---
async function loadActivityTimeline(period) {
  try {
    var data = await API.get('/analytics/trends/quotes?period=' + period);
    if (!data.buckets || data.buckets.length === 0) return;
    if (typeof createTimelineChart !== 'function') return;

    var labels = data.buckets.map(function(b) {
      if (data.granularity === 'hour') return b.bucket.slice(11, 16);
      if (data.granularity === 'week') return b.bucket;
      return b.bucket.slice(5);
    });
    var values = data.buckets.map(function(b) { return b.count; });
    createTimelineChart('chart-dash-timeline', labels, [{ label: 'Quotes', data: values }]);
  } catch (err) { console.error('Timeline:', err); }
}

// --- Category Breakdown (Doughnut) ---
async function loadCategoryBreakdown(period) {
  try {
    var data = await API.get('/analytics/categories?period=' + period);
    if (!data.categories || data.categories.length === 0) return;
    if (typeof createDoughnutChart !== 'function') return;

    var labels = data.categories.map(function(c) { return c.category; });
    var values = data.categories.map(function(c) { return c.quote_count; });
    createDoughnutChart('chart-dash-categories', labels, values);
  } catch (err) { console.error('Categories:', err); }
}

// --- Source Breakdown (Horizontal Bar) ---
async function loadSourceBreakdown(period) {
  try {
    var data = await API.get('/analytics/sources/breakdown?period=' + period);
    if (!data.sources || data.sources.length === 0) return;
    if (typeof createBarChart !== 'function') return;

    var top = data.sources.slice(0, 10);
    var labels = top.map(function(s) { return s.name || s.domain; });
    var values = top.map(function(s) { return s.quote_count; });
    createBarChart('chart-dash-sources', labels, values);
  } catch (err) { console.error('Sources:', err); }
}

// --- Top Authors Ranking ---
async function loadTopAuthorsRanking(period) {
  var el = document.getElementById('dash-top-authors');
  if (!el) return;
  try {
    var data = await API.get('/analytics/authors?period=' + period);
    if (!data.authors || data.authors.length === 0) {
      el.innerHTML = '<div class="dash-empty">No authors found</div>';
      return;
    }
    var maxQ = data.authors[0].quote_count || 1;
    var html = '';
    data.authors.slice(0, 10).forEach(function(a, i) {
      var pct = Math.round((a.quote_count / maxQ) * 100);
      var initial = (a.name || '?').charAt(0).toUpperCase();
      var avatar = a.photo_url
        ? '<img src="' + escapeHtml(a.photo_url) + '" alt="" class="dash-rank-avatar" onerror="this.outerHTML=\'<div class=dash-rank-initial>' + initial + '</div>\'">'
        : '<div class="dash-rank-initial">' + initial + '</div>';
      html += '<div class="dash-rank-item">\
        <span class="dash-rank-num">' + (i + 1) + '</span>' +
        avatar +
        '<div class="dash-rank-info">\
          <a href="/author/' + a.id + '" onclick="navigate(event, \'/author/' + a.id + '\')" class="dash-rank-name">' + escapeHtml(a.name) + '</a>\
          <span class="dash-rank-cat">' + escapeHtml(a.category || 'Other') + '</span>\
        </div>\
        <div class="dash-rank-bar-wrap"><div class="dash-rank-bar" style="width:' + pct + '%"></div></div>\
        <span class="dash-rank-count">' + a.quote_count + '</span>\
      </div>';
    });
    el.innerHTML = html;
  } catch (err) { el.innerHTML = '<div class="dash-error">Failed to load authors</div>'; }
}

// --- Trending Topics ---
async function loadTrendingTopicsList(period) {
  var el = document.getElementById('dash-trending-topics');
  if (!el) return;
  try {
    var data = await API.get('/analytics/topics?period=' + period);
    if (!data.topics || data.topics.length === 0) {
      el.innerHTML = '<div class="dash-empty">No topics found</div>';
      return;
    }
    var maxC = data.topics[0].count || 1;
    var html = '';
    data.topics.slice(0, 20).forEach(function(t) {
      var size = Math.max(0.7, Math.min(1.6, 0.7 + (t.count / maxC) * 0.9));
      var trendCls = t.trend === 'up' ? 'dash-trend-up' : t.trend === 'down' ? 'dash-trend-down' : 'dash-trend-flat';
      var arrow = t.trend === 'up' ? '&#x25B2;' : t.trend === 'down' ? '&#x25BC;' : '';
      html += '<span class="dash-topic-badge ' + trendCls + '" style="font-size:' + size.toFixed(2) + 'rem">' +
        escapeHtml(t.keyword) + '<sup class="dash-topic-count">' + t.count + '</sup>' +
        (arrow ? '<span class="dash-topic-arrow">' + arrow + '</span>' : '') +
        '</span> ';
    });
    el.innerHTML = html;
  } catch (err) { el.innerHTML = '<div class="dash-error">Failed to load topics</div>'; }
}

// --- Category Trends Over Time ---
async function loadCategoryTrends(period) {
  try {
    var data = await API.get('/analytics/categories?period=' + period);
    if (!data.series || data.series.length === 0) return;
    if (typeof createTimelineChart !== 'function') return;

    var bucketSet = {};
    data.series.forEach(function(s) { s.buckets.forEach(function(b) { bucketSet[b.bucket] = 1; }); });
    var allBuckets = Object.keys(bucketSet).sort();
    var labels = allBuckets.map(function(b) { return b.slice(5); });

    var datasets = data.series.map(function(s) {
      var map = {};
      s.buckets.forEach(function(b) { map[b.bucket] = b.count; });
      return { label: s.category, data: allBuckets.map(function(b) { return map[b] || 0; }) };
    });

    createTimelineChart('chart-dash-cat-trends', labels, datasets);
  } catch (err) { console.error('Cat trends:', err); }
}

// --- Activity Heatmap (pure CSS) ---
async function loadHeatmap(period) {
  var el = document.getElementById('dash-heatmap');
  if (!el) return;
  try {
    var data = await API.get('/analytics/heatmap?period=' + period);
    if (!data.cells || data.cells.length === 0) {
      el.innerHTML = '<div class="dash-empty">No activity data</div>';
      return;
    }

    var grid = {};
    var maxCount = 1;
    data.cells.forEach(function(c) {
      var key = c.day_of_week + '-' + c.hour;
      grid[key] = c.count;
      if (c.count > maxCount) maxCount = c.count;
    });

    var dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    var html = '<div class="dash-heatmap-grid">';
    // Header row (hours)
    html += '<div class="dash-heatmap-label"></div>';
    for (var h = 0; h < 24; h++) {
      html += '<div class="dash-heatmap-hour">' + (h % 3 === 0 ? h + 'h' : '') + '</div>';
    }
    // Data rows
    for (var d = 0; d < 7; d++) {
      html += '<div class="dash-heatmap-label">' + dayLabels[d] + '</div>';
      for (var hh = 0; hh < 24; hh++) {
        var count = grid[d + '-' + hh] || 0;
        var intensity = count > 0 ? Math.max(0.15, count / maxCount) : 0;
        var bg = count > 0 ? 'rgba(196,30,58,' + intensity.toFixed(2) + ')' : 'var(--bg-secondary)';
        html += '<div class="dash-heatmap-cell" style="background:' + bg + '" title="' +
          dayLabels[d] + ' ' + hh + ':00 — ' + count + ' quotes"></div>';
      }
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (err) { el.innerHTML = '<div class="dash-error">Failed to load heatmap</div>'; }
}

// --- Custom Pie Breakdown ---
function changeCustomPie(metric) {
  _customPieMetric = metric;
  destroyChart('chart-custom-doughnut');
  destroyChart('chart-custom-bar');
  loadCustomPie(_dashPeriod);
}

async function loadCustomPie(period) {
  try {
    var labels, values, title;
    if (_customPieMetric === 'category') {
      var data = await API.get('/analytics/categories?period=' + period);
      labels = data.categories.map(function(c) { return c.category; });
      values = data.categories.map(function(c) { return c.quote_count; });
    } else if (_customPieMetric === 'source') {
      var data = await API.get('/analytics/sources/breakdown?period=' + period);
      var top = data.sources.slice(0, 10);
      labels = top.map(function(s) { return s.name || s.domain; });
      values = top.map(function(s) { return s.quote_count; });
    } else if (_customPieMetric === 'quote_type') {
      var data = await API.get('/analytics/quotes?period=' + period);
      var direct = 0, indirect = 0;
      (data.quotes || []).forEach(function(q) {
        if (q.quote_type === 'indirect') indirect++; else direct++;
      });
      labels = ['Direct', 'Indirect'];
      values = [direct, indirect];
    } else if (_customPieMetric === 'top_authors') {
      var data = await API.get('/analytics/authors?period=' + period);
      var top = (data.authors || []).slice(0, 10);
      labels = top.map(function(a) { return a.name; });
      values = top.map(function(a) { return a.quote_count; });
    }
    if (!labels || labels.length === 0) return;
    if (typeof createDoughnutChart === 'function') createDoughnutChart('chart-custom-doughnut', labels, values);
    if (typeof createBarChart === 'function') createBarChart('chart-custom-bar', labels, values);
  } catch (err) { console.error('Custom pie:', err); }
}

// --- Author Comparison Builder ---
function debounceAuthorSearch() {
  clearTimeout(_debounceTimers.author);
  _debounceTimers.author = setTimeout(searchAuthors, 300);
}

async function searchAuthors() {
  var input = document.getElementById('author-compare-input');
  var dropdown = document.getElementById('author-compare-dropdown');
  if (!input || !dropdown) return;
  var q = input.value.trim();
  if (q.length < 2) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }

  try {
    var data = await API.get('/analytics/authors/search?q=' + encodeURIComponent(q));
    if (!data.authors || data.authors.length === 0) {
      dropdown.innerHTML = '<div class="dash-dropdown-empty">No authors found</div>';
      dropdown.style.display = 'block';
      return;
    }
    dropdown.innerHTML = data.authors.map(function(a) {
      var disabled = _authorCompareIds.indexOf(a.id) >= 0;
      var initial = (a.name || '?').charAt(0).toUpperCase();
      var avatar = a.photo_url
        ? '<img src="' + escapeHtml(a.photo_url) + '" alt="" class="dash-dd-avatar" onerror="this.outerHTML=\'<span class=dash-dd-initial>' + initial + '</span>\'">'
        : '<span class="dash-dd-initial">' + initial + '</span>';
      return '<div class="dash-dropdown-item' + (disabled ? ' disabled' : '') + '"' +
        (disabled ? '' : ' onclick="addAuthorToCompare(' + a.id + ',\'' + escapeHtml(a.name).replace(/'/g, "\\'") + '\')"') + '>' +
        avatar + '<span class="dash-dd-name">' + escapeHtml(a.name) + '</span>' +
        '<span class="dash-dd-meta">' + (a.quote_count || 0) + ' quotes</span></div>';
    }).join('');
    dropdown.style.display = 'block';
  } catch (err) { dropdown.style.display = 'none'; }
}

function addAuthorToCompare(id, name) {
  if (_authorCompareIds.indexOf(id) >= 0 || _authorCompareIds.length >= 8) return;
  _authorCompareIds.push(id);
  renderAuthorCompareTags();
  var input = document.getElementById('author-compare-input');
  var dropdown = document.getElementById('author-compare-dropdown');
  if (input) input.value = '';
  if (dropdown) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }
  loadAuthorComparison();
}

function removeAuthorFromCompare(id) {
  _authorCompareIds = _authorCompareIds.filter(function(x) { return x !== id; });
  renderAuthorCompareTags();
  loadAuthorComparison();
}

function renderAuthorCompareTags() {
  // We store names as data attribute; for now re-render will fetch
  var el = document.getElementById('author-compare-tags');
  if (!el) return;
  if (_authorCompareIds.length === 0) { el.innerHTML = '<span class="dash-compare-hint">Select authors above to compare their quote activity over time</span>'; return; }
  // Tags are rendered from comparison data
}

async function loadAuthorComparison() {
  var el = document.getElementById('author-compare-tags');
  if (_authorCompareIds.length === 0) {
    destroyChart('chart-author-compare');
    if (el) el.innerHTML = '<span class="dash-compare-hint">Select authors above to compare their quote activity over time</span>';
    return;
  }
  try {
    var data = await API.get('/analytics/compare/authors?ids=' + _authorCompareIds.join(',') + '&period=' + _dashPeriod);
    if (!data.authors || data.authors.length === 0) return;

    // Render tags from response data
    if (el) {
      el.innerHTML = data.authors.map(function(a, i) {
        var color = CHART_COLORS[i % CHART_COLORS.length];
        return '<span class="dash-compare-tag" style="border-color:' + color + ';color:' + color + '">' +
          escapeHtml(a.name) + ' <span class="dash-tag-count">' + a.total + '</span>' +
          '<button class="dash-tag-remove" onclick="removeAuthorFromCompare(' + a.id + ')">&times;</button></span>';
      }).join('');
    }

    // Build chart
    var bucketSet = {};
    data.authors.forEach(function(a) { a.buckets.forEach(function(b) { bucketSet[b.bucket] = 1; }); });
    var allBuckets = Object.keys(bucketSet).sort();
    var labels = allBuckets.map(function(b) { return b.slice(5); });

    var datasets = data.authors.map(function(a) {
      var map = {};
      a.buckets.forEach(function(b) { map[b.bucket] = b.count; });
      return { label: a.name, data: allBuckets.map(function(b) { return map[b] || 0; }) };
    });

    destroyChart('chart-author-compare');
    if (_authorChartType === 'bar') {
      if (typeof createStackedBarChart === 'function') createStackedBarChart('chart-author-compare', labels, datasets);
    } else {
      if (typeof createTimelineChart === 'function') createTimelineChart('chart-author-compare', labels, datasets);
    }
  } catch (err) { console.error('Author compare:', err); }
}

function setAuthorChartType(type) {
  _authorChartType = type;
  var toggle = document.getElementById('author-chart-toggle');
  if (toggle) toggle.querySelectorAll('.dash-toggle-btn').forEach(function(b) {
    b.classList.toggle('active', b.textContent.toLowerCase() === type);
  });
  if (_authorCompareIds.length > 0) loadAuthorComparison();
}

// --- Topic Comparison Builder ---
function debounceTopicSearch() {
  clearTimeout(_debounceTimers.topic);
  _debounceTimers.topic = setTimeout(searchTopics, 300);
}

async function searchTopics() {
  var input = document.getElementById('topic-compare-input');
  var dropdown = document.getElementById('topic-compare-dropdown');
  if (!input || !dropdown) return;
  var q = input.value.trim();
  if (q.length < 2) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; return; }

  try {
    var data = await API.get('/analytics/topics/list?period=' + _dashPeriod + '&q=' + encodeURIComponent(q) + '&limit=10');
    if (!data.topics || data.topics.length === 0) {
      dropdown.innerHTML = '<div class="dash-dropdown-empty">No topics found</div>';
      dropdown.style.display = 'block';
      return;
    }
    dropdown.innerHTML = data.topics.map(function(t) {
      var disabled = _topicCompareKeywords.indexOf(t.keyword) >= 0;
      return '<div class="dash-dropdown-item' + (disabled ? ' disabled' : '') + '"' +
        (disabled ? '' : ' onclick="addTopicToCompare(\'' + escapeHtml(t.keyword).replace(/'/g, "\\'") + '\')"') + '>' +
        '<span class="dash-dd-name">' + escapeHtml(t.keyword) + '</span>' +
        '<span class="dash-dd-meta">' + t.count + ' mentions</span></div>';
    }).join('');
    dropdown.style.display = 'block';
  } catch (err) { dropdown.style.display = 'none'; }
}

function addTopicToCompare(keyword) {
  if (_topicCompareKeywords.indexOf(keyword) >= 0 || _topicCompareKeywords.length >= 8) return;
  _topicCompareKeywords.push(keyword);
  var input = document.getElementById('topic-compare-input');
  var dropdown = document.getElementById('topic-compare-dropdown');
  if (input) input.value = '';
  if (dropdown) { dropdown.innerHTML = ''; dropdown.style.display = 'none'; }
  loadTopicComparison();
}

function removeTopicFromCompare(keyword) {
  _topicCompareKeywords = _topicCompareKeywords.filter(function(k) { return k !== keyword; });
  loadTopicComparison();
}

async function loadTopicComparison() {
  var el = document.getElementById('topic-compare-tags');
  if (_topicCompareKeywords.length === 0) {
    destroyChart('chart-topic-compare');
    if (el) el.innerHTML = '<span class="dash-compare-hint">Select topics above to compare their frequency over time</span>';
    return;
  }
  try {
    var data = await API.get('/analytics/compare/topics?keywords=' + _topicCompareKeywords.map(encodeURIComponent).join(',') + '&period=' + _dashPeriod);
    if (!data.topics || data.topics.length === 0) return;

    if (el) {
      el.innerHTML = data.topics.map(function(t, i) {
        var color = CHART_COLORS[i % CHART_COLORS.length];
        return '<span class="dash-compare-tag" style="border-color:' + color + ';color:' + color + '">' +
          escapeHtml(t.keyword) + ' <span class="dash-tag-count">' + t.total + '</span>' +
          '<button class="dash-tag-remove" onclick="removeTopicFromCompare(\'' + escapeHtml(t.keyword).replace(/'/g, "\\'") + '\')">&times;</button></span>';
      }).join('');
    }

    var bucketSet = {};
    data.topics.forEach(function(t) { t.buckets.forEach(function(b) { bucketSet[b.bucket] = 1; }); });
    var allBuckets = Object.keys(bucketSet).sort();
    var labels = allBuckets.map(function(b) { return b.slice(5); });

    var datasets = data.topics.map(function(t) {
      var map = {};
      t.buckets.forEach(function(b) { map[b.bucket] = b.count; });
      return { label: t.keyword, data: allBuckets.map(function(b) { return map[b] || 0; }) };
    });

    destroyChart('chart-topic-compare');
    if (_topicChartType === 'bar') {
      if (typeof createStackedBarChart === 'function') createStackedBarChart('chart-topic-compare', labels, datasets);
    } else {
      if (typeof createTimelineChart === 'function') createTimelineChart('chart-topic-compare', labels, datasets);
    }
  } catch (err) { console.error('Topic compare:', err); }
}

function setTopicChartType(type) {
  _topicChartType = type;
  var toggle = document.getElementById('topic-chart-toggle');
  if (toggle) toggle.querySelectorAll('.dash-toggle-btn').forEach(function(b) {
    b.classList.toggle('active', b.textContent.toLowerCase() === type);
  });
  if (_topicCompareKeywords.length > 0) loadTopicComparison();
}

// Close dropdowns on outside click
document.addEventListener('click', function(e) {
  if (!e.target.closest('.dash-compare-search-wrap')) {
    var dds = document.querySelectorAll('.dash-compare-dropdown');
    dds.forEach(function(dd) { dd.style.display = 'none'; });
  }
});
