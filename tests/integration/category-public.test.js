import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/category-public-test.db';
process.env.PINECONE_API_KEY = '';
process.env.PINECONE_INDEX_HOST = '';

describe('Category Public API', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed: category, topic, category_topics, person, quote, quote_topics
    db.prepare("INSERT INTO categories (id, name, slug, sort_order) VALUES (1, 'Politics', 'politics', 1)").run();
    db.prepare("INSERT INTO categories (id, name, slug, sort_order) VALUES (2, 'Economy', 'economy', 2)").run();

    db.prepare("INSERT INTO topics (id, name) VALUES (1, 'Elections')").run();
    db.prepare("INSERT INTO topics (id, name) VALUES (2, 'Tax Policy')").run();

    db.prepare('INSERT INTO category_topics (category_id, topic_id) VALUES (1, 1)').run();
    db.prepare('INSERT INTO category_topics (category_id, topic_id) VALUES (2, 2)').run();

    db.prepare("INSERT INTO persons (id, canonical_name, photo_url, category, category_context, quote_count) VALUES (1, 'Jane Doe', null, 'Politician', 'Senator from NY', 2)").run();

    db.prepare("INSERT INTO quotes (id, person_id, text, context, is_visible, created_at) VALUES (1, 1, 'We must protect democracy', 'Political speech', 1, datetime('now'))").run();
    db.prepare("INSERT INTO quotes (id, person_id, text, context, is_visible, created_at) VALUES (2, 1, 'Tax reform is essential', 'Economy speech', 1, datetime('now'))").run();
    db.prepare("INSERT INTO quotes (id, person_id, text, context, is_visible, created_at) VALUES (3, 1, 'Hidden policy quote', 'Secret', 0, datetime('now'))").run();

    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (1, 1)').run();
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (2, 2)').run();
    db.prepare('INSERT INTO quote_topics (quote_id, topic_id) VALUES (3, 1)').run(); // invisible quote linked to politics
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/category-public-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/categories/:id', () => {
    it('returns category detail with topics and quoteCount', async () => {
      const res = await request(app).get('/api/categories/1');
      expect(res.status).toBe(200);
      expect(res.body.category).toEqual({ id: 1, name: 'Politics', slug: 'politics' });
      expect(res.body.topics).toEqual([{ id: 1, name: 'Elections' }]);
      expect(res.body.quoteCount).toBe(1); // only visible quotes
    });

    it('resolves category by slug', async () => {
      const res = await request(app).get('/api/categories/economy');
      expect(res.status).toBe(200);
      expect(res.body.category.name).toBe('Economy');
    });

    it('returns 404 for non-existent category', async () => {
      const res = await request(app).get('/api/categories/999');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Category not found');
    });
  });

  describe('GET /api/categories/:id/quotes', () => {
    it('returns paginated quotes with person info', async () => {
      const res = await request(app).get('/api/categories/1/quotes');
      expect(res.status).toBe(200);
      expect(res.body.quotes.length).toBe(1);
      expect(res.body.quotes[0].text).toContain('democracy');
      expect(res.body.quotes[0].personName).toBe('Jane Doe');
      expect(res.body.quotes[0].personId).toBe(1);
      expect(res.body).toHaveProperty('total');
      expect(res.body).toHaveProperty('page');
      expect(res.body).toHaveProperty('totalPages');
    });

    it('excludes invisible quotes for non-admin', async () => {
      const res = await request(app).get('/api/categories/1/quotes');
      const texts = res.body.quotes.map(q => q.text);
      expect(texts).not.toContain('Hidden policy quote');
    });

    it('returns 404 for non-existent category', async () => {
      const res = await request(app).get('/api/categories/999/quotes');
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/search/unified with categories', () => {
    it('includes categories array in response', async () => {
      const res = await request(app).get('/api/search/unified?q=Politics');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
    });

    it('finds categories by name', async () => {
      const res = await request(app).get('/api/search/unified?q=Econ');
      expect(res.body.categories.length).toBeGreaterThan(0);
      expect(res.body.categories[0].name).toBe('Economy');
      expect(res.body.categories[0]).toHaveProperty('quote_count');
    });
  });
});
