import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/categories-api-test.db';

describe('Categories API', () => {
  let app;
  let authCookie;

  beforeAll(async () => {
    // Ensure closeDb is called to pick up our DATABASE_PATH
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();

    // Clean taxonomy tables for test isolation
    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();
    db.prepare('DELETE FROM category_topics').run();
    db.prepare('DELETE FROM topic_keywords').run();
    db.prepare('DELETE FROM quote_keywords').run();
    db.prepare('DELETE FROM quote_topics').run();
    db.prepare('DELETE FROM topic_aliases').run();
    db.prepare('DELETE FROM keyword_aliases').run();
    db.prepare('DELETE FROM taxonomy_suggestions').run();
    db.prepare('DELETE FROM topics').run();
    db.prepare('DELETE FROM keywords').run();
    db.prepare('DELETE FROM categories').run();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/categories-api-test.db');
      fs.unlinkSync('./tests/categories-api-test.db-wal');
      fs.unlinkSync('./tests/categories-api-test.db-shm');
    } catch {}
  });

  describe('Auth protection', () => {
    it('GET /api/admin/categories returns 401 without auth', async () => {
      const res = await request(app).get('/api/admin/categories');
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/categories returns 401 without auth', async () => {
      const res = await request(app).post('/api/admin/categories').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });
  });

  describe('CRUD operations', () => {
    let categoryId;

    it('POST /api/admin/categories creates a category', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Politics' });
      expect(res.status).toBe(201);
      expect(res.body.name).toBe('Politics');
      expect(res.body.slug).toBe('politics');
      expect(res.body.sort_order).toBe(0);
      expect(res.body.id).toBeDefined();
      categoryId = res.body.id;
    });

    it('POST /api/admin/categories auto-increments sort_order', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Science' });
      expect(res.status).toBe(201);
      expect(res.body.sort_order).toBe(1);
    });

    it('POST /api/admin/categories rejects duplicate names', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Politics' });
      expect(res.status).toBe(409);
    });

    it('POST /api/admin/categories rejects empty name', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: '' });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/categories rejects missing name', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('GET /api/admin/categories lists categories with topic_count', async () => {
      const res = await request(app)
        .get('/api/admin/categories')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.categories).toBeInstanceOf(Array);
      expect(res.body.categories.length).toBeGreaterThanOrEqual(2);
      expect(res.body.categories[0]).toHaveProperty('topic_count');
    });

    it('GET /api/admin/categories/:id returns category with topics', async () => {
      const res = await request(app)
        .get(`/api/admin/categories/${categoryId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.category.name).toBe('Politics');
      expect(res.body.topics).toBeInstanceOf(Array);
    });

    it('GET /api/admin/categories/:id returns 404 for missing category', async () => {
      const res = await request(app)
        .get('/api/admin/categories/99999')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    it('PUT /api/admin/categories/:id updates name and slug', async () => {
      const res = await request(app)
        .put(`/api/admin/categories/${categoryId}`)
        .set('Cookie', authCookie)
        .send({ name: 'US Politics' });
      expect(res.status).toBe(200);
      expect(res.body.category.name).toBe('US Politics');
      expect(res.body.category.slug).toBe('us-politics');
    });

    it('PUT /api/admin/categories/:id updates sort_order', async () => {
      const res = await request(app)
        .put(`/api/admin/categories/${categoryId}`)
        .set('Cookie', authCookie)
        .send({ sort_order: 10 });
      expect(res.status).toBe(200);
      expect(res.body.category.sort_order).toBe(10);
    });

    it('PUT /api/admin/categories/:id returns 404 for missing category', async () => {
      const res = await request(app)
        .put('/api/admin/categories/99999')
        .set('Cookie', authCookie)
        .send({ name: 'Nope' });
      expect(res.status).toBe(404);
    });

    it('PUT /api/admin/categories/:id rejects empty name', async () => {
      const res = await request(app)
        .put(`/api/admin/categories/${categoryId}`)
        .set('Cookie', authCookie)
        .send({ name: '  ' });
      expect(res.status).toBe(400);
    });

    it('DELETE /api/admin/categories/:id deletes a category', async () => {
      // Create a throwaway category to delete
      const create = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Throwaway' });
      const throwId = create.body.id;

      const res = await request(app)
        .delete(`/api/admin/categories/${throwId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify it's gone
      const get = await request(app)
        .get(`/api/admin/categories/${throwId}`)
        .set('Cookie', authCookie);
      expect(get.status).toBe(404);
    });

    it('DELETE /api/admin/categories/:id returns 404 for missing category', async () => {
      const res = await request(app)
        .delete('/api/admin/categories/99999')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });
  });

  describe('Category-Topic linking', () => {
    let catId;
    let topicId;

    beforeAll(async () => {
      // Create a category and a topic for linking tests
      const catRes = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Economy' });
      catId = catRes.body.id;

      // Insert a topic directly via DB
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const result = db.prepare("INSERT INTO topics (name, slug) VALUES ('Inflation', 'inflation')").run();
      topicId = Number(result.lastInsertRowid);
    });

    it('POST /api/admin/categories/:id/topics links a topic', async () => {
      const res = await request(app)
        .post(`/api/admin/categories/${catId}/topics`)
        .set('Cookie', authCookie)
        .send({ topic_id: topicId });
      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('POST /api/admin/categories/:id/topics rejects duplicate link', async () => {
      const res = await request(app)
        .post(`/api/admin/categories/${catId}/topics`)
        .set('Cookie', authCookie)
        .send({ topic_id: topicId });
      expect(res.status).toBe(409);
    });

    it('POST /api/admin/categories/:id/topics rejects missing topic_id', async () => {
      const res = await request(app)
        .post(`/api/admin/categories/${catId}/topics`)
        .set('Cookie', authCookie)
        .send({});
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/categories/:id/topics returns 404 for missing category', async () => {
      const res = await request(app)
        .post('/api/admin/categories/99999/topics')
        .set('Cookie', authCookie)
        .send({ topic_id: topicId });
      expect(res.status).toBe(404);
    });

    it('POST /api/admin/categories/:id/topics returns 404 for missing topic', async () => {
      const res = await request(app)
        .post(`/api/admin/categories/${catId}/topics`)
        .set('Cookie', authCookie)
        .send({ topic_id: 99999 });
      expect(res.status).toBe(404);
    });

    it('GET /api/admin/categories/:id includes linked topics', async () => {
      const res = await request(app)
        .get(`/api/admin/categories/${catId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.topics.length).toBe(1);
      expect(res.body.topics[0].name).toBe('Inflation');
    });

    it('GET /api/admin/categories shows correct topic_count', async () => {
      const res = await request(app)
        .get('/api/admin/categories')
        .set('Cookie', authCookie);
      const econ = res.body.categories.find(c => c.name === 'Economy');
      expect(econ.topic_count).toBe(1);
    });

    it('DELETE /api/admin/categories/:id/topics/:topicId unlinks a topic', async () => {
      const res = await request(app)
        .delete(`/api/admin/categories/${catId}/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Verify unlinked
      const get = await request(app)
        .get(`/api/admin/categories/${catId}`)
        .set('Cookie', authCookie);
      expect(get.body.topics.length).toBe(0);
    });

    it('DELETE /api/admin/categories/:id/topics/:topicId returns 404 if not linked', async () => {
      const res = await request(app)
        .delete(`/api/admin/categories/${catId}/topics/${topicId}`)
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    it('Deleting a category cascades to category_topics', async () => {
      // Re-link topic, then delete category
      await request(app)
        .post(`/api/admin/categories/${catId}/topics`)
        .set('Cookie', authCookie)
        .send({ topic_id: topicId });

      await request(app)
        .delete(`/api/admin/categories/${catId}`)
        .set('Cookie', authCookie);

      // Verify category_topics cleaned up
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const rows = db.prepare('SELECT * FROM category_topics WHERE category_id = ?').all(catId);
      expect(rows.length).toBe(0);
    });
  });

  describe('Image and icon support', () => {
    let imgCatId;

    it('POST creates category with null image_url and icon_name by default', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Health' });
      expect(res.status).toBe(201);
      imgCatId = res.body.id;
      // Fetch it back to verify null defaults
      const get = await request(app)
        .get(`/api/admin/categories/${imgCatId}`)
        .set('Cookie', authCookie);
      expect(get.body.category.image_url).toBeNull();
      expect(get.body.category.icon_name).toBeNull();
    });

    it('PUT with image_url updates the category', async () => {
      const res = await request(app)
        .put(`/api/admin/categories/${imgCatId}`)
        .set('Cookie', authCookie)
        .send({ image_url: 'https://example.com/health.jpg' });
      expect(res.status).toBe(200);
      expect(res.body.category.image_url).toBe('https://example.com/health.jpg');
    });

    it('PUT with icon_name updates the category', async () => {
      const res = await request(app)
        .put(`/api/admin/categories/${imgCatId}`)
        .set('Cookie', authCookie)
        .send({ icon_name: 'health_and_safety' });
      expect(res.status).toBe(200);
      expect(res.body.category.icon_name).toBe('health_and_safety');
    });

    it('GET /api/admin/categories returns image_url and icon_name', async () => {
      const res = await request(app)
        .get('/api/admin/categories')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      const health = res.body.categories.find(c => c.name === 'Health');
      expect(health).toBeDefined();
      expect(health.image_url).toBe('https://example.com/health.jpg');
      expect(health.icon_name).toBe('health_and_safety');
    });

    it('PUT with empty image_url clears it to null', async () => {
      const res = await request(app)
        .put(`/api/admin/categories/${imgCatId}`)
        .set('Cookie', authCookie)
        .send({ image_url: '' });
      expect(res.status).toBe(200);
      expect(res.body.category.image_url).toBeNull();
    });

    it('Public GET /api/categories/:id returns image_url and icon_name', async () => {
      // Set image back for this test
      await request(app)
        .put(`/api/admin/categories/${imgCatId}`)
        .set('Cookie', authCookie)
        .send({ image_url: 'https://example.com/health2.jpg' });

      const res = await request(app).get(`/api/categories/${imgCatId}`);
      expect(res.status).toBe(200);
      expect(res.body.category.image_url).toBe('https://example.com/health2.jpg');
      expect(res.body.category.icon_name).toBe('health_and_safety');
    });
  });

  describe('Slug generation', () => {
    it('generates correct slugs from names with special characters', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: 'Arts & Culture' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('arts-culture');
    });

    it('trims leading/trailing hyphens from slugs', async () => {
      const res = await request(app)
        .post('/api/admin/categories')
        .set('Cookie', authCookie)
        .send({ name: '  --Tech--  ' });
      expect(res.status).toBe(201);
      expect(res.body.slug).toBe('tech');
    });
  });
});
