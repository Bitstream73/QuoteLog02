import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/author-image-search-test.db';

describe('Author Image Search API', () => {
  let app;
  let db;
  let authCookie;
  let personId;

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

    // Seed test person
    db.prepare('INSERT INTO persons (canonical_name, disambiguation, category) VALUES (?, ?, ?)')
      .run('Image Test Person', 'Test politician', 'Politician');
    personId = db.prepare("SELECT id FROM persons WHERE canonical_name = 'Image Test Person'").get().id;
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/author-image-search-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/authors/:id/image-suggestions', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).get(`/api/authors/${personId}/image-suggestions`);
      expect(res.status).toBe(401);
    });

    it('returns empty suggestions when no cache exists', async () => {
      const res = await request(app)
        .get(`/api/authors/${personId}/image-suggestions`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([]);
    });

    it('returns cached suggestions after they are stored', async () => {
      const suggestions = [
        { url: 'https://example.com/photo1.jpg', description: 'Test photo', source: 'Example' },
        { url: 'https://example.com/photo2.jpg', description: 'Another photo', source: 'Test' },
      ];
      db.prepare('UPDATE persons SET image_suggestions = ? WHERE id = ?')
        .run(JSON.stringify(suggestions), personId);

      const res = await request(app)
        .get(`/api/authors/${personId}/image-suggestions`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toHaveLength(2);
      expect(res.body.suggestions[0].url).toBe('https://example.com/photo1.jpg');
      expect(res.body.suggestions[1].source).toBe('Test');
    });

    it('returns 404 for non-existent author', async () => {
      const res = await request(app)
        .get('/api/authors/99999/image-suggestions')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/authors/:id/image-search', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app).post(`/api/authors/${personId}/image-search`);
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent author', async () => {
      const res = await request(app)
        .post('/api/authors/99999/image-search')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('image_suggestions column', () => {
    it('exists in persons table', () => {
      const cols = db.prepare('PRAGMA table_info(persons)').all().map(c => c.name);
      expect(cols).toContain('image_suggestions');
    });

    it('stores and retrieves JSON data correctly', () => {
      const testData = [{ url: 'https://test.com/img.jpg', description: 'test', source: 'test' }];
      db.prepare('UPDATE persons SET image_suggestions = ? WHERE id = ?')
        .run(JSON.stringify(testData), personId);

      const row = db.prepare('SELECT image_suggestions FROM persons WHERE id = ?').get(personId);
      const parsed = JSON.parse(row.image_suggestions);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].url).toBe('https://test.com/img.jpg');
    });
  });
});
