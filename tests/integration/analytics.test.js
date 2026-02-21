import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/analytics-test.db';

describe('Analytics API', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Create persons
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category) VALUES (?, ?, ?)').run('Author One', 'https://example.com/1.jpg', 'Politician');
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category) VALUES (?, ?, ?)').run('Author Two', null, 'Business Leader');
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category) VALUES (?, ?, ?)').run('Author Three', null, 'Journalist');

    // Create visible quotes (today) with importants_count and fact_check_verdict
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count, fact_check_verdict) VALUES (?, ?, ?, 1, datetime('now'), 10, 'TRUE')").run(1, 'The economy is growing', 'economy growth');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count, fact_check_verdict) VALUES (?, ?, ?, 1, datetime('now'), 5, 'MOSTLY_TRUE')").run(1, 'Immigration reform is needed', 'immigration reform');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count, fact_check_verdict) VALUES (?, ?, ?, 1, datetime('now'), 3, 'MISLEADING')").run(2, 'Markets are bullish', 'stock market');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count, fact_check_verdict) VALUES (?, ?, ?, 1, datetime('now'), 2, 'FALSE')").run(3, 'Climate data is fabricated', 'climate');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count, fact_check_verdict) VALUES (?, ?, ?, 1, datetime('now'), 1, 'MOSTLY_FALSE')").run(3, 'Vaccines cause illness', 'health');

    // Hidden quote with high importants (should be excluded)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count) VALUES (?, ?, ?, 0, datetime('now'), 100)").run(1, 'Hidden quote', 'hidden');

    // Older quote
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at, importants_count) VALUES (?, ?, ?, 1, datetime('now', '-7 days'), 1)").run(2, 'Old quote text', 'old topic');

    // Create a topic and link quotes
    db.prepare("INSERT INTO topics (name, slug, status) VALUES (?, ?, 'active')").run('Economy', 'economy');
    db.prepare("INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)").run(1, 1);
    db.prepare("INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)").run(2, 1);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/analytics-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/analytics/overview', () => {
    it('returns all expected fields', async () => {
      const res = await request(app).get('/api/analytics/overview');
      expect(res.status).toBe(200);
      expect(typeof res.body.total_quotes).toBe('number');
      expect(typeof res.body.total_authors).toBe('number');
      expect(typeof res.body.period_days).toBe('number');
      expect(Array.isArray(res.body.authors)).toBe(true);
    });

    it('only counts visible quotes', async () => {
      const res = await request(app).get('/api/analytics/overview?days=30');
      // 6 visible quotes (5 today + 1 from 7 days ago), hidden excluded
      expect(res.body.total_quotes).toBe(6);
    });

    it('returns top authors with quote counts', async () => {
      const res = await request(app).get('/api/analytics/overview');
      expect(res.body.authors.length).toBeGreaterThan(0);
      expect(res.body.authors[0]).toHaveProperty('canonical_name');
      expect(res.body.authors[0]).toHaveProperty('quote_count');
    });

    it('respects days parameter', async () => {
      const res = await request(app).get('/api/analytics/overview?days=1');
      // Only today's 5 visible quotes
      expect(res.body.total_quotes).toBe(5);
      expect(res.body.period_days).toBe(1);
    });
  });

  describe('GET /api/analytics/highlights', () => {
    it('returns correct response shape', async () => {
      const res = await request(app).get('/api/analytics/highlights');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('period_days');
      expect(res.body).toHaveProperty('importance');
      expect(res.body).toHaveProperty('truth_falsehood');
      expect(res.body.importance).toHaveProperty('quotes');
      expect(res.body.importance).toHaveProperty('authors');
      expect(res.body.importance).toHaveProperty('topics');
      expect(res.body.truth_falsehood).toHaveProperty('truthful');
      expect(res.body.truth_falsehood).toHaveProperty('misleading');
      expect(res.body.truth_falsehood).toHaveProperty('false');
    });

    it('returns top quotes by importants_count', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      expect(res.body.importance.quotes.length).toBeGreaterThan(0);
      // First quote should have highest importants_count (10)
      expect(res.body.importance.quotes[0].importants_count).toBe(10);
      expect(res.body.importance.quotes[0]).toHaveProperty('person_name');
    });

    it('returns top authors by total importants', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      expect(res.body.importance.authors.length).toBeGreaterThan(0);
      // Author One has 10+5=15 total importants
      expect(res.body.importance.authors[0].canonical_name).toBe('Author One');
      expect(res.body.importance.authors[0].total_importants).toBe(15);
    });

    it('returns top topics by importants', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      expect(res.body.importance.topics.length).toBe(1);
      expect(res.body.importance.topics[0].name).toBe('Economy');
      expect(res.body.importance.topics[0].total_importants).toBe(15);
    });

    it('returns truthful authors', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      expect(res.body.truth_falsehood.truthful.length).toBeGreaterThan(0);
      // Author One has 2 TRUE/MOSTLY_TRUE quotes
      expect(res.body.truth_falsehood.truthful[0].canonical_name).toBe('Author One');
      expect(res.body.truth_falsehood.truthful[0].verdict_count).toBe(2);
    });

    it('returns misleading authors', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      expect(res.body.truth_falsehood.misleading.length).toBe(1);
      expect(res.body.truth_falsehood.misleading[0].canonical_name).toBe('Author Two');
    });

    it('returns false authors', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      expect(res.body.truth_falsehood.false.length).toBe(1);
      expect(res.body.truth_falsehood.false[0].canonical_name).toBe('Author Three');
      expect(res.body.truth_falsehood.false[0].verdict_count).toBe(2);
    });

    it('respects days parameter', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=1');
      expect(res.body.period_days).toBe(1);
      // Old quote (7 days ago) should not appear
      const allQuoteTexts = res.body.importance.quotes.map(q => q.text);
      expect(allQuoteTexts).not.toContain('Old quote text');
    });

    it('excludes hidden quotes from importance', async () => {
      const res = await request(app).get('/api/analytics/highlights?days=30');
      // Hidden quote has 100 importants but should not appear
      const maxImportants = res.body.importance.quotes[0]?.importants_count || 0;
      expect(maxImportants).toBeLessThan(100);
    });
  });

  describe('GET /api/analytics/trends/author/:id', () => {
    it('returns timeline for period=month (default)', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('author');
      expect(res.body.author.name).toBe('Author One');
      expect(Array.isArray(res.body.timeline)).toBe(true);
      expect(res.body.timeline.length).toBeGreaterThan(0);
    });

    it('supports period=week', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1?period=week');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.timeline)).toBe(true);
      // Buckets should be date format (YYYY-MM-DD) for week period
      if (res.body.timeline.length > 0) {
        expect(res.body.timeline[0].bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    });

    it('supports period=year with weekly buckets', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1?period=year');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.timeline)).toBe(true);
      // Buckets should be YYYY-WW format for year period
      if (res.body.timeline.length > 0) {
        expect(res.body.timeline[0].bucket).toMatch(/^\d{4}-\d{2}$/);
      }
    });

    it('returns verdicts array with count and percentage', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.verdicts)).toBe(true);
      expect(res.body.verdicts.length).toBeGreaterThan(0);
      for (const v of res.body.verdicts) {
        expect(v).toHaveProperty('verdict');
        expect(v).toHaveProperty('count');
        expect(v).toHaveProperty('percentage');
        expect(typeof v.count).toBe('number');
        expect(typeof v.percentage).toBe('number');
      }
    });

    it('verdict percentages sum to approximately 100', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1');
      const total = res.body.verdicts.reduce((sum, v) => sum + v.percentage, 0);
      // Allow rounding tolerance
      expect(total).toBeGreaterThanOrEqual(98);
      expect(total).toBeLessThanOrEqual(102);
    });

    it('returns comparison data with compareWith param', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1?compareWith=2');
      expect(res.status).toBe(200);
      expect(res.body.comparison).not.toBeNull();
      expect(res.body.comparison.author.name).toBe('Author Two');
      expect(Array.isArray(res.body.comparison.timeline)).toBe(true);
    });

    it('returns comparison as null for invalid compareWith', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1?compareWith=99999');
      expect(res.status).toBe(200);
      expect(res.body.comparison).toBeNull();
    });

    it('returns 404 for unknown author', async () => {
      const res = await request(app).get('/api/analytics/trends/author/99999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Author not found');
    });

    it('returns topics array for author with linked topics', async () => {
      const res = await request(app).get('/api/analytics/trends/author/1');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.topics)).toBe(true);
      expect(res.body.topics.length).toBeGreaterThan(0);
      expect(res.body.topics[0]).toHaveProperty('keyword');
      expect(res.body.topics[0]).toHaveProperty('count');
    });
  });

});
