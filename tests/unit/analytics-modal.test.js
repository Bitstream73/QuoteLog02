import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const chartsJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/charts.js'), 'utf-8');
const analyticsJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/analytics.js'), 'utf-8');

describe('Analytics Modal', () => {
  let openAnalytics, closeAnalytics, switchAnalyticsTab, renderPeriodSelector;
  let mockModal, mockBody;

  beforeEach(() => {
    // Mock DOM
    mockModal = { style: { display: 'none' } };
    mockBody = { innerHTML: '', style: {} };
    const mockTabs = [];

    global.document = {
      getElementById: vi.fn((id) => {
        if (id === 'analytics-modal') return mockModal;
        if (id === 'analytics-body') return mockBody;
        return null;
      }),
      querySelectorAll: vi.fn(() => mockTabs),
      body: { style: {} },
    };

    // Mock API
    global.API = {
      get: vi.fn().mockResolvedValue({
        quotes_today: 10,
        quotes_this_week: 50,
        quotes_total: 1000,
        articles_today: 5,
        top_author_today: { id: 1, name: 'Test Author', photo_url: null, quote_count: 3 },
        most_upvoted_today: { id: 1, text: 'Test quote', person_name: 'Author', vote_score: 5 },
        quotes_per_day: [{ date: '2025-02-01', count: 10 }, { date: '2025-02-02', count: 15 }],
      }),
    };

    global.escapeHtml = (s) => s || '';
    global.console = { ...console, error: vi.fn() };

    // Mock Chart.js
    const mockChartInstance = { destroy: vi.fn(), update: vi.fn() };
    global.Chart = vi.fn(() => mockChartInstance);
    global.Chart.defaults = { font: {}, color: '', plugins: { tooltip: {}, legend: { labels: {} } } };

    // Evaluate charts.js first (provides destroyAllCharts, initChartDefaults, etc.)
    new Function('Chart', 'document', chartsJsSrc)(global.Chart, global.document);

    // Evaluate analytics.js
    const module = {};
    const fn = new Function('module', 'document', 'API', 'escapeHtml',
      analyticsJsSrc + '\nmodule.openAnalytics = openAnalytics; module.closeAnalytics = closeAnalytics; module.switchAnalyticsTab = switchAnalyticsTab; module.renderPeriodSelector = renderPeriodSelector;');
    fn(module, global.document, global.API, global.escapeHtml);
    openAnalytics = module.openAnalytics;
    closeAnalytics = module.closeAnalytics;
    switchAnalyticsTab = module.switchAnalyticsTab;
    renderPeriodSelector = module.renderPeriodSelector;
  });

  it('openAnalytics shows modal', () => {
    openAnalytics();
    expect(mockModal.style.display).toBe('');
  });

  it('closeAnalytics hides modal', () => {
    openAnalytics();
    closeAnalytics();
    expect(mockModal.style.display).toBe('none');
  });

  it('switchAnalyticsTab loads overview content', async () => {
    switchAnalyticsTab('overview');
    // Wait for async API call
    await new Promise(r => setTimeout(r, 50));
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview');
  });

  it('switchAnalyticsTab loads quotes tab', async () => {
    global.API.get.mockResolvedValue({ period: 'week', quotes: [] });
    switchAnalyticsTab('quotes');
    await new Promise(r => setTimeout(r, 50));
    expect(global.API.get).toHaveBeenCalledWith('/analytics/quotes?period=week');
  });

  it('switchAnalyticsTab loads authors tab', async () => {
    global.API.get.mockResolvedValue({ period: 'week', authors: [] });
    switchAnalyticsTab('authors');
    await new Promise(r => setTimeout(r, 50));
    expect(global.API.get).toHaveBeenCalledWith('/analytics/authors?period=week');
  });

  it('switchAnalyticsTab loads topics tab', async () => {
    global.API.get.mockResolvedValue({ period: 'week', topics: [] });
    switchAnalyticsTab('topics');
    await new Promise(r => setTimeout(r, 50));
    expect(global.API.get).toHaveBeenCalledWith('/analytics/topics?period=week');
  });

  it('renderPeriodSelector shows all four periods', () => {
    const html = renderPeriodSelector('week', 'loadTopQuotes');
    expect(html).toContain('Day');
    expect(html).toContain('Week');
    expect(html).toContain('Month');
    expect(html).toContain('Year');
  });

  it('renderPeriodSelector marks active period', () => {
    const html = renderPeriodSelector('month', 'loadTopQuotes');
    expect(html).toMatch(/period-btn\s+active[^"]*"[^>]*>Month/);
  });

  it('overview renders stat cards', async () => {
    openAnalytics();
    await new Promise(r => setTimeout(r, 100));
    // Body should contain stat values
    expect(mockBody.innerHTML).toContain('10');
    expect(mockBody.innerHTML).toContain('50');
    expect(mockBody.innerHTML).toContain('stat-card');
  });

  it('overview renders sparkline bars', async () => {
    openAnalytics();
    await new Promise(r => setTimeout(r, 100));
    expect(mockBody.innerHTML).toContain('sparkline-bar');
  });

  it('switchAnalyticsTab loads trends tab', async () => {
    global.API.get.mockResolvedValue({ period: 'week', granularity: 'day', buckets: [], series: [] });
    switchAnalyticsTab('trends');
    await new Promise(r => setTimeout(r, 100));
    expect(global.API.get).toHaveBeenCalledWith('/analytics/trends/quotes?period=week');
    expect(mockBody.innerHTML).toContain('chart-trend-quotes');
  });
});
