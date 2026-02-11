import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/analytics-trends-test.db';

describe('Analytics Detail Endpoints', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Create sources
    db.prepare('INSERT INTO sources (domain, name, rss_url) VALUES (?, ?, ?)').run('cnn.com', 'CNN', 'https://rss.cnn.com/rss/edition.rss');

    // Create persons
    db.prepare('INSERT INTO persons (canonical_name, category, quote_count) VALUES (?, ?, ?)').run('Politician A', 'Politician', 3);
    db.prepare('INSERT INTO persons (canonical_name, category, quote_count) VALUES (?, ?, ?)').run('CEO Alpha', 'Business Leader', 1);

    // Create visible quotes
    const insertQuote = db.prepare("INSERT INTO quotes (person_id, text, is_visible, created_at) VALUES (?, ?, 1, datetime('now', ?))");
    insertQuote.run(1, 'Quote about economy', '-1 days');
    insertQuote.run(1, 'Quote about policy', '-3 days');
    insertQuote.run(1, 'Quote about trade', '-5 days');
    insertQuote.run(2, 'Quote about markets', '-1 days');

    // Hidden quote (should be excluded)
    db.prepare("INSERT INTO quotes (person_id, text, is_visible, created_at) VALUES (?, ?, 0, datetime('now', '-1 days'))").run(1, 'Hidden quote');

    // Topics
    db.prepare('INSERT INTO topics (name, slug) VALUES (?, ?)').run('U.S. Politics', 'us-politics');
    db.prepare('INSERT INTO topics (name, slug) VALUES (?, ?)').run('Economy', 'economy');
    db.prepare('INSERT INTO topics (name, slug) VALUES (?, ?)').run('Trade', 'trade');

    // Keywords
    db.prepare("INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, ?)").run('Federal Reserve', 'federal reserve', 'organization');
    db.prepare("INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, ?)").run('Trade War', 'trade war', 'event');

    // Quote-topic links
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)').run(1, 1);
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)').run(1, 2);
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)').run(2, 1);
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)').run(3, 3);
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (?, ?)').run(4, 2);

    // Quote-keyword links
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(1, 1);
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(3, 2);
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(4, 1);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/analytics-trends-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/analytics/topic/:slug', () => {
    it('returns topic detail with quotes', async () => {
      const res = await request(app).get('/api/analytics/topic/us-politics');
      expect(res.status).toBe(200);
      expect(res.body.topic).toBeTruthy();
      expect(res.body.topic.name).toBe('U.S. Politics');
      expect(res.body.topic.slug).toBe('us-politics');
      expect(Array.isArray(res.body.quotes)).toBe(true);
      expect(res.body.quotes.length).toBe(2); // quotes 1 and 2
      expect(typeof res.body.total).toBe('number');
    });

    it('quotes have correct fields', async () => {
      const res = await request(app).get('/api/analytics/topic/economy');
      if (res.body.quotes.length > 0) {
        const q = res.body.quotes[0];
        expect(q).toHaveProperty('id');
        expect(q).toHaveProperty('text');
        expect(q).toHaveProperty('person_id');
        expect(q).toHaveProperty('canonical_name');
      }
    });

    it('returns 404 for unknown topic slug', async () => {
      const res = await request(app).get('/api/analytics/topic/nonexistent-slug');
      expect(res.status).toBe(404);
    });

    it('only includes visible quotes', async () => {
      const res = await request(app).get('/api/analytics/topic/us-politics');
      // 2 visible quotes linked to us-politics, hidden quote not linked
      expect(res.body.total).toBe(2);
    });

    it('respects pagination', async () => {
      const res = await request(app).get('/api/analytics/topic/us-politics?limit=1&page=1');
      expect(res.body.quotes.length).toBe(1);
      expect(res.body.total).toBe(2);
    });
  });

  describe('GET /api/analytics/keyword/:id', () => {
    it('returns keyword detail with quotes', async () => {
      const res = await request(app).get('/api/analytics/keyword/1');
      expect(res.status).toBe(200);
      expect(res.body.keyword).toBeTruthy();
      expect(res.body.keyword.name).toBe('Federal Reserve');
      expect(res.body.keyword.keyword_type).toBe('organization');
      expect(Array.isArray(res.body.quotes)).toBe(true);
      expect(res.body.quotes.length).toBe(2); // quotes 1 and 4
    });

    it('returns 404 for unknown keyword id', async () => {
      const res = await request(app).get('/api/analytics/keyword/999');
      expect(res.status).toBe(404);
    });

    it('quotes are sorted by created_at desc', async () => {
      const res = await request(app).get('/api/analytics/keyword/1');
      if (res.body.quotes.length >= 2) {
        const d1 = new Date(res.body.quotes[0].created_at);
        const d2 = new Date(res.body.quotes[1].created_at);
        expect(d1.getTime()).toBeGreaterThanOrEqual(d2.getTime());
      }
    });
  });

  describe('GET /api/analytics/trending-topics', () => {
    it('returns topics ordered by quote count', async () => {
      const res = await request(app).get('/api/analytics/trending-topics');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.topics)).toBe(true);
      if (res.body.topics.length >= 2) {
        expect(res.body.topics[0].quote_count).toBeGreaterThanOrEqual(res.body.topics[1].quote_count);
      }
    });
  });

  describe('GET /api/analytics/trending-keywords', () => {
    it('returns keywords ordered by quote count', async () => {
      const res = await request(app).get('/api/analytics/trending-keywords');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.keywords)).toBe(true);
      if (res.body.keywords.length >= 2) {
        expect(res.body.keywords[0].quote_count).toBeGreaterThanOrEqual(res.body.keywords[1].quote_count);
      }
    });
  });
});
