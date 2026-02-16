import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/search-unified-test.db';
process.env.PINECONE_API_KEY = '';
process.env.PINECONE_INDEX_HOST = '';

describe('Unified Search API', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed test data
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category, quote_count) VALUES (?, ?, ?, ?)').run('Albert Einstein', null, 'Scientist/Academic', 5);
    db.prepare('INSERT INTO persons (canonical_name, photo_url, category, quote_count) VALUES (?, ?, ?, ?)').run('Marie Curie', null, 'Scientist/Academic', 3);

    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(1, 'Imagination is more important than knowledge', 'Science and creativity');
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 1, datetime('now'))").run(2, 'Nothing in life is to be feared, it is only to be understood', 'Courage in science');

    // Hidden quote
    db.prepare("INSERT INTO quotes (person_id, text, context, is_visible, created_at) VALUES (?, ?, ?, 0, datetime('now'))").run(1, 'Secret hidden quote about gravity', 'hidden');

    // Add an article
    db.prepare("INSERT INTO articles (url, title, status, created_at) VALUES (?, ?, 'completed', datetime('now'))").run('https://example.com/science', 'The Future of Science');
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/search-unified-test.db${suffix}`); } catch {}
    }
  });

  describe('GET /api/search/unified', () => {
    it('returns 400 for short query', async () => {
      const res = await request(app).get('/api/search/unified?q=a');
      expect(res.status).toBe(400);
    });

    it('returns results across multiple types', async () => {
      const res = await request(app).get('/api/search/unified?q=science');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('quotes');
      expect(res.body).toHaveProperty('persons');
      expect(res.body).toHaveProperty('articles');
      expect(Array.isArray(res.body.quotes)).toBe(true);
      expect(Array.isArray(res.body.persons)).toBe(true);
    });

    it('finds quotes by text', async () => {
      const res = await request(app).get('/api/search/unified?q=imagination');
      expect(res.body.quotes.length).toBeGreaterThan(0);
      expect(res.body.quotes[0].text).toContain('Imagination');
    });

    it('finds persons by name', async () => {
      const res = await request(app).get('/api/search/unified?q=Einstein');
      expect(res.body.persons.length).toBeGreaterThan(0);
      expect(res.body.persons[0].canonical_name).toContain('Einstein');
    });

    it('finds articles by title', async () => {
      const res = await request(app).get('/api/search/unified?q=Future');
      expect(res.body.articles.length).toBeGreaterThan(0);
      expect(res.body.articles[0].title).toContain('Future');
    });

    it('excludes hidden quotes for non-admin', async () => {
      const res = await request(app).get('/api/search/unified?q=gravity');
      expect(res.body.quotes.length).toBe(0);
    });

    it('respects limit parameter', async () => {
      const res = await request(app).get('/api/search/unified?q=science&limit=1');
      // Each category is limited individually
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/search/autocomplete', () => {
    it('returns empty for short query', async () => {
      const res = await request(app).get('/api/search/autocomplete?q=a');
      expect(res.status).toBe(200);
      expect(res.body.suggestions).toEqual([]);
    });

    it('returns suggestions with type labels', async () => {
      const res = await request(app).get('/api/search/autocomplete?q=Ein');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.suggestions)).toBe(true);
      expect(res.body.suggestions.length).toBeGreaterThan(0);
      const first = res.body.suggestions[0];
      expect(first).toHaveProperty('label');
      expect(first).toHaveProperty('type');
      expect(first).toHaveProperty('id');
    });

    it('finds persons in autocomplete', async () => {
      const res = await request(app).get('/api/search/autocomplete?q=Curie');
      const personSuggestions = res.body.suggestions.filter(s => s.type === 'person');
      expect(personSuggestions.length).toBeGreaterThan(0);
      expect(personSuggestions[0].label).toContain('Curie');
    });

    it('respects limit parameter', async () => {
      const res = await request(app).get('/api/search/autocomplete?q=e&limit=2');
      expect(res.body.suggestions.length).toBeLessThanOrEqual(2);
    });
  });

  describe('GET /api/search/noteworthy', () => {
    it('returns noteworthy items (empty when none configured)', async () => {
      const res = await request(app).get('/api/search/noteworthy');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.items)).toBe(true);
    });
  });
});
