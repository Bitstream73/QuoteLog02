import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const chartsJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/charts.js'), 'utf-8');
const analyticsJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/analytics.js'), 'utf-8');

describe('Analytics Dashboard Page', () => {
  let mod, mockContent, mockElements;

  beforeEach(() => {
    mockElements = {};
    mockContent = { innerHTML: '', style: {} };
    mockElements['content'] = mockContent;
    mockElements['dash-period-wrap'] = { innerHTML: '' };
    mockElements['dash-kpis'] = { innerHTML: '' };
    mockElements['dash-top-authors'] = { innerHTML: '' };
    mockElements['dash-trending-topics'] = { innerHTML: '' };
    mockElements['dash-heatmap'] = { innerHTML: '' };
    mockElements['author-compare-input'] = { value: '' };
    mockElements['author-compare-dropdown'] = { innerHTML: '', style: { display: 'none' } };
    mockElements['author-compare-tags'] = { innerHTML: '' };
    mockElements['topic-compare-input'] = { value: '' };
    mockElements['topic-compare-dropdown'] = { innerHTML: '', style: { display: 'none' } };
    mockElements['topic-compare-tags'] = { innerHTML: '' };

    global.document = {
      getElementById: vi.fn((id) => mockElements[id] || null),
      querySelectorAll: vi.fn(() => []),
      addEventListener: vi.fn(),
      body: { style: {} },
    };

    global.API = {
      get: vi.fn().mockResolvedValue({
        quotes_today: 10,
        quotes_this_week: 50,
        quotes_total: 1000,
        articles_today: 5,
        top_author_today: { id: 1, name: 'Test Author', photo_url: null, quote_count: 3 },
        most_upvoted_today: { id: 1, text: 'Test quote', person_name: 'Author', vote_score: 5 },
        quotes_per_day: [],
        period: 'month',
        authors: [{ id: 1, name: 'Author A', quote_count: 10, category: 'Politician' }],
        sources: [{ id: 1, name: 'CNN', quote_count: 5, article_count: 3 }],
        categories: [{ category: 'Politician', quote_count: 10, author_count: 2 }],
        series: [],
        buckets: [{ bucket: '2025-02-01', count: 5 }],
        granularity: 'day',
        cells: [],
        topics: [{ keyword: 'economy', count: 5 }],
      }),
    };

    global.navigate = vi.fn();
    global.escapeHtml = (s) => s || '';
    global.console = { ...console, error: vi.fn() };

    const mockChartInstance = { destroy: vi.fn(), update: vi.fn() };
    global.Chart = vi.fn(() => mockChartInstance);
    global.Chart.defaults = { font: {}, color: '', plugins: { tooltip: {}, legend: { labels: {} } } };

    // Evaluate both scripts in same scope so chart functions are visible to analytics
    mod = {};
    const combined = chartsJsSrc + '\n' + analyticsJsSrc +
      '\nmod.renderAnalyticsPage = renderAnalyticsPage;' +
      '\nmod.openAnalytics = openAnalytics;' +
      '\nmod.closeAnalytics = closeAnalytics;' +
      '\nmod.renderDashPeriodSelector = renderDashPeriodSelector;' +
      '\nmod.changeDashPeriod = changeDashPeriod;' +
      '\nmod.loadDashboard = loadDashboard;';
    const fn = new Function('mod', 'Chart', 'document', 'API', 'escapeHtml', 'navigate', 'console', combined);
    fn(mod, global.Chart, global.document, global.API, global.escapeHtml, global.navigate, global.console);
  });

  it('renderAnalyticsPage renders dashboard to #content', () => {
    mod.renderAnalyticsPage();
    expect(mockContent.innerHTML).toContain('Analytics Dashboard');
    expect(mockContent.innerHTML).toContain('dash-kpi-row');
    expect(mockContent.innerHTML).toContain('chart-dash-timeline');
  });

  it('renderAnalyticsPage renders all dashboard sections', () => {
    mod.renderAnalyticsPage();
    expect(mockContent.innerHTML).toContain('Quote Activity');
    expect(mockContent.innerHTML).toContain('Categories');
    expect(mockContent.innerHTML).toContain('Top Sources');
    expect(mockContent.innerHTML).toContain('Compare Authors');
    expect(mockContent.innerHTML).toContain('Compare Topics');
    expect(mockContent.innerHTML).toContain('Custom Breakdown');
    expect(mockContent.innerHTML).toContain('Top Authors');
    expect(mockContent.innerHTML).toContain('Trending Topics');
    expect(mockContent.innerHTML).toContain('Category Trends');
    expect(mockContent.innerHTML).toContain('Activity Pattern');
  });

  it('openAnalytics navigates to /analytics (legacy compat)', () => {
    mod.openAnalytics();
    expect(global.navigate).toHaveBeenCalledWith(null, '/analytics');
  });

  it('renderDashPeriodSelector shows all four periods', () => {
    const html = mod.renderDashPeriodSelector('month', 'changeDashPeriod');
    expect(html).toContain('24h');
    expect(html).toContain('7 days');
    expect(html).toContain('30 days');
    expect(html).toContain('365 days');
  });

  it('renderDashPeriodSelector marks active period', () => {
    const html = mod.renderDashPeriodSelector('month', 'changeDashPeriod');
    expect(html).toMatch(/dash-period-btn active.*30 days/);
  });

  it('loadDashboard calls section API endpoints', async () => {
    mod.renderAnalyticsPage();
    await new Promise(r => setTimeout(r, 50));
    const calls = global.API.get.mock.calls.map(c => c[0]);
    expect(calls).toContain('/analytics/overview');
    expect(calls.some(c => c.startsWith('/analytics/trends/quotes'))).toBe(true);
    expect(calls.some(c => c.startsWith('/analytics/categories'))).toBe(true);
    expect(calls.some(c => c.startsWith('/analytics/sources/breakdown'))).toBe(true);
    expect(calls.some(c => c.startsWith('/analytics/heatmap'))).toBe(true);
  });

  it('renderAnalyticsPage includes comparison builders', () => {
    mod.renderAnalyticsPage();
    expect(mockContent.innerHTML).toContain('author-compare-input');
    expect(mockContent.innerHTML).toContain('topic-compare-input');
  });

  it('renderAnalyticsPage includes custom pie selector', () => {
    mod.renderAnalyticsPage();
    expect(mockContent.innerHTML).toContain('custom-pie-select');
    expect(mockContent.innerHTML).toContain('By Category');
    expect(mockContent.innerHTML).toContain('By Source');
  });

  it('renderAnalyticsPage includes chart type toggles', () => {
    mod.renderAnalyticsPage();
    expect(mockContent.innerHTML).toContain('author-chart-toggle');
    expect(mockContent.innerHTML).toContain('topic-chart-toggle');
  });
});
