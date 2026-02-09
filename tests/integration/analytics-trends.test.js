import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/analytics-trends-test.db';

describe('Analytics Trends API', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Create sources
    db.prepare('INSERT INTO sources (domain, name, rss_url) VALUES (?, ?, ?)').run('cnn.com', 'CNN', 'https://rss.cnn.com/rss/edition.rss');
    db.prepare('INSERT INTO sources (domain, name, rss_url) VALUES (?, ?, ?)').run('bbc.com', 'BBC', 'https://feeds.bbci.co.uk/news/rss.xml');

    // Create articles
    db.prepare("INSERT INTO articles (url, source_id, title, status, created_at) VALUES (?, ?, ?, 'completed', datetime('now', '-2 days'))").run('https://cnn.com/article1', 1, 'Economy Article', );
    db.prepare("INSERT INTO articles (url, source_id, title, status, created_at) VALUES (?, ?, ?, 'completed', datetime('now', '-5 days'))").run('https://bbc.com/article2', 2, 'Politics Article');

    // Create persons (quote_count set to match seeded quotes below)
    db.prepare('INSERT INTO persons (canonical_name, category, quote_count) VALUES (?, ?, ?)').run('Politician A', 'Politician', 4);
    db.prepare('INSERT INTO persons (canonical_name, category, quote_count) VALUES (?, ?, ?)').run('Politician B', 'Politician', 2);
    db.prepare('INSERT INTO persons (canonical_name, category, quote_count) VALUES (?, ?, ?)').run('CEO Alpha', 'Business Leader', 2);

    // Create quotes spanning 14 days
    const insertQuote = db.prepare("INSERT INTO quotes (person_id, text, is_visible, created_at) VALUES (?, ?, 1, datetime('now', ?))");
    // Politician A: quotes at day -1, -3, -5, -10
    insertQuote.run(1, 'Quote A1', '-1 days');
    insertQuote.run(1, 'Quote A2', '-3 days');
    insertQuote.run(1, 'Quote A3', '-5 days');
    insertQuote.run(1, 'Quote A4', '-10 days');
    // Politician B: quotes at day -2, -4
    insertQuote.run(2, 'Quote B1', '-2 days');
    insertQuote.run(2, 'Quote B2', '-4 days');
    // CEO Alpha: quotes at day -1, -6
    insertQuote.run(3, 'Quote C1', '-1 days');
    insertQuote.run(3, 'Quote C2', '-6 days');
    // Hidden quote (should not appear)
    db.prepare("INSERT INTO quotes (person_id, text, is_visible, created_at) VALUES (?, ?, 0, datetime('now', '-1 days'))").run(1, 'Hidden quote');

    // Link quotes to articles
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(1, 1); // A1 -> CNN
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(2, 1); // A2 -> CNN
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(3, 2); // A3 -> BBC
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(5, 2); // B1 -> BBC
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(7, 1); // C1 -> CNN

    // Keywords
    const insertKw = db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)');
    insertKw.run(1, 'economy');
    insertKw.run(1, 'growth');
    insertKw.run(2, 'economy');
    insertKw.run(3, 'policy');
    insertKw.run(5, 'election');
    insertKw.run(5, 'policy');
    insertKw.run(7, 'markets');
    insertKw.run(8, 'markets');
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/analytics-trends-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/analytics/trends/quotes', () => {
    it('returns bucketed quote counts', async () => {
      const res = await request(app).get('/api/analytics/trends/quotes?period=month');
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('month');
      expect(res.body.granularity).toBe('day');
      expect(Array.isArray(res.body.buckets)).toBe(true);
      expect(res.body.buckets.length).toBeGreaterThan(0);
      // Each bucket has bucket and count
      expect(res.body.buckets[0]).toHaveProperty('bucket');
      expect(res.body.buckets[0]).toHaveProperty('count');
    });

    it('excludes hidden quotes', async () => {
      const res = await request(app).get('/api/analytics/trends/quotes?period=month');
      const totalCount = res.body.buckets.reduce((sum, b) => sum + b.count, 0);
      // 8 visible quotes, hidden excluded
      expect(totalCount).toBe(8);
    });

    it('uses hourly granularity for day period', async () => {
      const res = await request(app).get('/api/analytics/trends/quotes?period=day');
      expect(res.body.granularity).toBe('hour');
    });

    it('defaults invalid period to week', async () => {
      const res = await request(app).get('/api/analytics/trends/quotes?period=invalid');
      expect(res.body.period).toBe('week');
    });
  });

  describe('GET /api/analytics/trends/topics', () => {
    it('returns series of top keywords over time', async () => {
      const res = await request(app).get('/api/analytics/trends/topics?period=month&limit=3');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.series)).toBe(true);
      expect(res.body.series.length).toBeLessThanOrEqual(3);
      if (res.body.series.length > 0) {
        expect(res.body.series[0]).toHaveProperty('keyword');
        expect(Array.isArray(res.body.series[0].buckets)).toBe(true);
      }
    });

    it('limits series to requested count', async () => {
      const res = await request(app).get('/api/analytics/trends/topics?period=month&limit=2');
      expect(res.body.series.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /api/analytics/trends/sources', () => {
    it('returns series of top sources over time', async () => {
      const res = await request(app).get('/api/analytics/trends/sources?period=month&limit=5');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.series)).toBe(true);
      if (res.body.series.length > 0) {
        expect(res.body.series[0]).toHaveProperty('source_id');
        expect(res.body.series[0]).toHaveProperty('name');
        expect(Array.isArray(res.body.series[0].buckets)).toBe(true);
      }
    });
  });

  describe('GET /api/analytics/trends/author/:id', () => {
    it('returns author timeline and topics', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1?period=month');
      expect(res.status).toBe(200);
      expect(res.body.author).toBeTruthy();
      expect(res.body.author.name).toBe('Politician A');
      expect(Array.isArray(res.body.timeline)).toBe(true);
      expect(Array.isArray(res.body.topics)).toBe(true);
    });

    it('includes peer comparison for same category', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1?period=month');
      // Politician B is in same category
      expect(Array.isArray(res.body.peers)).toBe(true);
      if (res.body.peers.length > 0) {
        expect(res.body.peers[0]).toHaveProperty('name');
        expect(Array.isArray(res.body.peers[0].buckets)).toBe(true);
      }
    });

    it('returns 400 for invalid author ID', async () => {
      const res = await request(app).get('/api/analytics/trends/author/abc');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/analytics/trends/article/:id', () => {
    it('returns per-author counts and topics', async () => {
      const res = await request(app).get('/api/analytics/trends/article/1');
      expect(res.status).toBe(200);
      expect(res.body.article_id).toBe(1);
      expect(Array.isArray(res.body.authors)).toBe(true);
      expect(Array.isArray(res.body.topics)).toBe(true);
    });

    it('author objects have correct fields', async () => {
      const res = await request(app).get('/api/analytics/trends/article/1');
      if (res.body.authors.length > 0) {
        expect(res.body.authors[0]).toHaveProperty('id');
        expect(res.body.authors[0]).toHaveProperty('name');
        expect(res.body.authors[0]).toHaveProperty('quote_count');
      }
    });

    it('returns 400 for invalid article ID', async () => {
      const res = await request(app).get('/api/analytics/trends/article/abc');
      expect(res.status).toBe(400);
    });
  });

  // --- Dashboard Endpoints ---

  describe('GET /api/analytics/categories', () => {
    it('returns category breakdown with series', async () => {
      const res = await request(app).get('/api/analytics/categories?period=month');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories.length).toBeGreaterThan(0);
      expect(res.body.categories[0]).toHaveProperty('category');
      expect(res.body.categories[0]).toHaveProperty('quote_count');
      expect(res.body.categories[0]).toHaveProperty('author_count');
      expect(Array.isArray(res.body.series)).toBe(true);
    });
  });

  describe('GET /api/analytics/compare/authors', () => {
    it('returns comparison data for selected authors', async () => {
      const res = await request(app).get('/api/analytics/compare/authors?ids=1,2&period=month');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.authors)).toBe(true);
      expect(res.body.authors.length).toBe(2);
      expect(res.body.authors[0]).toHaveProperty('id');
      expect(res.body.authors[0]).toHaveProperty('name');
      expect(res.body.authors[0]).toHaveProperty('total');
      expect(Array.isArray(res.body.authors[0].buckets)).toBe(true);
    });

    it('returns empty for no IDs', async () => {
      const res = await request(app).get('/api/analytics/compare/authors?period=month');
      expect(res.body.authors).toEqual([]);
    });
  });

  describe('GET /api/analytics/compare/topics', () => {
    it('returns comparison data for selected topics', async () => {
      const res = await request(app).get('/api/analytics/compare/topics?keywords=economy,policy&period=month');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.topics)).toBe(true);
      expect(res.body.topics.length).toBe(2);
      expect(res.body.topics[0]).toHaveProperty('keyword');
      expect(res.body.topics[0]).toHaveProperty('total');
      expect(Array.isArray(res.body.topics[0].buckets)).toBe(true);
    });

    it('returns empty for no keywords', async () => {
      const res = await request(app).get('/api/analytics/compare/topics?period=month');
      expect(res.body.topics).toEqual([]);
    });
  });

  describe('GET /api/analytics/sources/breakdown', () => {
    it('returns source volume data', async () => {
      const res = await request(app).get('/api/analytics/sources/breakdown?period=month');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.sources)).toBe(true);
      if (res.body.sources.length > 0) {
        expect(res.body.sources[0]).toHaveProperty('id');
        expect(res.body.sources[0]).toHaveProperty('name');
        expect(res.body.sources[0]).toHaveProperty('quote_count');
        expect(res.body.sources[0]).toHaveProperty('article_count');
      }
    });
  });

  describe('GET /api/analytics/heatmap', () => {
    it('returns day-of-week x hour cells', async () => {
      const res = await request(app).get('/api/analytics/heatmap?period=month');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.cells)).toBe(true);
      if (res.body.cells.length > 0) {
        expect(res.body.cells[0]).toHaveProperty('day_of_week');
        expect(res.body.cells[0]).toHaveProperty('hour');
        expect(res.body.cells[0]).toHaveProperty('count');
      }
    });
  });

  describe('GET /api/analytics/authors/search', () => {
    it('returns matching authors', async () => {
      const res = await request(app).get('/api/analytics/authors/search?q=Politician');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.authors)).toBe(true);
      expect(res.body.authors.length).toBeGreaterThan(0);
      expect(res.body.authors[0]).toHaveProperty('id');
      expect(res.body.authors[0]).toHaveProperty('name');
    });

    it('returns empty for short query', async () => {
      const res = await request(app).get('/api/analytics/authors/search?q=P');
      expect(res.body.authors).toEqual([]);
    });
  });

  describe('GET /api/analytics/topics/list', () => {
    it('returns keyword list', async () => {
      const res = await request(app).get('/api/analytics/topics/list?period=month');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.topics)).toBe(true);
      expect(res.body.topics.length).toBeGreaterThan(0);
      expect(res.body.topics[0]).toHaveProperty('keyword');
      expect(res.body.topics[0]).toHaveProperty('count');
    });

    it('filters by search query', async () => {
      const res = await request(app).get('/api/analytics/topics/list?period=month&q=econ');
      expect(res.status).toBe(200);
      if (res.body.topics.length > 0) {
        expect(res.body.topics[0].keyword).toContain('econ');
      }
    });
  });
});
