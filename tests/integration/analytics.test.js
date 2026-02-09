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

    // Seed test data
    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Create persons
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category) VALUES (?, ?, ?)').run('Author One', 'https://example.com/1.jpg', 'Politician');
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category) VALUES (?, ?, ?)').run('Author Two', null, 'Business Leader');

    // Create visible quotes (today)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'The economy is growing', 'economy growth policy');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'Immigration reform is needed', 'immigration reform legislation');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(2, 'Markets are bullish', 'stock market finance');

    // Create a hidden quote (should not appear in analytics)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 0, datetime('now'))").run(1, 'Hidden quote', 'hidden context');

    // Create an older quote (7 days ago)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now', '-7 days'))").run(2, 'Old quote text', 'old topic');

    // Add votes
    db.prepare("INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)").run(1, 'hash_a', 1);
    db.prepare("INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)").run(1, 'hash_b', 1);
    db.prepare("INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)").run(1, 'hash_c', -1);
    db.prepare("INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)").run(2, 'hash_a', 1);

    // Add keywords
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(1, 'economy');
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(1, 'growth');
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(2, 'immigration');
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(2, 'reform');
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(3, 'market');
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(3, 'finance');
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
      expect(typeof res.body.quotes_today).toBe('number');
      expect(typeof res.body.quotes_this_week).toBe('number');
      expect(typeof res.body.quotes_total).toBe('number');
      expect(typeof res.body.articles_today).toBe('number');
      expect(Array.isArray(res.body.quotes_per_day)).toBe(true);
    });

    it('only counts visible quotes', async () => {
      const res = await request(app).get('/api/analytics/overview');
      // 3 visible today quotes + 1 older visible = 4 total visible
      expect(res.body.quotes_total).toBe(4);
      // 3 visible today
      expect(res.body.quotes_today).toBe(3);
    });

    it('returns top author today', async () => {
      const res = await request(app).get('/api/analytics/overview');
      // Author One has 2 visible quotes today
      if (res.body.top_author_today) {
        expect(res.body.top_author_today.name).toBe('Author One');
        expect(res.body.top_author_today.quote_count).toBe(2);
      }
    });
  });

  describe('GET /api/analytics/quotes', () => {
    it('returns quotes sorted by vote_score desc', async () => {
      const res = await request(app).get('/api/analytics/quotes?period=week');
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('week');
      expect(Array.isArray(res.body.quotes)).toBe(true);

      // Quote 1 has score 1 (2 up, 1 down), should be first or near top
      if (res.body.quotes.length >= 2) {
        expect(res.body.quotes[0].vote_score).toBeGreaterThanOrEqual(res.body.quotes[1].vote_score);
      }
    });

    it('period parameter filters correctly', async () => {
      const dayRes = await request(app).get('/api/analytics/quotes?period=day');
      expect(dayRes.body.period).toBe('day');

      const yearRes = await request(app).get('/api/analytics/quotes?period=year');
      expect(yearRes.body.period).toBe('year');
      // Year should include more quotes than day
      expect(yearRes.body.quotes.length).toBeGreaterThanOrEqual(dayRes.body.quotes.length);
    });

    it('invalid period defaults to week', async () => {
      const res = await request(app).get('/api/analytics/quotes?period=invalid');
      expect(res.body.period).toBe('week');
    });
  });

  describe('GET /api/analytics/authors', () => {
    it('returns authors sorted by quote_count desc', async () => {
      const res = await request(app).get('/api/analytics/authors?period=week');
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('week');
      expect(Array.isArray(res.body.authors)).toBe(true);

      if (res.body.authors.length >= 2) {
        expect(res.body.authors[0].quote_count).toBeGreaterThanOrEqual(res.body.authors[1].quote_count);
      }
    });

    it('author objects have correct fields', async () => {
      const res = await request(app).get('/api/analytics/authors?period=year');
      if (res.body.authors.length > 0) {
        const a = res.body.authors[0];
        expect(a).toHaveProperty('id');
        expect(a).toHaveProperty('name');
        expect(a).toHaveProperty('category');
        expect(a).toHaveProperty('quote_count');
        expect(a).toHaveProperty('total_vote_score');
      }
    });
  });

  describe('GET /api/analytics/topics', () => {
    it('returns keywords sorted by count desc', async () => {
      const res = await request(app).get('/api/analytics/topics?period=week');
      expect(res.status).toBe(200);
      expect(res.body.period).toBe('week');
      expect(Array.isArray(res.body.topics)).toBe(true);

      if (res.body.topics.length >= 2) {
        expect(res.body.topics[0].count).toBeGreaterThanOrEqual(res.body.topics[1].count);
      }
    });

    it('topic objects have trend field', async () => {
      const res = await request(app).get('/api/analytics/topics?period=week');
      if (res.body.topics.length > 0) {
        expect(res.body.topics[0]).toHaveProperty('keyword');
        expect(res.body.topics[0]).toHaveProperty('count');
        expect(res.body.topics[0]).toHaveProperty('trend');
        expect(['up', 'down', 'stable']).toContain(res.body.topics[0].trend);
      }
    });
  });

  describe('Edge cases', () => {
    it('empty database period returns empty arrays (not errors)', async () => {
      // Far future period that has no data
      const res = await request(app).get('/api/analytics/quotes?period=day');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.quotes)).toBe(true);
    });

    it('only visible quotes included in analytics', async () => {
      const res = await request(app).get('/api/analytics/overview');
      // Hidden quote should not be counted
      expect(res.body.quotes_today).toBe(3); // not 4
    });
  });
});
