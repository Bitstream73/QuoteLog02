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
        if (url.startsWith('/analytics/highlights')) {
          return Promise.resolve({
            period_days: 30,
            importance: {
              quotes: [{ id: 1, text: 'Important quote', context: 'ctx', importants_count: 10, person_id: 1, person_name: 'Author A', photo_url: null, canonical_name: 'Author A', created_at: '2026-01-01T00:00:00Z' }],
              authors: [{ id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', total_importants: 15 }],
              topics: [{ id: 1, name: 'Economy', slug: 'economy', total_importants: 15 }],
            },
            truth_falsehood: {
              truthful: [{ id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', verdict_count: 2 }],
              misleading: [{ id: 2, canonical_name: 'Author B', photo_url: null, category: 'Business', verdict_count: 1 }],
              false: [{ id: 3, canonical_name: 'Author C', photo_url: null, category: 'Journalist', verdict_count: 1 }],
            },
          });
        }
        return Promise.resolve({});
      }),
    };

    global.navigate = vi.fn();
    global.escapeHtml = (s) => s || '';
    global.escapeAttr = (s) => s || '';
    global.isAdmin = false;
    global.console = { ...console, error: vi.fn() };

    mod = {};
    const combined = analyticsJsSrc +
      '\nmod.renderAnalytics = renderAnalytics;' +
      '\nmod.changeAnalyticsPeriod = changeAnalyticsPeriod;' +
      '\nmod.loadAnalytics = loadAnalytics;' +
      '\nmod.renderAnalyticsData = renderAnalyticsData;' +
      '\nmod.formatDateShort = formatDateShort;' +
      '\nmod.renderHighestImportanceHtml = renderHighestImportanceHtml;' +
      '\nmod.renderTruthFalsehoodHtml = renderTruthFalsehoodHtml;';
    const fn = new Function('mod', 'document', 'API', 'escapeHtml', 'escapeAttr', 'navigate', 'console', 'isAdmin', combined);
    fn(mod, global.document, global.API, global.escapeHtml, global.escapeAttr, global.navigate, global.console, global.isAdmin);
  });

  it('renderAnalytics sets up page structure with 24h option', async () => {
    await mod.renderAnalytics();
    expect(mockContent.innerHTML).toContain('Analytics');
    expect(mockContent.innerHTML).toContain('analytics-period');
    expect(mockContent.innerHTML).toContain('analytics-page');
    expect(mockContent.innerHTML).toContain('Last 24 hours');
    expect(mockContent.innerHTML).toContain('value="1"');
  });

  it('renderAnalytics calls API.get with overview, trending-quotes, and highlights', async () => {
    await mod.renderAnalytics();
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview?days=30');
    expect(global.API.get).toHaveBeenCalledWith('/analytics/trending-quotes');
    expect(global.API.get).toHaveBeenCalledWith('/analytics/highlights?days=30');
  });

  it('changeAnalyticsPeriod updates days and calls API with highlights', async () => {
    // First render to set up the page
    await mod.renderAnalytics();
    global.API.get.mockClear();
    await mod.changeAnalyticsPeriod(7);
    expect(global.API.get).toHaveBeenCalledWith('/analytics/overview?days=7');
    expect(global.API.get).toHaveBeenCalledWith('/analytics/trending-quotes');
    expect(global.API.get).toHaveBeenCalledWith('/analytics/highlights?days=7');
  });

  describe('admin-conditional stat cards', () => {
    it('hides stat cards when not admin', async () => {
      const page = {
        querySelector: vi.fn((sel) => {
          if (sel === '.analytics-loading') return { remove: vi.fn() };
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
        insertAdjacentHTML: vi.fn(),
      };
      global.document.querySelector = vi.fn(() => page);

      await mod.renderAnalyticsData(
        { total_quotes: 100, total_authors: 25, authors: [] },
        null,
        { importance: { quotes: [], authors: [], topics: [] }, truth_falsehood: { truthful: [], misleading: [], false: [] } }
      );

      expect(page.insertAdjacentHTML).toHaveBeenCalled();
      const html = page.insertAdjacentHTML.mock.calls[0][1];
      expect(html).not.toContain('analytics-stats');
    });

    it('shows stat cards when admin', async () => {
      // Re-initialize with isAdmin = true
      global.isAdmin = true;
      const mod2 = {};
      const combined2 = analyticsJsSrc +
        '\nmod2.renderAnalyticsData = renderAnalyticsData;';
      const fn2 = new Function('mod2', 'document', 'API', 'escapeHtml', 'escapeAttr', 'navigate', 'console', 'isAdmin', combined2);
      fn2(mod2, global.document, global.API, global.escapeHtml, global.escapeAttr, global.navigate, global.console, true);

      const page = {
        querySelector: vi.fn((sel) => {
          if (sel === '.analytics-loading') return { remove: vi.fn() };
          return null;
        }),
        querySelectorAll: vi.fn(() => []),
        insertAdjacentHTML: vi.fn(),
      };
      global.document.querySelector = vi.fn(() => page);

      await mod2.renderAnalyticsData(
        { total_quotes: 100, total_authors: 25, authors: [] },
        null,
        { importance: { quotes: [], authors: [], topics: [] }, truth_falsehood: { truthful: [], misleading: [], false: [] } }
      );

      expect(page.insertAdjacentHTML).toHaveBeenCalled();
      const html = page.insertAdjacentHTML.mock.calls[0][1];
      expect(html).toContain('analytics-stats');
      expect(html).toContain('100');
    });
  });

  describe('Highest Importance section', () => {
    it('renders importance section with data', () => {
      const html = mod.renderHighestImportanceHtml({
        importance: {
          quotes: [{ id: 1, text: 'Test quote', context: 'ctx', importants_count: 10, person_id: 1, person_name: 'Author A', photo_url: null, canonical_name: 'Author A', created_at: '2026-01-01T00:00:00Z' }],
          authors: [{ id: 1, canonical_name: 'Author A', photo_url: null, category: 'Politician', total_importants: 15 }],
          topics: [{ id: 1, name: 'Economy', slug: 'economy', total_importants: 15 }],
        },
      });
      expect(html).toContain('HIGHEST IMPORTANCE');
      expect(html).toContain('Top Quotes');
      expect(html).toContain('Top Authors');
      expect(html).toContain('Top Topics');
      expect(html).toContain('Author A');
      expect(html).toContain('Economy');
    });

    it('returns empty string when no data', () => {
      const html = mod.renderHighestImportanceHtml({
        importance: { quotes: [], authors: [], topics: [] },
      });
      expect(html).toBe('');
    });
  });

  describe('Truth and Falsehood section', () => {
    it('renders truth/falsehood section with data', () => {
      const html = mod.renderTruthFalsehoodHtml({
        truth_falsehood: {
          truthful: [{ id: 1, canonical_name: 'Truth Author', photo_url: null, category: 'Politician', verdict_count: 5 }],
          misleading: [{ id: 2, canonical_name: 'Mislead Author', photo_url: null, category: 'Business', verdict_count: 3 }],
          false: [{ id: 3, canonical_name: 'False Author', photo_url: null, category: 'Journalist', verdict_count: 2 }],
        },
      });
      expect(html).toContain('HIGHEST TRUTH AND FALSEHOOD');
      expect(html).toContain('Most Truthful');
      expect(html).toContain('Most Misleading');
      expect(html).toContain('Most False');
      expect(html).toContain('Truth Author');
      expect(html).toContain('Mislead Author');
      expect(html).toContain('False Author');
    });

    it('returns empty string when no data', () => {
      const html = mod.renderTruthFalsehoodHtml({
        truth_falsehood: { truthful: [], misleading: [], false: [] },
      });
      expect(html).toBe('');
    });

    it('shows empty message for columns without data', () => {
      const html = mod.renderTruthFalsehoodHtml({
        truth_falsehood: {
          truthful: [{ id: 1, canonical_name: 'Author', photo_url: null, category: 'Pol', verdict_count: 1 }],
          misleading: [],
          false: [],
        },
      });
      expect(html).toContain('Most Truthful');
      expect(html).toContain('No data for this period');
    });
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
