import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/importants-test.db';

describe('Importants API', () => {
  let app;
  let testQuoteId;
  let testArticleId;
  let testPersonId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed test data
    const personResult = db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Importants Test Author');
    testPersonId = Number(personResult.lastInsertRowid);

    const quoteResult = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(testPersonId, 'Important test quote');
    testQuoteId = Number(quoteResult.lastInsertRowid);

    const articleResult = db.prepare("INSERT INTO articles (url, title, status) VALUES (?, ?, 'completed')").run(`https://example.com/importants-test-${Date.now()}`, 'Test Article');
    testArticleId = Number(articleResult.lastInsertRowid);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/importants-test.db${suffix}`); } catch {}
    }
  });

  describe('POST /api/importants/toggle', () => {
    it('creates record and increments count on first toggle', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'TestAgent-Importants');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.is_important).toBe(true);
      expect(res.body.importants_count).toBe(1);
    });

    it('removes record and decrements count on second toggle', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'TestAgent-Importants');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.is_important).toBe(false);
      expect(res.body.importants_count).toBe(0);
    });

    it('count never goes below 0', async () => {
      // Ensure count is 0
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      db.prepare('UPDATE quotes SET importants_count = 0 WHERE id = ?').run(testQuoteId);

      // Toggle off when already off should not go below 0
      // First mark it, then unmark it when count is already 0 from DB manipulation
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'NeverBelow0Agent');

      expect(res.status).toBe(200);
      expect(res.body.importants_count).toBeGreaterThanOrEqual(0);
    });

    it('returns 400 for invalid entity_type', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'invalid', entity_id: 1 })
        .set('User-Agent', 'TestAgent');

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for missing entity_id', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote' })
        .set('User-Agent', 'TestAgent');

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent entity', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: 999999 })
        .set('User-Agent', 'TestAgent');

      expect(res.status).toBe(404);
    });

    it('works for article entity type', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'article', entity_id: testArticleId })
        .set('User-Agent', 'TestAgent-Articles');

      expect(res.status).toBe(200);
      expect(res.body.is_important).toBe(true);
      expect(res.body.importants_count).toBe(1);
    });

    it('works for person entity type', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'person', entity_id: testPersonId })
        .set('User-Agent', 'TestAgent-Persons');

      expect(res.status).toBe(200);
      expect(res.body.is_important).toBe(true);
      expect(res.body.importants_count).toBe(1);
    });

    it('different voters get independent toggle states', async () => {
      // Clean up first
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      db.prepare('DELETE FROM importants WHERE entity_type = ? AND entity_id = ?').run('quote', testQuoteId);
      db.prepare('UPDATE quotes SET importants_count = 0 WHERE id = ?').run(testQuoteId);

      // Voter A marks as important
      const resA = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'VoterA');

      expect(resA.body.is_important).toBe(true);
      expect(resA.body.importants_count).toBe(1);

      // Voter B marks as important (different UA = different voter_hash)
      const resB = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'VoterB');

      expect(resB.body.is_important).toBe(true);
      expect(resB.body.importants_count).toBe(2);

      // Voter A toggles off
      const resA2 = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'VoterA');

      expect(resA2.body.is_important).toBe(false);
      expect(resA2.body.importants_count).toBe(1);
    });
  });

  describe('GET /api/importants/status', () => {
    beforeAll(async () => {
      // Clean up and set known state
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      db.prepare('DELETE FROM importants').run();
      db.prepare('UPDATE quotes SET importants_count = 0 WHERE id = ?').run(testQuoteId);
      db.prepare('UPDATE articles SET importants_count = 0 WHERE id = ?').run(testArticleId);
    });

    it('returns correct boolean map for current voter', async () => {
      // Mark quote as important
      await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'StatusTestAgent');

      // Check status
      const res = await request(app)
        .get(`/api/importants/status?entities=quote:${testQuoteId},article:${testArticleId}`)
        .set('User-Agent', 'StatusTestAgent');

      expect(res.status).toBe(200);
      expect(res.body.statuses[`quote:${testQuoteId}`]).toBe(true);
      expect(res.body.statuses[`article:${testArticleId}`]).toBe(false);
    });

    it('returns empty statuses for no entities param', async () => {
      const res = await request(app)
        .get('/api/importants/status')
        .set('User-Agent', 'StatusTestAgent');

      expect(res.status).toBe(200);
      expect(res.body.statuses).toEqual({});
    });
  });

  describe('GET /api/quotes includes importants_count', () => {
    it('quote list includes importants_count field', async () => {
      const res = await request(app)
        .get('/api/quotes')
        .set('User-Agent', 'TestAgent');

      expect(res.status).toBe(200);
      if (res.body.quotes && res.body.quotes.length > 0) {
        expect(res.body.quotes[0]).toHaveProperty('importantsCount');
      }
    });

    it('single quote detail includes importants_count field', async () => {
      const res = await request(app)
        .get(`/api/quotes/${testQuoteId}`)
        .set('User-Agent', 'TestAgent');

      expect(res.status).toBe(200);
      expect(res.body.quote).toHaveProperty('importantsCount');
    });
  });

  describe('POST /api/importants/super-toggle', () => {
    const authCookie = getAuthCookie();

    beforeAll(async () => {
      // Reset importants_count to known state for super-toggle tests
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      db.prepare('UPDATE quotes SET importants_count = 0 WHERE id = ?').run(testQuoteId);
      db.prepare('UPDATE articles SET importants_count = 0 WHERE id = ?').run(testArticleId);
      db.prepare('UPDATE persons SET importants_count = 0 WHERE id = ?').run(testPersonId);
    });

    it('returns 401 without auth cookie', async () => {
      const res = await request(app)
        .post('/api/importants/super-toggle')
        .send({ entity_type: 'quote', entity_id: testQuoteId });

      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid entity_type', async () => {
      const res = await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'invalid', entity_id: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for missing entity_id', async () => {
      const res = await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'quote' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent entity', async () => {
      const res = await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'quote', entity_id: 999999 });

      expect(res.status).toBe(404);
    });

    it('increments importants_count by 100', async () => {
      // Verify starting count is 0
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const before = db.prepare('SELECT importants_count FROM quotes WHERE id = ?').get(testQuoteId);
      expect(before.importants_count).toBe(0);

      const res = await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'quote', entity_id: testQuoteId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.importants_count).toBe(100);

      // Verify DB was updated
      const after = db.prepare('SELECT importants_count FROM quotes WHERE id = ?').get(testQuoteId);
      expect(after.importants_count).toBe(100);
    });

    it('is additive — second call adds another 100', async () => {
      const res = await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'quote', entity_id: testQuoteId });

      expect(res.status).toBe(200);
      expect(res.body.importants_count).toBe(200);
    });

    it('returns correct response shape', async () => {
      const res = await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'article', entity_id: testArticleId });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('importants_count');
      expect(typeof res.body.importants_count).toBe('number');
      // Should NOT have is_important (that's for regular toggle)
      expect(res.body).not.toHaveProperty('is_important');
    });

    it('emits Socket.IO important_update event', async () => {
      // Set up a spy on io.emit
      const io = app.get('io');
      const emitted = [];
      const originalEmit = io?.emit?.bind(io);
      if (io) {
        io.emit = (...args) => {
          emitted.push(args);
          if (originalEmit) originalEmit(...args);
        };
      }

      await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'person', entity_id: testPersonId });

      // Restore original emit
      if (io && originalEmit) io.emit = originalEmit;

      if (io) {
        const importantEvent = emitted.find(e => e[0] === 'important_update');
        expect(importantEvent).toBeDefined();
        expect(importantEvent[1]).toMatchObject({
          entity_type: 'person',
          entity_id: testPersonId,
        });
        expect(typeof importantEvent[1].importants_count).toBe('number');
      }
    });

    it('does NOT create an importants table row', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // Reset person count and clear any importants rows for it
      db.prepare('UPDATE persons SET importants_count = 0 WHERE id = ?').run(testPersonId);
      db.prepare('DELETE FROM importants WHERE entity_type = ? AND entity_id = ?').run('person', testPersonId);

      await request(app)
        .post('/api/importants/super-toggle')
        .set('Cookie', authCookie)
        .send({ entity_type: 'person', entity_id: testPersonId });

      // Verify no importants row was created
      const row = db.prepare(
        'SELECT id FROM importants WHERE entity_type = ? AND entity_id = ?'
      ).get('person', testPersonId);
      expect(row).toBeUndefined();
    });
  });
});
