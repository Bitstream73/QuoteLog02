// Chart.js Factory — shared chart creation utilities
// Guards all functions behind typeof Chart check for graceful degradation

var _activeCharts = {};

var CHART_COLORS = [
  '#c41e3a', '#2563eb', '#16a34a', '#d4880f',
  '#7c3aed', '#0891b2', '#dc2626', '#059669'
];

function registerChart(key, instance) {
  if (_activeCharts[key]) {
    _activeCharts[key].destroy();
  }
  _activeCharts[key] = instance;
}

function destroyChart(key) {
  if (_activeCharts[key]) {
    _activeCharts[key].destroy();
    delete _activeCharts[key];
  }
}

function destroyAllCharts() {
  for (var key in _activeCharts) {
    if (_activeCharts[key] && typeof _activeCharts[key].destroy === 'function') {
      _activeCharts[key].destroy();
    }
  }
  _activeCharts = {};
}

function initChartDefaults() {
  if (typeof Chart === 'undefined') return;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  Chart.defaults.font.family = "'DM Sans', sans-serif";
  Chart.defaults.font.size = 12;
  Chart.defaults.color = isDark ? '#B8B8C8' : '#4a4a4a';
  Chart.defaults.plugins.tooltip.backgroundColor = '#1a1a1a';
  Chart.defaults.plugins.tooltip.cornerRadius = 4;
  Chart.defaults.plugins.tooltip.padding = 8;
  Chart.defaults.plugins.legend.labels.usePointStyle = true;
  Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
}

function createTimelineChart(canvasId, labels, datasets, options) {
  if (typeof Chart === 'undefined') return null;
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  var defaultDatasets = datasets.map(function(ds, i) {
    return Object.assign({
      borderColor: CHART_COLORS[i % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length] + '1A',
      borderWidth: 2,
      pointRadius: 2,
      pointHoverRadius: 5,
      tension: 0.3,
      fill: datasets.length === 1,
    }, ds);
  });

  var cfg = {
    type: 'line',
    data: { labels: labels, datasets: defaultDatasets },
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' } },
      },
      plugins: { legend: { display: datasets.length > 1 } },
    }, options || {}),
  };

  var chart = new Chart(canvas, cfg);
  registerChart(canvasId, chart);
  return chart;
}

function createBarChart(canvasId, labels, data, options) {
  if (typeof Chart === 'undefined') return null;
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  var colors = labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length]; });

  var cfg = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: Object.assign({
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { grid: { display: false } },
      },
      plugins: { legend: { display: false } },
    }, options || {}),
  };

  var chart = new Chart(canvas, cfg);
  registerChart(canvasId, chart);
  return chart;
}

function createDoughnutChart(canvasId, labels, data, options) {
  if (typeof Chart === 'undefined') return null;
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  var colors = labels.map(function(_, i) { return CHART_COLORS[i % CHART_COLORS.length]; });

  var cfg = {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: isDark ? '#141420' : '#ffffff',
      }],
    },
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      cutout: '55%',
      plugins: {
        legend: {
          position: 'right',
          labels: { padding: 12, font: { size: 11 } },
        },
      },
    }, options || {}),
  };

  var chart = new Chart(canvas, cfg);
  registerChart(canvasId, chart);
  return chart;
}

function createStackedBarChart(canvasId, labels, datasets, options) {
  if (typeof Chart === 'undefined') return null;
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  var defaultDatasets = datasets.map(function(ds, i) {
    return Object.assign({
      backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
      borderWidth: 0,
      borderRadius: 2,
    }, ds);
  });

  var cfg = {
    type: 'bar',
    data: { labels: labels, datasets: defaultDatasets },
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } },
      },
      plugins: { legend: { display: true } },
    }, options || {}),
  };

  var chart = new Chart(canvas, cfg);
  registerChart(canvasId, chart);
  return chart;
}

function createVerticalBarChart(canvasId, labels, data, colors, options) {
  if (typeof Chart === 'undefined') return null;
  var canvas = document.getElementById(canvasId);
  if (!canvas) return null;
  var isDark = document.documentElement.getAttribute('data-theme') === 'dark';

  var cfg = {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: colors,
        borderWidth: 0,
        borderRadius: 3,
      }],
    },
    options: Object.assign({
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, max: 100, ticks: { callback: function(v) { return v + '%'; }, precision: 0 } },
      },
      plugins: { legend: { display: false } },
    }, options || {}),
    plugins: [{
      id: 'barLabels',
      afterDatasetsDraw: function(chart) {
        var ctx = chart.ctx;
        var meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.font = '11px "DM Sans", sans-serif';
        ctx.fillStyle = isDark ? '#B8B8C8' : '#4a4a4a';
        ctx.textAlign = 'center';
        for (var i = 0; i < meta.data.length; i++) {
          var bar = meta.data[i];
          var value = chart.data.datasets[0].data[i];
          if (value > 0) {
            ctx.fillText(value + '%', bar.x, bar.y - 5);
          }
        }
        ctx.restore();
      },
    }],
  };

  var chart = new Chart(canvas, cfg);
  registerChart(canvasId, chart);
  return chart;
}

function fillMissingDates(buckets, startDate, endDate) {
  var dateMap = {};
  for (var i = 0; i < buckets.length; i++) {
    dateMap[buckets[i].bucket] = buckets[i].count;
  }

  var result = [];
  var current = new Date(startDate);
  var end = new Date(endDate);

  while (current <= end) {
    var key = current.toISOString().slice(0, 10);
    result.push({ bucket: key, count: dateMap[key] || 0 });
    current.setDate(current.getDate() + 1);
  }

  return result;
}
