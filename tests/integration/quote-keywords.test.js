import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/quote-keywords-test.db';

describe('Quote Keywords/Topics API', () => {
  let app;
  let testQuoteId;
  let testPersonId;
  let testTopicId;
  const authCookie = getAuthCookie();

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed test data
    const personResult = db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Keywords Test Author');
    testPersonId = Number(personResult.lastInsertRowid);

    const quoteResult = db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(testPersonId, 'Test quote for keywords');
    testQuoteId = Number(quoteResult.lastInsertRowid);

    const topicResult = db.prepare("INSERT INTO topics (name, slug) VALUES (?, ?)").run(`QK Test Topic ${Date.now()}`, `qk-test-topic-${Date.now()}`);
    testTopicId = Number(topicResult.lastInsertRowid);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/quote-keywords-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/quotes/:id/keywords-topics', () => {
    it('returns empty arrays when no keywords or topics linked', async () => {
      const res = await request(app)
        .get(`/api/quotes/${testQuoteId}/keywords-topics`);

      expect(res.status).toBe(200);
      expect(res.body.keywords).toEqual([]);
      expect(res.body.topics).toEqual([]);
    });

    it('returns keywords and topics after linking', async () => {
      // Link a keyword and topic first
      await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: 'Climate Change', keyword_type: 'concept' });

      await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/topics`)
        .set('Cookie', authCookie)
        .send({ topic_id: testTopicId });

      const res = await request(app)
        .get(`/api/quotes/${testQuoteId}/keywords-topics`);

      expect(res.status).toBe(200);
      expect(res.body.keywords.length).toBeGreaterThanOrEqual(1);
      expect(res.body.keywords[0]).toHaveProperty('id');
      expect(res.body.keywords[0]).toHaveProperty('name');
      expect(res.body.keywords[0]).toHaveProperty('keyword_type');
      expect(res.body.topics.length).toBeGreaterThanOrEqual(1);
      expect(res.body.topics[0]).toHaveProperty('id');
      expect(res.body.topics[0]).toHaveProperty('name');
      expect(res.body.topics[0]).toHaveProperty('slug');
    });

    it('does not require auth (read-only)', async () => {
      const res = await request(app)
        .get(`/api/quotes/${testQuoteId}/keywords-topics`);

      expect(res.status).toBe(200);
    });

    it('returns 404 for nonexistent quote', async () => {
      const res = await request(app)
        .get('/api/quotes/999999/keywords-topics');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/admin/quotes/:id/keywords', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .send({ name: 'Test Keyword' });

      expect(res.status).toBe(401);
    });

    it('creates and links a new keyword', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: 'Foreign Policy', keyword_type: 'concept' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyword).toHaveProperty('id');
      expect(res.body.keyword.name).toBe('Foreign Policy');
      expect(res.body.keyword.keyword_type).toBe('concept');
    });

    it('links existing keyword without creating duplicate', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: 'Foreign Policy' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('defaults keyword_type to concept', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: 'Economy' });

      expect(res.status).toBe(200);
      expect(res.body.keyword.keyword_type).toBe('concept');
    });

    it('returns 400 for empty name', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent quote', async () => {
      const res = await request(app)
        .post('/api/admin/quotes/999999/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/quotes/:id/keywords/:keywordId', () => {
    let keywordIdToDelete;

    beforeAll(async () => {
      // Create a keyword to delete
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: 'Keyword To Unlink' });
      keywordIdToDelete = res.body.keyword.id;
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .delete(`/api/admin/quotes/${testQuoteId}/keywords/${keywordIdToDelete}`);

      expect(res.status).toBe(401);
    });

    it('unlinks keyword from quote', async () => {
      const res = await request(app)
        .delete(`/api/admin/quotes/${testQuoteId}/keywords/${keywordIdToDelete}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify keyword still exists in keywords table
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const keyword = db.prepare('SELECT id FROM keywords WHERE id = ?').get(keywordIdToDelete);
      expect(keyword).toBeDefined();
    });
  });

  describe('POST /api/admin/quotes/:id/topics', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/topics`)
        .send({ topic_id: testTopicId });

      expect(res.status).toBe(401);
    });

    it('links existing topic by topic_id', async () => {
      // Clean up first
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      db.prepare('DELETE FROM quote_topics WHERE quote_id = ? AND topic_id = ?').run(testQuoteId, testTopicId);

      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/topics`)
        .set('Cookie', authCookie)
        .send({ topic_id: testTopicId });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.topic.id).toBe(testTopicId);
      expect(res.body.topic.id).toBe(testTopicId);
    });

    it('creates and links a new topic by name', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/topics`)
        .set('Cookie', authCookie)
        .send({ name: 'Brand New Topic' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.topic.name).toBe('Brand New Topic');
      expect(res.body.topic.slug).toBe('brand-new-topic');
    });

    it('links existing topic when name matches slug', async () => {
      // Should find the "Brand New Topic" we just created, not create a duplicate
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/topics`)
        .set('Cookie', authCookie)
        .send({ name: 'Brand New Topic' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 400 for missing both topic_id and name', async () => {
      const res = await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/topics`)
        .set('Cookie', authCookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent quote', async () => {
      const res = await request(app)
        .post('/api/admin/quotes/999999/topics')
        .set('Cookie', authCookie)
        .send({ topic_id: testTopicId });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/quotes/:id/topics/:topicId', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .delete(`/api/admin/quotes/${testQuoteId}/topics/${testTopicId}`);

      expect(res.status).toBe(401);
    });

    it('unlinks topic from quote', async () => {
      const res = await request(app)
        .delete(`/api/admin/quotes/${testQuoteId}/topics/${testTopicId}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify topic still exists
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const topic = db.prepare('SELECT id FROM topics WHERE id = ?').get(testTopicId);
      expect(topic).toBeDefined();
    });
  });

  // --- Phase 3: Standalone Keyword CRUD ---

  describe('GET /api/admin/keywords', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .get('/api/admin/keywords');

      expect(res.status).toBe(401);
    });

    it('lists all keywords with quote counts', async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.keywords)).toBe(true);
      if (res.body.keywords.length > 0) {
        expect(res.body.keywords[0]).toHaveProperty('id');
        expect(res.body.keywords[0]).toHaveProperty('name');
        expect(res.body.keywords[0]).toHaveProperty('keyword_type');
        expect(res.body.keywords[0]).toHaveProperty('quote_count');
      }
    });
  });

  describe('POST /api/admin/keywords', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .send({ name: 'Test Keyword' });

      expect(res.status).toBe(401);
    });

    it('creates a new keyword', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'Standalone Keyword', keyword_type: 'event' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyword.name).toBe('Standalone Keyword');
      expect(res.body.keyword.keyword_type).toBe('event');
    });

    it('returns 400 for empty name', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'Standalone Keyword' });

      expect(res.status).toBe(409);
    });
  });

  describe('PATCH /api/admin/keywords/:id', () => {
    let keywordToUpdate;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'Keyword To Update', keyword_type: 'concept' });
      keywordToUpdate = res.body.keyword;
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .patch(`/api/admin/keywords/${keywordToUpdate.id}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(401);
    });

    it('updates keyword name', async () => {
      const res = await request(app)
        .patch(`/api/admin/keywords/${keywordToUpdate.id}`)
        .set('Cookie', authCookie)
        .send({ name: 'Updated Keyword Name' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.keyword.name).toBe('Updated Keyword Name');
    });

    it('updates keyword_type', async () => {
      const res = await request(app)
        .patch(`/api/admin/keywords/${keywordToUpdate.id}`)
        .set('Cookie', authCookie)
        .send({ keyword_type: 'organization' });

      expect(res.status).toBe(200);
      expect(res.body.keyword.keyword_type).toBe('organization');
    });

    it('returns 404 for nonexistent keyword', async () => {
      const res = await request(app)
        .patch('/api/admin/keywords/999999')
        .set('Cookie', authCookie)
        .send({ name: 'Test' });

      expect(res.status).toBe(404);
    });

    it('returns 400 when no fields provided', async () => {
      const res = await request(app)
        .patch(`/api/admin/keywords/${keywordToUpdate.id}`)
        .set('Cookie', authCookie)
        .send({});

      expect(res.status).toBe(400);
    });
  });

  describe('DELETE /api/admin/keywords/:id', () => {
    let keywordToDelete;

    beforeAll(async () => {
      // Create keyword and link it to quote and topic
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'Keyword To Delete', keyword_type: 'concept' });
      keywordToDelete = res.body.keyword;

      // Link to quote
      await request(app)
        .post(`/api/admin/quotes/${testQuoteId}/keywords`)
        .set('Cookie', authCookie)
        .send({ name: 'Keyword To Delete' });
    });

    it('returns 401 without auth', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordToDelete.id}`);

      expect(res.status).toBe(401);
    });

    it('cascade-deletes from quote_keywords and topic_keywords', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordToDelete.id}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify keyword is gone
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const keyword = db.prepare('SELECT id FROM keywords WHERE id = ?').get(keywordToDelete.id);
      expect(keyword).toBeUndefined();

      // Verify quote_keywords link is gone
      const link = db.prepare('SELECT * FROM quote_keywords WHERE keyword_id = ?').get(keywordToDelete.id);
      expect(link).toBeUndefined();
    });

    it('returns 404 for nonexistent keyword', async () => {
      const res = await request(app)
        .delete('/api/admin/keywords/999999')
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });
});
