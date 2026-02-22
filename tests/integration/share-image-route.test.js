import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/share-image-test.db';

describe('Share Image Route', () => {
  let app;
  let testQuoteId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    // Load fonts
    const { loadFonts } = await import('../../src/services/shareImage.js');
    await loadFonts();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    const personResult = db.prepare('INSERT INTO persons (canonical_name, disambiguation) VALUES (?, ?)').run('Share Image Test Author', 'Test Politician');
    const personId = Number(personResult.lastInsertRowid);

    const quoteResult = db.prepare(
      'INSERT INTO quotes (person_id, text, context, is_visible, fact_check_category, fact_check_verdict, fact_check_claim, fact_check_explanation) VALUES (?, ?, ?, 1, ?, ?, ?, ?)'
    ).run(personId, 'This is a test quote for share image generation.', 'Said during a test session', 'A', 'TRUE', 'GDP growth claim', 'The claim checks out based on available data.');
    testQuoteId = Number(quoteResult.lastInsertRowid);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/share-image-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/quotes/:id/share-image', () => {
    it('returns JPEG for valid visible quote (landscape)', async () => {
      const res = await request(app).get(`/api/quotes/${testQuoteId}/share-image`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.headers['cache-control']).toBe('public, max-age=3600');
      // JPEG magic bytes
      expect(res.body[0]).toBe(0xFF);
      expect(res.body[1]).toBe(0xD8);
      expect(res.body[2]).toBe(0xFF);
    });

    it('returns JPEG for portrait format', async () => {
      const res = await request(app).get(`/api/quotes/${testQuoteId}/share-image?format=portrait`);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
      expect(res.body[0]).toBe(0xFF);
      expect(res.body[1]).toBe(0xD8);
    });

    it('returns 404 with fallback JPEG for non-existent quote', async () => {
      const res = await request(app).get('/api/quotes/999999/share-image');

      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toBe('image/jpeg');
      // Still a valid JPEG (1x1 fallback)
      expect(res.body[0]).toBe(0xFF);
      expect(res.body[1]).toBe(0xD8);
    });

    it('defaults to landscape when no format specified', async () => {
      const res = await request(app).get(`/api/quotes/${testQuoteId}/share-image`);
      expect(res.status).toBe(200);
      // Landscape images are larger than 1x1 fallback
      expect(res.body.length).toBeGreaterThan(5000);
    });
  });
});
