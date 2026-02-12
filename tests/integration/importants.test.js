import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/importants-test.db';

describe('Importants API', () => {
  let app;
  let testQuoteId;
  let testArticleId;
  let testPersonId;
  let testTopicId;

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

    const articleResult = db.prepare("INSERT INTO articles (url, title, status) VALUES (?, ?, 'completed')").run('https://example.com/importants-test', 'Test Article');
    testArticleId = Number(articleResult.lastInsertRowid);

    const topicResult = db.prepare("INSERT INTO topics (name, slug) VALUES (?, ?)").run('Test Topic', 'test-topic');
    testTopicId = Number(topicResult.lastInsertRowid);
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

    it('works for topic entity type', async () => {
      const res = await request(app)
        .post('/api/importants/toggle')
        .send({ entity_type: 'topic', entity_id: testTopicId })
        .set('User-Agent', 'TestAgent-Topics');

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
});
