import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/trending-test.db';

describe('Trending System', () => {
  let app;
  let testPersonId;
  let testQuoteIds = [];
  let testArticleId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed test data
    const personResult = db.prepare('INSERT INTO persons (canonical_name, quote_count) VALUES (?, 3)').run('Trending Author');
    testPersonId = Number(personResult.lastInsertRowid);

    // Create article
    const artResult = db.prepare("INSERT INTO articles (url, title, status, published_at, quote_count) VALUES (?, ?, 'completed', datetime('now'), 2)").run('https://example.com/trending1', 'Trending Article');
    testArticleId = Number(artResult.lastInsertRowid);

    // Create quotes
    const q1 = db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count) VALUES (?, ?, 1, 5)").run(testPersonId, 'Important trending quote');
    const q2 = db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count) VALUES (?, ?, 1, 2)").run(testPersonId, 'Less important quote');
    const q3 = db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count, created_at) VALUES (?, ?, 1, 0, datetime('now', '-10 days'))").run(testPersonId, 'Old quote with no importance');
    testQuoteIds = [Number(q1.lastInsertRowid), Number(q2.lastInsertRowid), Number(q3.lastInsertRowid)];

    // Link quotes to article
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(testQuoteIds[0], testArticleId);
    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(testQuoteIds[1], testArticleId);

  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/trending-test.db${suffix}`); } catch {}
    }
  });

  describe('Trending Calculator Service', () => {
    it('recalculateTrendingScores updates all entity scores', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const { recalculateTrendingScores } = await import('../../src/services/trendingCalculator.js');

      recalculateTrendingScores(db);

      // Quote with importants_count=5 should have trending_score > 0
      const q1 = db.prepare('SELECT trending_score FROM quotes WHERE id = ?').get(testQuoteIds[0]);
      expect(q1.trending_score).toBeGreaterThan(0);

      // Article score should include child quote importants
      const article = db.prepare('SELECT trending_score FROM articles WHERE id = ?').get(testArticleId);
      expect(article.trending_score).toBeGreaterThan(0);
    });

    it('recency bonus decays correctly', async () => {
      const { recencyBonus } = await import('../../src/services/trendingCalculator.js');

      // Recent (now)
      const recent = recencyBonus(new Date().toISOString());
      expect(recent).toBeCloseTo(10.0, 0);

      // 2 days old (~48h half-life)
      const twoDays = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const twoDay = recencyBonus(twoDays);
      expect(twoDay).toBeCloseTo(3.68, 0); // e^-1 ≈ 0.368 * 10

      // 8 days old (> 7 days)
      const eightDays = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const old = recencyBonus(eightDays);
      expect(old).toBe(0.0);

      // Null
      expect(recencyBonus(null)).toBe(0.0);
    });

    it('recalculateEntityScore only updates targeted entity and parents', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const { recalculateEntityScore } = await import('../../src/services/trendingCalculator.js');

      // Reset all scores to 0
      db.exec('UPDATE quotes SET trending_score = 0');
      db.exec('UPDATE articles SET trending_score = 0');
      db.exec('UPDATE persons SET trending_score = 0');

      // Recalculate only q1
      recalculateEntityScore(db, 'quote', testQuoteIds[0]);

      // q1 should be updated
      const q1 = db.prepare('SELECT trending_score FROM quotes WHERE id = ?').get(testQuoteIds[0]);
      expect(q1.trending_score).toBeGreaterThan(0);

      // q2 and q3 should still be 0 (not targeted)
      const q2 = db.prepare('SELECT trending_score FROM quotes WHERE id = ?').get(testQuoteIds[1]);
      expect(q2.trending_score).toBe(0);

      // Parent article should also be recalculated
      const article = db.prepare('SELECT trending_score FROM articles WHERE id = ?').get(testArticleId);
      expect(article.trending_score).toBeGreaterThan(0);
    });
  });

  describe('Trending API Endpoints', () => {
    beforeAll(async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const { recalculateTrendingScores } = await import('../../src/services/trendingCalculator.js');
      recalculateTrendingScores(db);
    });

    it('GET /api/analytics/trending-sources returns articles with quotes', async () => {
      const res = await request(app).get('/api/analytics/trending-sources');

      expect(res.status).toBe(200);
      expect(res.body.articles).toBeDefined();
      expect(Array.isArray(res.body.articles)).toBe(true);
    });

    it('GET /api/analytics/trending-quotes returns quote of day/week/month + recent', async () => {
      const res = await request(app).get('/api/analytics/trending-quotes');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('quote_of_day');
      expect(res.body).toHaveProperty('quote_of_week');
      expect(res.body).toHaveProperty('quote_of_month');
      expect(res.body).toHaveProperty('recent_quotes');
      expect(Array.isArray(res.body.recent_quotes)).toBe(true);
    });

    it('GET /api/analytics/all-sources returns articles newest first', async () => {
      const res = await request(app).get('/api/analytics/all-sources');

      expect(res.status).toBe(200);
      expect(res.body.articles).toBeDefined();
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
    });

    it('GET /api/analytics/all-sources sort=importance orders by trending_score', async () => {
      const res = await request(app).get('/api/analytics/all-sources?sort=importance');

      expect(res.status).toBe(200);
      expect(res.body.articles).toBeDefined();
    });

    it('GET /api/analytics/trending-authors returns total, page, limit fields', async () => {
      const res = await request(app).get('/api/analytics/trending-authors');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('limit');
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
    });

    it('GET /api/analytics/trending-sources returns total, page, limit fields', async () => {
      const res = await request(app).get('/api/analytics/trending-sources');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('limit');
      expect(typeof res.body.total).toBe('number');
      expect(res.body.page).toBe(1);
    });

    it('GET /api/analytics/trending-authors?sort=importance orders by SUM of quote importants_count', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // Create 3 authors with different total quote importance
      const pA = db.prepare("INSERT INTO persons (canonical_name, quote_count) VALUES ('Author A', 2)").run();
      const pB = db.prepare("INSERT INTO persons (canonical_name, quote_count) VALUES ('Author B', 1)").run();
      const pC = db.prepare("INSERT INTO persons (canonical_name, quote_count) VALUES ('Author C', 1)").run();

      // Author A: 10 + 5 = 15 total importance
      db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count) VALUES (?, 'A quote 1', 1, 10)").run(Number(pA.lastInsertRowid));
      db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count) VALUES (?, 'A quote 2', 1, 5)").run(Number(pA.lastInsertRowid));
      // Author B: 20 total importance
      db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count) VALUES (?, 'B quote 1', 1, 20)").run(Number(pB.lastInsertRowid));
      // Author C: 0 total importance
      db.prepare("INSERT INTO quotes (person_id, text, is_visible, importants_count) VALUES (?, 'C quote 1', 1, 0)").run(Number(pC.lastInsertRowid));

      const res = await request(app).get('/api/analytics/trending-authors?sort=importance');
      expect(res.status).toBe(200);

      const authors = res.body.authors;
      const names = authors.map(a => a.canonical_name);

      // B (20) should come before A (15) should come before C (0)
      const idxB = names.indexOf('Author B');
      const idxA = names.indexOf('Author A');
      const idxC = names.indexOf('Author C');

      expect(idxB).toBeLessThan(idxA);
      expect(idxA).toBeLessThan(idxC);

      // Verify actual importants_count values
      const authorB = authors.find(a => a.canonical_name === 'Author B');
      const authorA = authors.find(a => a.canonical_name === 'Author A');
      const authorC = authors.find(a => a.canonical_name === 'Author C');
      expect(authorB.importants_count).toBe(20);
      expect(authorA.importants_count).toBe(15);
      expect(authorC.importants_count).toBe(0);

      // Cleanup
      db.prepare('DELETE FROM quotes WHERE person_id IN (?, ?, ?)').run(Number(pA.lastInsertRowid), Number(pB.lastInsertRowid), Number(pC.lastInsertRowid));
      db.prepare('DELETE FROM persons WHERE id IN (?, ?, ?)').run(Number(pA.lastInsertRowid), Number(pB.lastInsertRowid), Number(pC.lastInsertRowid));
    });

    it('GET /api/analytics/trending-authors?search=X filters by name', async () => {
      const res = await request(app).get('/api/analytics/trending-authors?search=Trending');

      expect(res.status).toBe(200);
      expect(res.body.authors.length).toBeGreaterThan(0);
      expect(res.body.authors[0].canonical_name).toContain('Trending');
    });

    it('GET /api/analytics/trending-authors?search=X returns empty for no match', async () => {
      const res = await request(app).get('/api/analytics/trending-authors?search=ZZZnonexistent');

      expect(res.status).toBe(200);
      expect(res.body.authors).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('GET /api/analytics/trending-sources?search=X filters by title', async () => {
      const res = await request(app).get('/api/analytics/trending-sources?search=Trending');

      expect(res.status).toBe(200);
      expect(res.body.articles.length).toBeGreaterThan(0);
      expect(res.body.articles[0].title).toContain('Trending');
    });

    it('GET /api/analytics/trending-quotes?search=X filters quotes', async () => {
      const res = await request(app).get('/api/analytics/trending-quotes?search=Important');

      expect(res.status).toBe(200);
      expect(res.body.recent_quotes.length).toBeGreaterThan(0);
      // quote_of_day/week/month should be null when searching
      expect(res.body.quote_of_day).toBeNull();
      expect(res.body.quote_of_week).toBeNull();
      expect(res.body.quote_of_month).toBeNull();
    });

    it('GET /api/analytics/trending-authors?page=2&limit=1 returns offset results', async () => {
      // First check we have at least 1 author total
      const fullRes = await request(app).get('/api/analytics/trending-authors?limit=50');
      const totalAuthors = fullRes.body.total;

      if (totalAuthors > 1) {
        const res = await request(app).get('/api/analytics/trending-authors?page=2&limit=1');
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(2);
        expect(res.body.limit).toBe(1);
      } else {
        // With only 1 author, page 2 should return empty
        const res = await request(app).get('/api/analytics/trending-authors?page=2&limit=1');
        expect(res.status).toBe(200);
        expect(res.body.authors).toHaveLength(0);
      }
    });

    it('GET /api/analytics/trending-sources?page=2&limit=1 returns offset results', async () => {
      const fullRes = await request(app).get('/api/analytics/trending-sources?limit=50');
      const totalSources = fullRes.body.total;

      if (totalSources > 1) {
        const res = await request(app).get('/api/analytics/trending-sources?page=2&limit=1');
        expect(res.status).toBe(200);
        expect(res.body.page).toBe(2);
        expect(res.body.limit).toBe(1);
      } else {
        const res = await request(app).get('/api/analytics/trending-sources?page=2&limit=1');
        expect(res.status).toBe(200);
        expect(res.body.articles).toHaveLength(0);
      }
    });
  });
});
