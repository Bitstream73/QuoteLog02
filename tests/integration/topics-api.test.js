import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/topics-api-test.db';

describe('Topics API', () => {
  let app;
  let authCookie;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/topics-api-test.db');
      fs.unlinkSync('./tests/topics-api-test.db-wal');
      fs.unlinkSync('./tests/topics-api-test.db-shm');
    } catch {}
  });

  describe('Auth protection', () => {
    it('GET /api/admin/topics returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/topics');
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/topics returns 401 without auth', async () => {
      const res = await request(app).post('/api/admin/topics').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  describe('CRUD operations', () => {
    let topicId;

    it('POST /api/admin/topics creates a topic', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Climate Change' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Climate Change');
      expect(res.body.slug).toBe('climate-change');
      expect(res.body.status).toBe('active');
      expect(res.body.id).toBeDefined();
      topicId = res.body.id;
    });

    it('POST /api/admin/topics creates a topic with all fields', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({
          name: 'US Election 2024',
          status: 'draft',
          start_date: '2024-01-01',
          end_date: '2024-11-05',
          description: 'Coverage of the 2024 US presidential election',
        });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('draft');
      expect(res.body.start_date).toBe('2024-01-01');
      expect(res.body.end_date).toBe('2024-11-05');
      expect(res.body.description).toBe('Coverage of the 2024 US presidential election');
    });

    it('POST /api/admin/topics creates a topic with aliases', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({
          name: 'Artificial Intelligence',
          aliases: ['AI', 'Machine Learning'],
        });
      expect(res.status).toBe(201);

      // Verify aliases were created
      const detail = await request(app)
        .get(`/api/admin/topics/${res.body.id}`)
        .set('Cookie', authCookie);
      expect(detail.body.aliases.length).toBe(2);
      expect(detail.body.aliases.map(a => a.alias).sort()).toEqual(['AI', 'Machine Learning']);
    });

    it('POST /api/admin/topics rejects duplicate names', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Climate Change' });
      expect(res.status).toBe(409);
    });

    it('POST /api/admin/topics rejects empty name', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/topics rejects missing name', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('GET /api/admin/topics lists topics with keyword_count and quote_count', async () => {
      const res = await request(app)
        .get('/api/admin/topics')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.topics).toBeInstanceOf(Array);
      expect(res.body.topics.length).toBeGreaterThanOrEqual(3);
      expect(res.body.topics[0]).toHaveProperty('keyword_count');
      expect(res.body.topics[0]).toHaveProperty('quote_count');
    });

    it('GET /api/admin/topics?status=draft filters by status', async () => {
      const res = await request(app)
        .get('/api/admin/topics?status=draft')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.topics.length).toBeGreaterThanOrEqual(1);
      for (const t of res.body.topics) {
        expect(t.status).toBe('draft');
      }
    });

    it('GET /api/admin/topics/:id returns topic with aliases and keywords', async () => {
      const res = await request(app)
        .get(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.topic.name).toBe('Climate Change');
      expect(res.body.aliases).toBeInstanceOf(Array);
      expect(res.body.keywords).toBeInstanceOf(Array);
    });

    it('GET /api/admin/topics/:id returns 404 for missing topic', async () => {
      const res = await request(app)
        .get('/api/admin/topics/99999')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    it('PUT /api/admin/topics/:id updates name and slug', async () => {
      const res = await request(app)
        .put(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie)
        .send({ name: 'Global Warming' });
      expect(res.status).toBe(200);
      expect(res.body.topic.name).toBe('Global Warming');
      expect(res.body.topic.slug).toBe('global-warming');
    });

    it('PUT /api/admin/topics/:id updates status', async () => {
      const res = await request(app)
        .put(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie)
        .send({ status: 'archived' });
      expect(res.status).toBe(200);
      expect(res.body.topic.status).toBe('archived');
    });

    it('PUT /api/admin/topics/:id updates description', async () => {
      const res = await request(app)
        .put(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie)
        .send({ description: 'Environmental topic' });
      expect(res.status).toBe(200);
      expect(res.body.topic.description).toBe('Environmental topic');
    });

    it('PUT /api/admin/topics/:id returns 404 for missing topic', async () => {
      const res = await request(app)
        .put('/api/admin/topics/99999')
        .set('Cookie', authCookie)
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('PUT /api/admin/topics/:id rejects empty name', async () => {
      const res = await request(app)
        .put(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie)
        .send({ name: '  ' });
      expect(res.status).toBe(400);
    });

    it('DELETE /api/admin/topics/:id deletes a topic', async () => {
      const create = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Throwaway Topic' });
      const throwId = create.body.id;

      const res = await request(app)
        .delete(`/api/admin/topics/${throwId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone
      const get = await request(app)
        .get(`/api/admin/topics/${throwId}`)
        .set('Cookie', authCookie);
      expect(get.status).toBe(404);
    });

    it('DELETE /api/admin/topics/:id returns 404 for missing topic', async () => {
      const res = await request(app)
        .delete('/api/admin/topics/99999')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Alias management', () => {
    let topicId;
    let aliasId;

    beforeAll(async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Healthcare' });
      topicId = res.body.id;
    });

    it('POST /api/admin/topics/:id/aliases adds an alias', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/aliases`)
        .set('Cookie', authCookie)
        .send({ alias: 'Health Care' });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeDefined();
      aliasId = res.body.id;
    });

    it('POST /api/admin/topics/:id/aliases rejects duplicate alias', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/aliases`)
        .set('Cookie', authCookie)
        .send({ alias: 'Health Care' });
      expect(res.status).toBe(409);
    });

    it('POST /api/admin/topics/:id/aliases rejects empty alias', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/aliases`)
        .set('Cookie', authCookie)
        .send({ alias: '' });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/topics/:id/aliases rejects missing alias', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/aliases`)
        .set('Cookie', authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/topics/:id/aliases returns 404 for missing topic', async () => {
      const res = await request(app)
        .post('/api/admin/topics/99999/aliases')
        .set('Cookie', authCookie)
        .send({ alias: 'Test' });
      expect(res.status).toBe(404);
    });

    it('GET /api/admin/topics/:id includes aliases', async () => {
      const res = await request(app)
        .get(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.aliases.length).toBe(1);
      expect(res.body.aliases[0].alias).toBe('Health Care');
      expect(res.body.aliases[0].alias_normalized).toBe('health care');
    });

    it('DELETE /api/admin/topics/:id/aliases/:aliasId removes an alias', async () => {
      const res = await request(app)
        .delete(`/api/admin/topics/${topicId}/aliases/${aliasId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify removed
      const detail = await request(app)
        .get(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(detail.body.aliases.length).toBe(0);
    });

    it('DELETE /api/admin/topics/:id/aliases/:aliasId returns 404 if not found', async () => {
      const res = await request(app)
        .delete(`/api/admin/topics/${topicId}/aliases/99999`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Keyword linking', () => {
    let topicId;
    let keywordId;

    beforeAll(async () => {
      const topicRes = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Economy' });
      topicId = topicRes.body.id;

      // Insert a keyword directly via DB
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const result = db.prepare("INSERT INTO keywords (name, name_normalized) VALUES ('inflation', 'inflation')").run();
      keywordId = Number(result.lastInsertRowid);
    });

    it('POST /api/admin/topics/:id/keywords links a keyword', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/keywords`)
        .set('Cookie', authCookie)
        .send({ keyword_id: keywordId });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/admin/topics/:id/keywords rejects duplicate link', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/keywords`)
        .set('Cookie', authCookie)
        .send({ keyword_id: keywordId });
      expect(res.status).toBe(409);
    });

    it('POST /api/admin/topics/:id/keywords rejects missing keyword_id', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/keywords`)
        .set('Cookie', authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/topics/:id/keywords returns 404 for missing topic', async () => {
      const res = await request(app)
        .post('/api/admin/topics/99999/keywords')
        .set('Cookie', authCookie)
        .send({ keyword_id: keywordId });
      expect(res.status).toBe(404);
    });

    it('POST /api/admin/topics/:id/keywords returns 404 for missing keyword', async () => {
      const res = await request(app)
        .post(`/api/admin/topics/${topicId}/keywords`)
        .set('Cookie', authCookie)
        .send({ keyword_id: 99999 });
      expect(res.status).toBe(404);
    });

    it('GET /api/admin/topics/:id includes linked keywords', async () => {
      const res = await request(app)
        .get(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.keywords.length).toBe(1);
      expect(res.body.keywords[0].name).toBe('inflation');
    });

    it('GET /api/admin/topics shows correct keyword_count', async () => {
      const res = await request(app)
        .get('/api/admin/topics')
        .set('Cookie', authCookie);
      const econ = res.body.topics.find(t => t.name === 'Economy');
      expect(econ.keyword_count).toBe(1);
    });

    it('DELETE /api/admin/topics/:id/keywords/:keywordId unlinks a keyword', async () => {
      const res = await request(app)
        .delete(`/api/admin/topics/${topicId}/keywords/${keywordId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify unlinked
      const detail = await request(app)
        .get(`/api/admin/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(detail.body.keywords.length).toBe(0);
    });

    it('DELETE /api/admin/topics/:id/keywords/:keywordId returns 404 if not linked', async () => {
      const res = await request(app)
        .delete(`/api/admin/topics/${topicId}/keywords/${keywordId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Cascade behavior', () => {
    it('Deleting a topic cascades to topic_aliases and topic_keywords', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // Create topic with alias and keyword link
      const topicRes = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Cascade Test Topic' });
      const tId = topicRes.body.id;

      await request(app)
        .post(`/api/admin/topics/${tId}/aliases`)
        .set('Cookie', authCookie)
        .send({ alias: 'CascadeAlias' });

      const kwResult = db.prepare("INSERT INTO keywords (name, name_normalized) VALUES ('cascade-kw', 'cascade-kw')").run();
      const kwId = Number(kwResult.lastInsertRowid);
      await request(app)
        .post(`/api/admin/topics/${tId}/keywords`)
        .set('Cookie', authCookie)
        .send({ keyword_id: kwId });

      // Delete the topic
      await request(app)
        .delete(`/api/admin/topics/${tId}`)
        .set('Cookie', authCookie);

      // Verify cascade
      const aliases = db.prepare('SELECT * FROM topic_aliases WHERE topic_id = ?').all(tId);
      expect(aliases.length).toBe(0);
      const links = db.prepare('SELECT * FROM topic_keywords WHERE topic_id = ?').all(tId);
      expect(links.length).toBe(0);
    });
  });

  describe('Slug generation', () => {
    it('generates correct slugs from names with special characters', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: 'Science & Technology' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('science-technology');
    });

    it('trims leading/trailing hyphens from slugs', async () => {
      const res = await request(app)
        .post('/api/admin/topics')
        .set('Cookie', authCookie)
        .send({ name: '  --War--  ' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('war');
    });
  });
});
