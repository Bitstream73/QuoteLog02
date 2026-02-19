import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/source-authors-api-test.db';

describe('Source Authors API', () => {
  let app;
  let db;
  let authCookie;
  let sourceAuthorId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();

    // Login to get admin cookie
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jakob@karlsmark.com', password: 'Ferret@00' });
    const cookies = loginRes.headers['set-cookie'];
    authCookie = cookies.find(c => c.startsWith('auth_token='));

    // Seed test source author
    db.prepare('INSERT OR IGNORE INTO source_authors (name, domain) VALUES (?, ?)').run('TestNews', 'testnews.com');
    sourceAuthorId = db.prepare("SELECT id FROM source_authors WHERE domain = 'testnews.com'").get().id;
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/source-authors-api-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/source-authors', () => {
    it('returns list of source authors', async () => {
      const res = await request(app).get('/api/source-authors');
      expect(res.status).toBe(200);
      expect(res.body.sourceAuthors).toBeDefined();
      expect(Array.isArray(res.body.sourceAuthors)).toBe(true);
      const found = res.body.sourceAuthors.find(sa => sa.domain === 'testnews.com');
      expect(found).toBeDefined();
      expect(found.name).toBe('TestNews');
    });

    it('includes source_count', async () => {
      const res = await request(app).get('/api/source-authors');
      const found = res.body.sourceAuthors.find(sa => sa.domain === 'testnews.com');
      expect(found).toHaveProperty('source_count');
    });
  });

  describe('GET /api/source-authors/:id', () => {
    it('returns source author with linked sources', async () => {
      const res = await request(app).get(`/api/source-authors/${sourceAuthorId}`);
      expect(res.status).toBe(200);
      expect(res.body.sourceAuthor.name).toBe('TestNews');
      expect(res.body.sourceAuthor.domain).toBe('testnews.com');
      expect(Array.isArray(res.body.sources)).toBe(true);
    });

    it('returns 404 for non-existent source author', async () => {
      const res = await request(app).get('/api/source-authors/99999');
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/source-authors/:id', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .send({ name: 'New Name' });
      expect(res.status).toBe(401);
    });

    it('updates name', async () => {
      const res = await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .set('Cookie', authCookie)
        .send({ name: 'Updated TestNews' });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.sourceAuthor.name).toBe('Updated TestNews');

      // Reset name
      await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .set('Cookie', authCookie)
        .send({ name: 'TestNews' });
    });

    it('updates imageUrl', async () => {
      const res = await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .set('Cookie', authCookie)
        .send({ imageUrl: 'https://example.com/logo.png' });
      expect(res.status).toBe(200);
      expect(res.body.sourceAuthor.image_url).toBe('https://example.com/logo.png');

      // Clear
      await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .set('Cookie', authCookie)
        .send({ imageUrl: '' });
    });

    it('updates description', async () => {
      const res = await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .set('Cookie', authCookie)
        .send({ description: 'A test news org' });
      expect(res.status).toBe(200);
      expect(res.body.sourceAuthor.description).toBe('A test news org');
    });

    it('rejects empty name', async () => {
      const res = await request(app)
        .patch(`/api/source-authors/${sourceAuthorId}`)
        .set('Cookie', authCookie)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('returns 404 for non-existent source author', async () => {
      const res = await request(app)
        .patch('/api/source-authors/99999')
        .set('Cookie', authCookie)
        .send({ name: 'Nothing' });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/source-authors/:id/image-suggestions', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).get(`/api/source-authors/${sourceAuthorId}/image-suggestions`);
      expect(res.status).toBe(401);
    });

    it('returns empty suggestions when no cache', async () => {
      const res = await request(app)
        .get(`/api/source-authors/${sourceAuthorId}/image-suggestions`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([]);
    });

    it('returns cached suggestions after storing', async () => {
      const suggestions = [
        { url: 'https://example.com/img1.jpg', description: 'Logo', source: 'Wiki' },
      ];
      db.prepare('UPDATE source_authors SET image_suggestions = ? WHERE id = ?')
        .run(JSON.stringify(suggestions), sourceAuthorId);

      const res = await request(app)
        .get(`/api/source-authors/${sourceAuthorId}/image-suggestions`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(1);
      expect(res.body.suggestions[0].url).toBe('https://example.com/img1.jpg');
    });

    it('returns 404 for non-existent source author', async () => {
      const res = await request(app)
        .get('/api/source-authors/99999/image-suggestions')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/source-authors/:id/image-search', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).post(`/api/source-authors/${sourceAuthorId}/image-search`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent source author', async () => {
      const res = await request(app)
        .post('/api/source-authors/99999/image-search')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });
});
