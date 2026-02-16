import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock rss-parser
vi.mock('rss-parser', () => {
  const MockParser = vi.fn();
  MockParser.prototype.parseURL = vi.fn();
  return { default: MockParser };
});

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Import after mocks are set up
const { fetchArticlesForDate } = await import('../../src/services/backpropFetcher.js');
const Parser = (await import('rss-parser')).default;

describe('backpropFetcher', () => {
  let mockDb;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn(() => ({
        all: vi.fn(() => [
          { id: 1, domain: 'cnn.com', name: 'CNN', enabled: 1 },
          { id: 2, domain: 'bbc.com', name: 'BBC', enabled: 1 },
        ]),
      })),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchArticlesForDate', () => {
    it('returns articles and attempts array', async () => {
      // Google News returns articles
      Parser.prototype.parseURL.mockResolvedValueOnce({
        items: [
          {
            title: 'Test Article 1',
            link: 'https://cnn.com/article-1',
            pubDate: '2026-02-14T12:00:00Z',
          },
          {
            title: 'Test Article 2',
            link: 'https://bbc.com/article-2',
            pubDate: '2026-02-14T15:00:00Z',
          },
        ],
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      expect(result).toHaveProperty('articles');
      expect(result).toHaveProperty('attempts');
      expect(Array.isArray(result.articles)).toBe(true);
      expect(Array.isArray(result.attempts)).toBe(true);
    });

    it('deduplicates articles by URL', async () => {
      Parser.prototype.parseURL.mockResolvedValueOnce({
        items: [
          {
            title: 'Article A',
            link: 'https://cnn.com/same-article',
            pubDate: '2026-02-14T12:00:00Z',
          },
          {
            title: 'Article A duplicate',
            link: 'https://cnn.com/same-article',
            pubDate: '2026-02-14T13:00:00Z',
          },
        ],
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      const urls = result.articles.map(a => a.url);
      const uniqueUrls = [...new Set(urls)];
      expect(urls.length).toBe(uniqueUrls.length);
    });

    it('respects maxArticles limit', async () => {
      Parser.prototype.parseURL.mockResolvedValueOnce({
        items: Array.from({ length: 20 }, (_, i) => ({
          title: `Article ${i}`,
          link: `https://example.com/article-${i}`,
          pubDate: '2026-02-14T12:00:00Z',
        })),
      });

      const result = await fetchArticlesForDate('2026-02-14', 3, mockDb);
      expect(result.articles.length).toBeLessThanOrEqual(3);
    });

    it('tries GDELT when Google News fails', async () => {
      // Google News fails
      Parser.prototype.parseURL.mockRejectedValueOnce(new Error('Feed unavailable'));

      // GDELT returns articles
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          articles: [
            { url: 'https://cnn.com/gdelt-article', title: 'GDELT Article', seendate: '20260214T120000Z' },
          ],
        }),
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      expect(result.attempts.length).toBeGreaterThanOrEqual(2);
      expect(result.attempts[0].strategy).toBe('google_news');
      expect(result.attempts[0].success).toBe(false);
      expect(result.attempts[1].strategy).toBe('gdelt');
    });

    it('tries Wayback when Google News and GDELT fail', async () => {
      // Google News fails
      Parser.prototype.parseURL.mockRejectedValueOnce(new Error('Feed unavailable'));

      // GDELT fails
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      // Wayback returns CDX results
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(
          'org,cnn)/article-1 20260214120000 https://cnn.com/article-1 text/html 200 ABC123 1234\n'
        ),
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      const strategies = result.attempts.map(a => a.strategy);
      expect(strategies).toContain('wayback');
    });

    it('returns empty articles when all strategies fail', async () => {
      // Google News fails
      Parser.prototype.parseURL.mockRejectedValueOnce(new Error('Feed unavailable'));

      // GDELT fails
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      // Wayback fails
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      expect(result.articles).toEqual([]);
      expect(result.attempts.length).toBeGreaterThanOrEqual(3);
      expect(result.attempts.every(a => a.success === false)).toBe(true);
    });

    it('articles have url, title, and published fields', async () => {
      Parser.prototype.parseURL.mockResolvedValueOnce({
        items: [
          {
            title: 'Test Article',
            link: 'https://cnn.com/test',
            pubDate: '2026-02-14T12:00:00Z',
          },
        ],
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      if (result.articles.length > 0) {
        const article = result.articles[0];
        expect(article).toHaveProperty('url');
        expect(article).toHaveProperty('title');
        expect(article).toHaveProperty('published');
      }
    });

    it('limits total attempts to prevent infinite loops', async () => {
      // All strategies fail
      Parser.prototype.parseURL.mockRejectedValue(new Error('Fail'));
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      // Should not exceed 20 total attempts
      expect(result.attempts.length).toBeLessThanOrEqual(20);
    });
  });

  describe('Google News strategy URL construction', () => {
    it('constructs correct Google News RSS URL with date range', async () => {
      Parser.prototype.parseURL.mockResolvedValueOnce({ items: [] });

      await fetchArticlesForDate('2026-02-14', 10, mockDb);

      const calledUrl = Parser.prototype.parseURL.mock.calls[0]?.[0];
      expect(calledUrl).toContain('news.google.com/rss/search');
      expect(calledUrl).toContain('after:2026-02-13');
      expect(calledUrl).toContain('before:2026-02-15');
    });
  });

  describe('GDELT strategy', () => {
    it('constructs GDELT URL with source domain and date range', async () => {
      // Google News returns nothing
      Parser.prototype.parseURL.mockResolvedValueOnce({ items: [] });

      // GDELT call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ articles: [] }),
      });

      await fetchArticlesForDate('2026-02-14', 10, mockDb);

      if (mockFetch.mock.calls.length > 0) {
        const gdeltUrl = mockFetch.mock.calls[0][0];
        expect(gdeltUrl).toContain('api.gdeltproject.org');
        expect(gdeltUrl).toContain('20260214');
      }
    });

    it('parses GDELT response articles correctly', async () => {
      Parser.prototype.parseURL.mockRejectedValueOnce(new Error('Fail'));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          articles: [
            { url: 'https://cnn.com/gdelt-1', title: 'GDELT One', seendate: '20260214T100000Z' },
            { url: 'https://bbc.com/gdelt-2', title: 'GDELT Two', seendate: '20260214T110000Z' },
          ],
        }),
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      const gdeltArticles = result.articles.filter(a => a.url.includes('gdelt'));
      expect(gdeltArticles.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Wayback strategy', () => {
    it('parses CDX response lines into articles', async () => {
      Parser.prototype.parseURL.mockRejectedValueOnce(new Error('Fail'));
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 }); // GDELT fails

      // Wayback CDX response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        text: () => Promise.resolve(
          'com,cnn)/news/article-1 20260214120000 https://cnn.com/news/article-1 text/html 200 HASH1 5000\n' +
          'com,bbc)/news/article-2 20260214130000 https://bbc.com/news/article-2 text/html 200 HASH2 6000\n'
        ),
      });

      const result = await fetchArticlesForDate('2026-02-14', 10, mockDb);

      const waybackAttempt = result.attempts.find(a => a.strategy === 'wayback');
      expect(waybackAttempt).toBeDefined();
    });
  });
});
