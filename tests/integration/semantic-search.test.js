import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/semantic-search-test.db';
// Disable Pinecone in tests so search falls back to SQLite
// Must set to empty string (not delete) because dotenv re-loads from .env
process.env.PINECONE_API_KEY = '';
process.env.PINECONE_INDEX_HOST = '';

describe('Semantic Search API', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Create persons
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category, category_context) VALUES (?, ?, ?, ?)').run('John Smith', 'https://example.com/john.jpg', 'Politician', 'U.S. Senator');
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category, category_context) VALUES (?, ?, ?, ?)').run('Jane Doe', null, 'Business Leader', 'CEO of Acme Corp');

    // Create visible quotes with context
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'The economy is growing steadily', 'economy growth GDP');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'Immigration reform is needed urgently', 'immigration reform policy');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(2, 'Markets are looking bullish this quarter', 'stock market bull run');

    // Hidden quote (should be excluded from non-admin search)
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 0, datetime('now'))").run(1, 'This is a hidden secret quote', 'classified');
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/semantic-search-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/quotes/search', () => {
    it('returns search results with SQLite fallback (no Pinecone configured)', async () => {
      const res = await request(app).get('/api/quotes/search?q=economy');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.quotes)).toBe(true);
      expect(res.body.quotes.length).toBeGreaterThan(0);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('totalPages');
      expect(res.body).toHaveProperty('query', 'economy');
      expect(res.body).toHaveProperty('searchMethod', 'text');
    });

    it('returns matching quotes by text', async () => {
      const res = await request(app).get('/api/quotes/search?q=economy');
      const texts = res.body.quotes.map(q => q.text);
      expect(texts.some(t => t.includes('economy'))).toBe(true);
    });

    it('returns matching quotes by author name', async () => {
      const res = await request(app).get('/api/quotes/search?q=John Smith');
      expect(res.body.quotes.length).toBeGreaterThan(0);
      expect(res.body.quotes.every(q => q.personName === 'John Smith')).toBe(true);
    });

    it('returns matching quotes by context', async () => {
      const res = await request(app).get('/api/quotes/search?q=immigration');
      expect(res.body.quotes.length).toBeGreaterThan(0);
    });

    it('excludes hidden quotes for non-admin', async () => {
      const res = await request(app).get('/api/quotes/search?q=hidden secret');
      expect(res.body.quotes.length).toBe(0);
    });

    it('returns correct quote fields', async () => {
      const res = await request(app).get('/api/quotes/search?q=economy');
      const q = res.body.quotes[0];
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('text');
      expect(q).toHaveProperty('context');
      expect(q).toHaveProperty('personId');
      expect(q).toHaveProperty('personName');
      expect(q).toHaveProperty('photoUrl');
      expect(q).toHaveProperty('personCategory');
      expect(q).toHaveProperty('createdAt');
      expect(q).toHaveProperty('sourceUrls');
    });

    it('includes article fields in response (null when no article linked)', async () => {
      const res = await request(app).get('/api/quotes/search?q=economy');
      const q = res.body.quotes[0];
      expect(q).toHaveProperty('articleId');
      expect(q).toHaveProperty('articleTitle');
      expect(q).toHaveProperty('primarySourceDomain');
    });

    it('rejects queries under 2 characters', async () => {
      const res = await request(app).get('/api/quotes/search?q=a');
      expect(res.status).toBe(400);
    });

    it('rejects missing query', async () => {
      const res = await request(app).get('/api/quotes/search');
      expect(res.status).toBe(400);
    });

    it('returns empty results for no matches', async () => {
      const res = await request(app).get('/api/quotes/search?q=xyznonexistent123');
      expect(res.status).toBe(200);
      expect(res.body.quotes.length).toBe(0);
      expect(res.body.total).toBe(0);
    });
  });
});
