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
      get: vi.fn().mockResolvedValue({
        period_days: 30,
        total_quotes: 100,
        total_authors: 25,
        topics: [
          { id: 1, name: 'U.S. Politics', slug: 'us-politics', quote_count: 50 },
          { id: 2, name: 'Economy', slug: 'economy', quote_count: 30 },
        ],
        keywords: [
          { id: 1, name: 'Donald Trump', keyword_type: 'person', quote_count: 20 },
          { id: 2, name: 'Federal Reserve', keyword_type: 'organization', quote_count: 10 },
        ],
        authors: [
          { id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', quote_count: 15 },
        ],
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

  it('renderAnalytics calls API.get with overview endpoint', async () => {
    await mod.renderAnalytics();
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview?days=30');
  });

  it('changeAnalyticsPeriod updates days and calls API', async () => {
    // First render to set up the page
    await mod.renderAnalytics();
    global.API.get.mockClear();
    await mod.changeAnalyticsPeriod(7);
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview?days=7');
  });

  it('renderAnalyticsData renders stats cards', () => {
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

    mod.renderAnalyticsData({
      total_quotes: 100,
      total_authors: 25,
      topics: [{ id: 1, name: 'U.S. Politics', slug: 'us-politics', quote_count: 50 }],
      keywords: [{ id: 1, name: 'GDP Growth', keyword_type: 'concept', quote_count: 10 }],
      authors: [{ id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', quote_count: 15 }],
    });

    expect(page.insertAdjacentHTML).toHaveBeenCalled();
    const html = page.insertAdjacentHTML.mock.calls[0][1];
    expect(html).toContain('100');
    expect(html).toContain('25');
    expect(html).toContain('U.S. Politics');
    expect(html).toContain('GDP Growth');
    expect(html).toContain('Author A');
  });

  it('renderAnalyticsData renders topic cloud', () => {
    const page = {
      querySelector: vi.fn(() => ({ remove: vi.fn() })),
      querySelectorAll: vi.fn(() => []),
      insertAdjacentHTML: vi.fn(),
    };
    global.document.querySelector = vi.fn(() => page);

    mod.renderAnalyticsData({
      total_quotes: 10,
      total_authors: 2,
      topics: [
        { id: 1, name: 'Economy', slug: 'economy', quote_count: 5 },
        { id: 2, name: 'Trade', slug: 'trade', quote_count: 3 },
      ],
      keywords: [],
      authors: [],
    });

    const html = page.insertAdjacentHTML.mock.calls[0][1];
    expect(html).toContain('Trending Topics');
    expect(html).toContain('topics-cloud');
    expect(html).toContain('Economy');
    expect(html).toContain('Trade');
  });

  it('renderAnalyticsData renders keyword groups by type', () => {
    const page = {
      querySelector: vi.fn(() => ({ remove: vi.fn() })),
      querySelectorAll: vi.fn(() => []),
      insertAdjacentHTML: vi.fn(),
    };
    global.document.querySelector = vi.fn(() => page);

    mod.renderAnalyticsData({
      total_quotes: 10,
      total_authors: 2,
      topics: [],
      keywords: [
        { id: 1, name: 'Donald Trump', keyword_type: 'person', quote_count: 10 },
        { id: 2, name: 'Federal Reserve', keyword_type: 'organization', quote_count: 5 },
      ],
      authors: [],
    });

    const html = page.insertAdjacentHTML.mock.calls[0][1];
    expect(html).toContain('Trending Keywords');
    expect(html).toContain('keyword-type-person');
    expect(html).toContain('keyword-type-organization');
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
