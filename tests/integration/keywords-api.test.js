import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/keywords-api-test.db';

describe('Keywords API', () => {
  let app;
  const authCookie = getAuthCookie();

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/keywords-api-test.db${suffix}`); } catch {}
    }
  });

  describe('Auth protection', () => {
    it('GET /api/admin/keywords returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/keywords');
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/keywords returns 401 without auth', async () => {
      const res = await request(app).post('/api/admin/keywords').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/admin/keywords', () => {
    it('creates a keyword with name only', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'NATO' });

      expect(res.status).toBe(201);
      expect(res.body.keyword).toBeDefined();
      expect(res.body.keyword.name).toBe('NATO');
      expect(res.body.keyword.name_normalized).toBe('nato');
      expect(res.body.aliases).toEqual([]);
    });

    it('creates a keyword with aliases', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'European Union', aliases: ['EU', 'E.U.'] });

      expect(res.status).toBe(201);
      expect(res.body.keyword.name).toBe('European Union');
      expect(res.body.aliases).toEqual(['EU', 'E.U.']);
    });

    it('returns 400 for missing name', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('returns 400 for empty name', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: '   ' });

      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'NATO' });

      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already exists');
    });

    it('trims whitespace from name', async () => {
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: '  Supreme Court  ' });

      expect(res.status).toBe(201);
      expect(res.body.keyword.name).toBe('Supreme Court');
      expect(res.body.keyword.name_normalized).toBe('supreme court');
    });
  });

  describe('GET /api/admin/keywords', () => {
    it('lists all keywords with counts', async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.keywords)).toBe(true);
      expect(res.body.keywords.length).toBeGreaterThanOrEqual(3);

      const eu = res.body.keywords.find(k => k.name === 'European Union');
      expect(eu).toBeDefined();
      expect(eu.alias_count).toBe(2);
      expect(eu.quote_count).toBe(0);
    });

    it('returns keywords sorted by name', async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);

      const names = res.body.keywords.map(k => k.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });
  });

  describe('GET /api/admin/keywords/:id', () => {
    let keywordId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);
      const eu = res.body.keywords.find(k => k.name === 'European Union');
      keywordId = eu.id;
    });

    it('returns keyword with aliases', async () => {
      const res = await request(app)
        .get(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.keyword.name).toBe('European Union');
      expect(res.body.aliases.length).toBe(2);
      const aliasNames = res.body.aliases.map(a => a.alias);
      expect(aliasNames).toContain('EU');
      expect(aliasNames).toContain('E.U.');
    });

    it('returns 404 for nonexistent keyword', async () => {
      const res = await request(app)
        .get('/api/admin/keywords/999999')
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/admin/keywords/:id', () => {
    let keywordId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);
      const nato = res.body.keywords.find(k => k.name === 'NATO');
      keywordId = nato.id;
    });

    it('updates keyword name', async () => {
      const res = await request(app)
        .put(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie)
        .send({ name: 'North Atlantic Treaty Organization' });

      expect(res.status).toBe(200);
      expect(res.body.keyword.name).toBe('North Atlantic Treaty Organization');
      expect(res.body.keyword.name_normalized).toBe('north atlantic treaty organization');
    });

    it('returns 404 for nonexistent keyword', async () => {
      const res = await request(app)
        .put('/api/admin/keywords/999999')
        .set('Cookie', authCookie)
        .send({ name: 'Foo' });

      expect(res.status).toBe(404);
    });

    it('returns 400 for empty name', async () => {
      const res = await request(app)
        .put(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie)
        .send({ name: '' });

      expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate name', async () => {
      const res = await request(app)
        .put(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie)
        .send({ name: 'European Union' });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/admin/keywords/:id/aliases', () => {
    let keywordId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);
      const kw = res.body.keywords.find(k => k.name === 'Supreme Court');
      keywordId = kw.id;
    });

    it('adds alias to keyword', async () => {
      const res = await request(app)
        .post(`/api/admin/keywords/${keywordId}/aliases`)
        .set('Cookie', authCookie)
        .send({ alias: 'SCOTUS' });

      expect(res.status).toBe(201);
      expect(res.body.alias).toBe('SCOTUS');
      expect(res.body.alias_normalized).toBe('scotus');
      expect(res.body.keyword_id).toBe(keywordId);
    });

    it('returns 400 for missing alias', async () => {
      const res = await request(app)
        .post(`/api/admin/keywords/${keywordId}/aliases`)
        .set('Cookie', authCookie)
        .send({});

      expect(res.status).toBe(400);
    });

    it('returns 404 for nonexistent keyword', async () => {
      const res = await request(app)
        .post('/api/admin/keywords/999999/aliases')
        .set('Cookie', authCookie)
        .send({ alias: 'Test' });

      expect(res.status).toBe(404);
    });

    it('returns 409 for duplicate alias', async () => {
      const res = await request(app)
        .post(`/api/admin/keywords/${keywordId}/aliases`)
        .set('Cookie', authCookie)
        .send({ alias: 'SCOTUS' });

      expect(res.status).toBe(409);
    });
  });

  describe('DELETE /api/admin/keywords/:id/aliases/:aliasId', () => {
    let keywordId;
    let aliasId;

    beforeAll(async () => {
      const res = await request(app)
        .get('/api/admin/keywords')
        .set('Cookie', authCookie);
      const kw = res.body.keywords.find(k => k.name === 'Supreme Court');
      keywordId = kw.id;

      const detailRes = await request(app)
        .get(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie);
      const scotus = detailRes.body.aliases.find(a => a.alias === 'SCOTUS');
      aliasId = scotus.id;
    });

    it('removes alias from keyword', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordId}/aliases/${aliasId}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for already-deleted alias', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordId}/aliases/${aliasId}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent alias', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordId}/aliases/999999`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/admin/keywords/:id', () => {
    let keywordId;

    beforeAll(async () => {
      // Create a keyword to delete
      const res = await request(app)
        .post('/api/admin/keywords')
        .set('Cookie', authCookie)
        .send({ name: 'To Be Deleted', aliases: ['TBD'] });
      keywordId = res.body.keyword.id;
    });

    it('deletes keyword and cascades aliases', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify keyword is gone
      const checkRes = await request(app)
        .get(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie);
      expect(checkRes.status).toBe(404);
    });

    it('returns 404 for already-deleted keyword', async () => {
      const res = await request(app)
        .delete(`/api/admin/keywords/${keywordId}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });

    it('returns 404 for nonexistent keyword', async () => {
      const res = await request(app)
        .delete('/api/admin/keywords/999999')
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });
});
