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

    // Create visible quotes (today)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'The economy is growing', 'economy growth');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'Immigration reform is needed', 'immigration reform');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(2, 'Markets are bullish', 'stock market');

    // Hidden quote (should be excluded)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 0, datetime('now'))").run(1, 'Hidden quote', 'hidden');

    // Older quote
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now', '-7 days'))").run(2, 'Old quote text', 'old topic');
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
      // 4 visible quotes (3 today + 1 from 7 days ago), hidden excluded
      expect(res.body.total_quotes).toBe(4);
    });

    it('returns top authors with quote counts', async () => {
      const res = await request(app).get('/api/analytics/overview');
      expect(res.body.authors.length).toBeGreaterThan(0);
      expect(res.body.authors[0]).toHaveProperty('canonical_name');
      expect(res.body.authors[0]).toHaveProperty('quote_count');
    });

    it('respects days parameter', async () => {
      const res = await request(app).get('/api/analytics/overview?days=1');
      // Only today's 3 visible quotes
      expect(res.body.total_quotes).toBe(3);
      expect(res.body.period_days).toBe(1);
    });
  });

});
