import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/topics-test.db';

describe('Topics System', () => {
  let app;
  let authCookie;
  let testPersonId;
  let testQuoteIds = [];
  let testKeywordIds = [];

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    const { getAuthCookie } = await import('../helpers/auth.js');
    authCookie = getAuthCookie();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed test data
    const personResult = db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Topics Test Author');
    testPersonId = Number(personResult.lastInsertRowid);

    // Create keywords
    db.prepare("INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')").run('inflation', 'inflation');
    db.prepare("INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')").run('GDP', 'gdp');
    db.prepare("INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')").run('climate', 'climate');
    db.prepare("INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')").run('carbon tax', 'carbon tax');

    testKeywordIds = db.prepare('SELECT id FROM keywords ORDER BY id').all().map(r => r.id);

    // Create quotes with keywords
    const q1 = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(testPersonId, 'Economy is growing');
    const q2 = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(testPersonId, 'GDP numbers are up');
    const q3 = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(testPersonId, 'Climate policy is changing');

    testQuoteIds = [Number(q1.lastInsertRowid), Number(q2.lastInsertRowid), Number(q3.lastInsertRowid)];

    // Link quotes to keywords
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(testQuoteIds[0], testKeywordIds[0]); // q1 -> inflation
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(testQuoteIds[1], testKeywordIds[1]); // q2 -> GDP
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(testQuoteIds[2], testKeywordIds[2]); // q3 -> climate
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/topics-test.db${suffix}`); } catch {}
    }
  });

  // --- Topic Materialization ---

  describe('Topic Materialization', () => {
    it('quote with matching keyword gets linked to topic', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // Create a topic with keyword "inflation"
      db.prepare("INSERT INTO topics (name, slug) VALUES (?, ?)").run('Economy', 'economy');
      const topicId = db.prepare("SELECT id FROM topics WHERE slug = 'economy'").get().id;
      db.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(topicId, testKeywordIds[0]);

      // Run materialization
      const { materializeTopics } = await import('../../src/services/topicMaterializer.js');
      const result = materializeTopics(db);

      expect(result.topicsProcessed).toBeGreaterThanOrEqual(1);

      // Check that q1 (inflation) is linked to Economy topic
      const link = db.prepare('SELECT * FROM quote_topics WHERE quote_id = ? AND topic_id = ?').get(testQuoteIds[0], topicId);
      expect(link).toBeDefined();
    });

    it('quote with no matching keywords gets no topic', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // q3 has keyword "climate" but Economy topic only has "inflation"
      const topicId = db.prepare("SELECT id FROM topics WHERE slug = 'economy'").get().id;
      const link = db.prepare('SELECT * FROM quote_topics WHERE quote_id = ? AND topic_id = ?').get(testQuoteIds[2], topicId);
      // Climate quote should not match Economy topic
      expect(link).toBeUndefined();
    });

    it('re-running materialization is idempotent', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const { materializeTopics } = await import('../../src/services/topicMaterializer.js');

      const result1 = materializeTopics(db);
      const count1 = db.prepare('SELECT COUNT(*) as count FROM quote_topics').get().count;

      const result2 = materializeTopics(db);
      const count2 = db.prepare('SELECT COUNT(*) as count FROM quote_topics').get().count;

      expect(count1).toBe(count2);
    });
  });

  // --- Admin CRUD ---

  describe('Admin Topic CRUD', () => {
    it('POST /api/admin/topics creates topic with keywords', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({
          name: 'Climate Policy',
          description: 'Climate and environmental policy debates',
          keywords: ['climate', 'carbon tax', 'emissions'],
        });

      expect(res.status).toBe(200);
      expect(res.body.topic).toBeDefined();
      expect(res.body.topic.name).toBe('Climate Policy');
      expect(res.body.topic.slug).toBe('climate-policy');
      expect(res.body.keywords).toContain('climate');
      expect(res.body.keywords).toContain('carbon tax');
    });

    it('POST /api/admin/topics returns 409 for duplicate', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Climate Policy', keywords: [] });

      expect(res.status).toBe(409);
    });

    it('POST /api/admin/topics returns 400 for missing name', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ keywords: ['test'] });

      expect(res.status).toBe(400);
    });

    it('GET /api/admin/topics lists all topics', async () => {
      const res = await request(app)
        .get('/api/admin/topics')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.topics).toBeDefined();
      expect(res.body.topics.length).toBeGreaterThanOrEqual(2); // Economy + Climate Policy
    });

    it('PUT /api/admin/topics/:id updates topic', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const topic = db.prepare("SELECT id FROM topics WHERE slug = 'climate-policy'").get();

      const res = await request(app)
        .put(`/api/admin/topics/${topic.id}`)
        .set('Cookie', authCookie)
        .send({
          description: 'Updated description',
          context: 'Updated editorial context',
          keywords: ['climate', 'emissions', 'greenhouse gases'],
        });

      expect(res.status).toBe(200);
      expect(res.body.topic.description).toBe('Updated description');
      expect(res.body.topic.context).toBe('Updated editorial context');
      expect(res.body.keywords).toContain('greenhouse gases');
    });

    it('PUT /api/admin/topics/:id returns 404 for nonexistent', async () => {
      const res = await request(app)
        .put('/api/admin/topics/999999')
        .set('Cookie', authCookie)
        .send({ name: 'Nonexistent' });

      expect(res.status).toBe(404);
    });

    it('DELETE /api/admin/topics/:id removes topic', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // Create a temp topic
      db.prepare("INSERT INTO topics (name, slug) VALUES (?, ?)").run('Temp Delete', 'temp-delete');
      const topic = db.prepare("SELECT id FROM topics WHERE slug = 'temp-delete'").get();

      // Add a keyword link
      db.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(topic.id, testKeywordIds[0]);

      const res = await request(app)
        .delete(`/api/admin/topics/${topic.id}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify cascade
      const links = db.prepare('SELECT COUNT(*) as count FROM topic_keywords WHERE topic_id = ?').get(topic.id);
      expect(links.count).toBe(0);
    });

    it('DELETE /api/admin/topics/:id returns 404 for nonexistent', async () => {
      const res = await request(app)
        .delete('/api/admin/topics/999999')
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });

  // --- Public Endpoints ---

  describe('Public Topic Endpoints', () => {
    it('GET /api/topics returns topics sorted by trending_score', async () => {
      const res = await request(app)
        .get('/api/topics');

      expect(res.status).toBe(200);
      expect(res.body.topics).toBeDefined();
      expect(Array.isArray(res.body.topics)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(1);
    });

    it('GET /api/topics/:slug returns topic with quotes', async () => {
      // Re-materialize to ensure links exist
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const { materializeTopics } = await import('../../src/services/topicMaterializer.js');
      materializeTopics(db);

      const res = await request(app)
        .get('/api/topics/economy');

      expect(res.status).toBe(200);
      expect(res.body.topic).toBeDefined();
      expect(res.body.topic.name).toBe('Economy');
      expect(res.body.keywords).toBeDefined();
      expect(res.body.quotes).toBeDefined();
    });

    it('GET /api/topics/:slug returns 404 for nonexistent slug', async () => {
      const res = await request(app)
        .get('/api/topics/nonexistent-topic');

      expect(res.status).toBe(404);
    });
  });

  // --- Slug Generation ---

  describe('Slug Generation', () => {
    it('handles special characters correctly', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'U.S. Politics & Government', keywords: [] });

      expect(res.status).toBe(200);
      expect(res.body.topic.slug).toBe('u-s-politics-government');
    });
  });
});
