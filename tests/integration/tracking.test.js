import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/tracking-test.db';

describe('View & Share Tracking API', () => {
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

    const personResult = db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Tracking Test Author');
    testPersonId = Number(personResult.lastInsertRowid);

    const quoteResult = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(testPersonId, 'Tracking test quote');
    testQuoteId = Number(quoteResult.lastInsertRowid);

    const articleResult = db.prepare("INSERT INTO articles (url, title, status) VALUES (?, ?, 'completed')").run('https://example.com/tracking-test', 'Tracking Test Article');
    testArticleId = Number(articleResult.lastInsertRowid);

    const topicResult = db.prepare("INSERT INTO topics (name, slug) VALUES (?, ?)").run('Tracking Topic', 'tracking-topic');
    testTopicId = Number(topicResult.lastInsertRowid);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/tracking-test.db${suffix}`); } catch {}
    }
  });

  describe('POST /api/tracking/view', () => {
    it('increments view_count for article', async () => {
      const res = await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'article', entity_id: testArticleId })
        .set('User-Agent', 'ViewTracker1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('increments view_count for person', async () => {
      const res = await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'person', entity_id: testPersonId })
        .set('User-Agent', 'ViewTracker2');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('increments view_count for topic', async () => {
      const res = await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'topic', entity_id: testTopicId })
        .set('User-Agent', 'ViewTracker3');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for quote entity_type (quotes have no view_count)', async () => {
      const res = await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'ViewTracker4');

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent entity', async () => {
      const res = await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'article', entity_id: 999999 })
        .set('User-Agent', 'ViewTracker5');

      expect(res.status).toBe(404);
    });

    it('deduplicates views from same voter within 5 minutes', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // Get current count
      const before = db.prepare('SELECT view_count FROM articles WHERE id = ?').get(testArticleId);

      // Send same view again (same UA as ViewTracker1)
      await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'article', entity_id: testArticleId })
        .set('User-Agent', 'DedupAgent');

      const after1 = db.prepare('SELECT view_count FROM articles WHERE id = ?').get(testArticleId);
      const firstCount = after1.view_count;

      // Same agent, same entity — should be deduped
      await request(app)
        .post('/api/tracking/view')
        .send({ entity_type: 'article', entity_id: testArticleId })
        .set('User-Agent', 'DedupAgent');

      const after2 = db.prepare('SELECT view_count FROM articles WHERE id = ?').get(testArticleId);
      expect(after2.view_count).toBe(firstCount); // Count should NOT increase
    });
  });

  describe('POST /api/tracking/share', () => {
    it('increments share_count for quote and returns count', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'ShareTracker1');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.share_count).toBe(1);
    });

    it('increments share_count for article', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'article', entity_id: testArticleId })
        .set('User-Agent', 'ShareTracker2');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.share_count).toBe(1);
    });

    it('increments share_count for person', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'person', entity_id: testPersonId })
        .set('User-Agent', 'ShareTracker3');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.share_count).toBe(1);
    });

    it('increments share_count for topic', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'topic', entity_id: testTopicId })
        .set('User-Agent', 'ShareTracker4');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.share_count).toBe(1);
    });

    it('returns 404 for nonexistent entity', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'quote', entity_id: 999999 })
        .set('User-Agent', 'ShareTracker5');

      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid entity_type', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'invalid', entity_id: 1 })
        .set('User-Agent', 'ShareTracker6');

      expect(res.status).toBe(400);
    });

    it('accumulates share_count on repeated shares', async () => {
      const res = await request(app)
        .post('/api/tracking/share')
        .send({ entity_type: 'quote', entity_id: testQuoteId })
        .set('User-Agent', 'ShareTracker7');

      expect(res.status).toBe(200);
      expect(res.body.share_count).toBe(2); // 1 from earlier + 1 now
    });
  });
});
