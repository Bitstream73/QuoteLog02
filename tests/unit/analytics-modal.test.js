import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const analyticsJsSrc = fs.readFileSync(path.join(__dirname, '../../public/js/analytics.js'), 'utf-8');

describe('Analytics Page', () => {
  let mod, mockContent;

  beforeEach(() => {
    const mockElements = {};
    mockContent = { innerHTML: '', style: {} };
    mockElements['content'] = mockContent;
    mockElements['analytics-period'] = { value: '30' };

    global.document = {
      getElementById: vi.fn((id) => mockElements[id] || null),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => []),
      addEventListener: vi.fn(),
      body: { style: {} },
    };

    global.API = {
      get: vi.fn((url) => {
        if (url.startsWith('/analytics/overview')) {
          return Promise.resolve({
            period_days: 30,
            total_quotes: 100,
            total_authors: 25,
            authors: [
              { id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', quote_count: 15 },
            ],
          });
        }
        if (url.startsWith('/analytics/trending-quotes')) {
          return Promise.resolve({
            quote_of_day: null,
            quote_of_week: null,
            quote_of_month: null,
            recent_quotes: [],
          });
        }
        return Promise.resolve({});
      }),
    };

    global.navigate = vi.fn();
    global.escapeHtml = (s) => s || '';
    global.escapeAttr = (s) => s || '';
    global.console = { ...console, error: vi.fn() };

    mod = {};
    const combined = analyticsJsSrc +
      '\nmod.renderAnalytics = renderAnalytics;' +
      '\nmod.changeAnalyticsPeriod = changeAnalyticsPeriod;' +
      '\nmod.loadAnalytics = loadAnalytics;' +
      '\nmod.renderAnalyticsData = renderAnalyticsData;' +
      '\nmod.formatDateShort = formatDateShort;';
    const fn = new Function('mod', 'document', 'API', 'escapeHtml', 'escapeAttr', 'navigate', 'console', combined);
    fn(mod, global.document, global.API, global.escapeHtml, global.escapeAttr, global.navigate, global.console);
  });

  it('renderAnalytics sets up page structure', async () => {
    await mod.renderAnalytics();
    expect(mockContent.innerHTML).toContain('Analytics');
    expect(mockContent.innerHTML).toContain('analytics-period');
    expect(mockContent.innerHTML).toContain('analytics-page');
  });

  it('renderAnalytics calls API.get with overview and trending-quotes endpoints', async () => {
    await mod.renderAnalytics();
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview?days=30');
    expect(global.API.get).toHaveBeenCalledWith('/analytics/trending-quotes');
  });

  it('changeAnalyticsPeriod updates days and calls API', async () => {
    // First render to set up the page
    await mod.renderAnalytics();
    global.API.get.mockClear();
    await mod.changeAnalyticsPeriod(7);
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview?days=7');
    expect(global.API.get).toHaveBeenCalledWith('/analytics/trending-quotes');
  });

  it('renderAnalyticsData renders stats cards', async () => {
    // Set up DOM for renderAnalyticsData
    const page = {
      querySelector: vi.fn((sel) => {
        if (sel === '.analytics-loading') return { remove: vi.fn() };
        return null;
      }),
      querySelectorAll: vi.fn(() => []),
      insertAdjacentHTML: vi.fn(),
    };
    global.document.querySelector = vi.fn(() => page);

    await mod.renderAnalyticsData({
      total_quotes: 100,
      total_authors: 25,
      authors: [{ id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', quote_count: 15 }],
    });

    expect(page.insertAdjacentHTML).toHaveBeenCalled();
    const html = page.insertAdjacentHTML.mock.calls[0][1];
    expect(html).toContain('100');
    expect(html).toContain('25');
    expect(html).toContain('Author A');
  });

  it('formatDateShort formats dates correctly', () => {
    const result = mod.formatDateShort('2026-01-15T12:00:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
    expect(result).toContain('2026');
  });

  it('formatDateShort returns empty for null', () => {
    expect(mod.formatDateShort(null)).toBe('');
    expect(mod.formatDateShort('')).toBe('');
  });
});
