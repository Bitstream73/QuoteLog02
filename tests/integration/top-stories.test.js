import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/top-stories-test.db';

describe('Top Stories API', () => {
  let app;
  let db;
  let authCookie;
  let sourceId;
  let articleId;
  let quoteId;

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

    // Seed test data: source, article, person, quote, quote_articles link
    const srcResult = db.prepare(
      'INSERT INTO sources (domain, name, rss_url, enabled, is_top_story) VALUES (?, ?, ?, 1, 0)'
    ).run('topstory-test.com', 'TopStory Test', 'https://topstory-test.com/rss');
    sourceId = srcResult.lastInsertRowid;

    const artResult = db.prepare(
      "INSERT INTO articles (url, source_id, title, status, is_top_story) VALUES (?, ?, ?, 'completed', 0)"
    ).run('https://topstory-test.com/article1', sourceId, 'Test Article');
    articleId = artResult.lastInsertRowid;

    db.prepare('INSERT INTO persons (canonical_name, category) VALUES (?, ?)').run('Top Story Person', 'Politician');
    const personId = db.prepare('SELECT id FROM persons WHERE canonical_name = ?').get('Top Story Person').id;

    const quoteResult = db.prepare(
      'INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)'
    ).run(personId, 'This is a top story test quote');
    quoteId = quoteResult.lastInsertRowid;

    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(quoteId, articleId);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/top-stories-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/sources', () => {
    it('includes is_top_story field in source response', async () => {
      const res = await request(app).get('/api/sources');
      expect(res.status).toBe(200);
      const source = res.body.sources.find(s => s.domain === 'topstory-test.com');
      expect(source).toBeDefined();
      expect(source.is_top_story).toBe(0);
    });
  });

  describe('PATCH /api/sources/:id — is_top_story', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app)
        .patch(`/api/sources/${sourceId}`)
        .send({ is_top_story: 1 });
      expect(res.status).toBe(401);
    });

    it('toggles source is_top_story to 1', async () => {
      const res = await request(app)
        .patch(`/api/sources/${sourceId}`)
        .send({ is_top_story: 1 })
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.source.is_top_story).toBe(1);
    });

    it('toggles source is_top_story back to 0', async () => {
      const res = await request(app)
        .patch(`/api/sources/${sourceId}`)
        .send({ is_top_story: 0 })
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.source.is_top_story).toBe(0);
    });
  });

  describe('PATCH /api/articles/:id — is_top_story', () => {
    it('rejects unauthenticated request', async () => {
      const res = await request(app)
        .patch(`/api/articles/${articleId}`)
        .send({ is_top_story: 1 });
      expect(res.status).toBe(401);
    });

    it('returns 404 for non-existent article', async () => {
      const res = await request(app)
        .patch('/api/articles/99999')
        .send({ is_top_story: 1 })
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    it('toggles article is_top_story to 1', async () => {
      const res = await request(app)
        .patch(`/api/articles/${articleId}`)
        .send({ is_top_story: 1 })
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.article.isTopStory).toBe(1);
    });

    it('toggles article is_top_story back to 0', async () => {
      const res = await request(app)
        .patch(`/api/articles/${articleId}`)
        .send({ is_top_story: 0 })
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.article.isTopStory).toBe(0);
    });
  });

  describe('GET /api/articles/:id', () => {
    it('includes isTopStory in article response', async () => {
      const res = await request(app).get(`/api/articles/${articleId}`);
      expect(res.status).toBe(200);
      expect(res.body.article).toHaveProperty('isTopStory');
    });
  });

  describe('GET /api/quotes?tab=top-stories', () => {
    it('returns no top story quotes when none are marked', async () => {
      // Ensure both source and article have is_top_story=0
      db.prepare('UPDATE sources SET is_top_story = 0 WHERE id = ?').run(sourceId);
      db.prepare('UPDATE articles SET is_top_story = 0 WHERE id = ?').run(articleId);

      const res = await request(app).get('/api/quotes?tab=top-stories');
      expect(res.status).toBe(200);
      const found = res.body.quotes.find(q => q.id === quoteId);
      expect(found).toBeUndefined();
    });

    it('returns quotes when article is marked as top story', async () => {
      db.prepare('UPDATE articles SET is_top_story = 1 WHERE id = ?').run(articleId);

      const res = await request(app).get('/api/quotes?tab=top-stories');
      expect(res.status).toBe(200);
      const found = res.body.quotes.find(q => q.id === Number(quoteId));
      expect(found).toBeDefined();
      expect(found.text).toBe('This is a top story test quote');

      // Reset
      db.prepare('UPDATE articles SET is_top_story = 0 WHERE id = ?').run(articleId);
    });

    it('returns quotes when source is marked as top story', async () => {
      db.prepare('UPDATE sources SET is_top_story = 1 WHERE id = ?').run(sourceId);

      const res = await request(app).get('/api/quotes?tab=top-stories');
      expect(res.status).toBe(200);
      const found = res.body.quotes.find(q => q.id === Number(quoteId));
      expect(found).toBeDefined();

      // Reset
      db.prepare('UPDATE sources SET is_top_story = 0 WHERE id = ?').run(sourceId);
    });

    it('includes Top Stories count in categories', async () => {
      db.prepare('UPDATE articles SET is_top_story = 1 WHERE id = ?').run(articleId);

      const res = await request(app).get('/api/quotes');
      expect(res.status).toBe(200);
      const topStoriesCat = res.body.categories.find(c => c.category === 'Top Stories');
      expect(topStoriesCat).toBeDefined();
      expect(topStoriesCat.count).toBeGreaterThanOrEqual(1);

      // Reset
      db.prepare('UPDATE articles SET is_top_story = 0 WHERE id = ?').run(articleId);
    });

    it('returns regular quotes when tab is not set', async () => {
      const res = await request(app).get('/api/quotes');
      expect(res.status).toBe(200);
      expect(res.body.quotes.length).toBeGreaterThanOrEqual(0);
    });
  });
});
