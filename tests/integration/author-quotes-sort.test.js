import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/author-quotes-sort-test.db';

describe('Author Quotes Sort & Featured Quote API', () => {
  let app;
  let db;
  let personId;
  let quoteIds = {};

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();

    // Seed test person
    db.prepare('INSERT INTO persons (canonical_name, disambiguation, category) VALUES (?, ?, ?)')
      .run('Sort Test Author', 'Test politician', 'Politician');
    personId = db.prepare("SELECT id FROM persons WHERE canonical_name = 'Sort Test Author'").get().id;

    // Seed quotes with varying importants_count and dates
    // Quote A: high importance, older date
    db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
      VALUES (?, ?, ?, ?, ?, 1)`)
      .run('Quote A - high importance old', personId, 10, '2025-01-01T12:00:00Z', '2025-01-01T12:00:00Z');
    quoteIds.a = db.prepare("SELECT id FROM quotes WHERE text = 'Quote A - high importance old'").get().id;

    // Quote B: medium importance, recent date
    db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
      VALUES (?, ?, ?, ?, ?, 1)`)
      .run('Quote B - medium importance recent', personId, 5, '2025-12-15T12:00:00Z', '2025-12-15T12:00:00Z');
    quoteIds.b = db.prepare("SELECT id FROM quotes WHERE text = 'Quote B - medium importance recent'").get().id;

    // Quote C: low importance, newest date
    db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
      VALUES (?, ?, ?, ?, ?, 1)`)
      .run('Quote C - low importance newest', personId, 1, '2026-01-20T12:00:00Z', '2026-01-20T12:00:00Z');
    quoteIds.c = db.prepare("SELECT id FROM quotes WHERE text = 'Quote C - low importance newest'").get().id;

    // Quote D: tied importance with Quote A, but newer date
    db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
      VALUES (?, ?, ?, ?, ?, 1)`)
      .run('Quote D - high importance newer', personId, 10, '2025-06-15T12:00:00Z', '2025-06-15T12:00:00Z');
    quoteIds.d = db.prepare("SELECT id FROM quotes WHERE text = 'Quote D - high importance newer'").get().id;
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/author-quotes-sort-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/authors/:id/quotes', () => {
    it('default sort returns quotes ordered by date descending', async () => {
      const res = await request(app).get(`/api/authors/${personId}/quotes?limit=50`);
      expect(res.status).toBe(200);
      const ids = res.body.quotes.map(q => q.id);
      // Newest first: C (2026-01-20), B (2025-12-15), D (2025-06-15), A (2025-01-01)
      expect(ids).toEqual([quoteIds.c, quoteIds.b, quoteIds.d, quoteIds.a]);
    });

    it('sort=importance returns quotes ordered by importance', async () => {
      const res = await request(app).get(`/api/authors/${personId}/quotes?limit=50&sort=importance`);
      expect(res.status).toBe(200);
      const ids = res.body.quotes.map(q => q.id);
      // Tiered importance sort: recent high-importance quotes first
      // C (imp=1, 2026-01-20) is within ~30 days of now → tier 3
      // B (imp=5, 2025-12-15) may be tier 3 or 4 depending on test date
      // D (imp=10, 2025-06-15) and A (imp=10, 2025-01-01) → tier 4 (older)
      // Tier 5: importance=0 (none here)
      // Within a tier: higher importants_count first, then newer date
      // The last quote should be in the lowest-priority tier with lowest importance
      // All 4 quotes have importance > 0, so none are in tier 5
      // Verify that higher-importance quotes from the same time period beat lower ones
      // D and A (both imp=10) should be adjacent, D before A (newer date)
      const dIdx = ids.indexOf(quoteIds.d);
      const aIdx = ids.indexOf(quoteIds.a);
      expect(dIdx).toBeLessThan(aIdx); // D (10, newer) before A (10, older)
    });

    it('page 1 response includes a featuredQuote object', async () => {
      const res = await request(app).get(`/api/authors/${personId}/quotes?limit=50`);
      expect(res.status).toBe(200);
      expect(res.body.featuredQuote).toBeDefined();
      expect(res.body.featuredQuote).not.toBeNull();
      expect(res.body.featuredQuote.id).toBeDefined();
      expect(res.body.featuredQuote.text).toBeDefined();
    });

    it('page 2 response has featuredQuote: null', async () => {
      const res = await request(app).get(`/api/authors/${personId}/quotes?limit=2&page=2`);
      expect(res.status).toBe(200);
      expect(res.body.featuredQuote).toBeNull();
    });

    it('featured quote = highest importants_count; ties broken by latest date', async () => {
      const res = await request(app).get(`/api/authors/${personId}/quotes?limit=50`);
      expect(res.status).toBe(200);
      // D has importants_count=10 and newer date than A (also 10)
      expect(res.body.featuredQuote.id).toBe(quoteIds.d);
    });

    it('response includes importantsCount and quoteDateTime fields on each quote', async () => {
      const res = await request(app).get(`/api/authors/${personId}/quotes?limit=50`);
      expect(res.status).toBe(200);
      for (const q of res.body.quotes) {
        expect(q).toHaveProperty('importantsCount');
        expect(q).toHaveProperty('quoteDateTime');
        expect(typeof q.importantsCount).toBe('number');
      }
    });
  });

  describe('featured quote with all zero importants_count', () => {
    let zeroPersonId;

    beforeAll(() => {
      // Seed another person with all zero-importance quotes
      db.prepare('INSERT INTO persons (canonical_name, disambiguation, category) VALUES (?, ?, ?)')
        .run('Zero Importance Author', 'Test', 'Other');
      zeroPersonId = db.prepare("SELECT id FROM persons WHERE canonical_name = 'Zero Importance Author'").get().id;

      db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
        VALUES (?, ?, 0, ?, ?, 1)`)
        .run('Zero Q1 older', zeroPersonId, '2025-03-01T12:00:00Z', '2025-03-01T12:00:00Z');
      db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
        VALUES (?, ?, 0, ?, ?, 1)`)
        .run('Zero Q2 newest', zeroPersonId, '2025-06-01T12:00:00Z', '2025-06-01T12:00:00Z');
      db.prepare(`INSERT INTO quotes (text, person_id, importants_count, quote_datetime, created_at, is_visible)
        VALUES (?, ?, 0, ?, ?, 1)`)
        .run('Zero Q3 middle', zeroPersonId, '2025-04-15T12:00:00Z', '2025-04-15T12:00:00Z');
    });

    it('when all importants_count = 0, featured quote = latest by date', async () => {
      const res = await request(app).get(`/api/authors/${zeroPersonId}/quotes?limit=50`);
      expect(res.status).toBe(200);
      expect(res.body.featuredQuote).not.toBeNull();
      // "Zero Q2 newest" has the latest date
      expect(res.body.featuredQuote.text).toBe('Zero Q2 newest');
    });
  });
});
