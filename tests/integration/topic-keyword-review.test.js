import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/tkr-test.db';
process.env.PINECONE_API_KEY = '';
process.env.PINECONE_INDEX_HOST = '';

describe('Topic/Keyword Review API', () => {
  let app;
  let authCookie;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    // Get a valid auth token
    const config = (await import('../../src/config/index.js')).default;
    const token = jwt.sign({ email: 'test@test.com' }, config.jwtSecret, { expiresIn: '1h' });
    authCookie = `auth_token=${token}`;

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed some topics and keywords for review
    db.prepare("INSERT OR IGNORE INTO topics (name, slug, enabled) VALUES (?, ?, 0)").run('Test Topic A', 'test-topic-a');
    db.prepare("INSERT OR IGNORE INTO topics (name, slug, enabled) VALUES (?, ?, 0)").run('Test Topic B', 'test-topic-b');
    db.prepare("INSERT OR IGNORE INTO keywords (name, name_normalized, enabled) VALUES (?, ?, 0)").run('Test Keyword X', 'test keyword x');

    // Add to review queue
    const topicA = db.prepare('SELECT id FROM topics WHERE slug = ?').get('test-topic-a');
    const topicB = db.prepare('SELECT id FROM topics WHERE slug = ?').get('test-topic-b');
    const kwX = db.prepare('SELECT id FROM keywords WHERE name = ?').get('Test Keyword X');

    if (topicA) {
      db.prepare("INSERT OR IGNORE INTO topic_keyword_review (entity_type, entity_id, original_name, source) VALUES ('topic', ?, ?, 'ai')")
        .run(topicA.id, 'Test Topic A');
    }
    if (topicB) {
      db.prepare("INSERT OR IGNORE INTO topic_keyword_review (entity_type, entity_id, original_name, source) VALUES ('topic', ?, ?, 'ai')")
        .run(topicB.id, 'Test Topic B');
    }
    if (kwX) {
      db.prepare("INSERT OR IGNORE INTO topic_keyword_review (entity_type, entity_id, original_name, source) VALUES ('keyword', ?, ?, 'ai')")
        .run(kwX.id, 'Test Keyword X');
    }
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/tkr-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/review/topics-keywords', () => {
    it('requires admin auth', async () => {
      const res = await request(app).get('/api/review/topics-keywords');
      expect(res.status).toBe(401);
    });

    it('returns pending items with pagination', async () => {
      const res = await request(app)
        .get('/api/review/topics-keywords')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('items');
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('totalPages');
      expect(Array.isArray(res.body.items)).toBe(true);
    });

    it('filters by entity_type', async () => {
      const res = await request(app)
        .get('/api/review/topics-keywords?entity_type=topic')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      for (const item of res.body.items) {
        expect(item.entity_type).toBe('topic');
      }
    });
  });

  describe('GET /api/review/topics-keywords/stats', () => {
    it('returns stats', async () => {
      const res = await request(app)
        .get('/api/review/topics-keywords/stats')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('pending');
      expect(res.body).toHaveProperty('approved');
      expect(res.body).toHaveProperty('rejected');
      expect(res.body).toHaveProperty('pendingTopics');
      expect(res.body).toHaveProperty('pendingKeywords');
      expect(typeof res.body.pending).toBe('number');
    });
  });

  describe('POST /api/review/topics-keywords/:id/approve', () => {
    it('approves an item and enables the entity', async () => {
      // Get a pending item
      const list = await request(app)
        .get('/api/review/topics-keywords?entity_type=topic')
        .set('Cookie', authCookie);
      const item = list.body.items.find(i => i.original_name === 'Test Topic A');
      expect(item).toBeDefined();

      const res = await request(app)
        .post(`/api/review/topics-keywords/${item.id}/approve`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.action).toBe('approved');

      // Verify topic is now enabled
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const topic = db.prepare('SELECT enabled FROM topics WHERE slug = ?').get('test-topic-a');
      expect(topic.enabled).toBe(1);
    });
  });

  describe('POST /api/review/topics-keywords/:id/reject', () => {
    it('rejects an item', async () => {
      const list = await request(app)
        .get('/api/review/topics-keywords?entity_type=keyword')
        .set('Cookie', authCookie);
      const item = list.body.items.find(i => i.original_name === 'Test Keyword X');
      if (!item) return; // May have been resolved in migration

      const res = await request(app)
        .post(`/api/review/topics-keywords/${item.id}/reject`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.action).toBe('rejected');
    });
  });

  describe('POST /api/review/topics-keywords/:id/edit', () => {
    it('renames and approves an item', async () => {
      const list = await request(app)
        .get('/api/review/topics-keywords?entity_type=topic')
        .set('Cookie', authCookie);
      const item = list.body.items.find(i => i.original_name === 'Test Topic B');
      if (!item) return;

      const res = await request(app)
        .post(`/api/review/topics-keywords/${item.id}/edit`)
        .set('Cookie', authCookie)
        .send({ new_name: 'Renamed Topic B' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.new_name).toBe('Renamed Topic B');

      // Verify renamed in DB
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const topic = db.prepare('SELECT name, enabled FROM topics WHERE slug = ?').get('renamed-topic-b');
      expect(topic).toBeDefined();
      expect(topic.name).toBe('Renamed Topic B');
      expect(topic.enabled).toBe(1);
    });
  });

  describe('POST /api/review/topics-keywords/batch', () => {
    it('rejects invalid requests', async () => {
      const res = await request(app)
        .post('/api/review/topics-keywords/batch')
        .set('Cookie', authCookie)
        .send({ action: 'invalid', ids: [1] });
      expect(res.status).toBe(400);
    });

    it('returns 400 for missing ids', async () => {
      const res = await request(app)
        .post('/api/review/topics-keywords/batch')
        .set('Cookie', authCookie)
        .send({ action: 'approve' });
      expect(res.status).toBe(400);
    });
  });
});
