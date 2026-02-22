import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/topic-orphans-test.db';

describe('Topic Orphans API', () => {
  let app;
  let authCookie;

  beforeAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();
    db.prepare('DELETE FROM category_topics').run();
    db.prepare('DELETE FROM topic_keywords').run();
    db.prepare('DELETE FROM quote_topics').run();
    db.prepare('DELETE FROM topic_aliases').run();
    db.prepare('DELETE FROM topics').run();
    db.prepare('DELETE FROM categories').run();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/topic-orphans-test.db');
      fs.unlinkSync('./tests/topic-orphans-test.db-wal');
      fs.unlinkSync('./tests/topic-orphans-test.db-shm');
    } catch {}
  });

  it('GET /api/admin/topics/orphans returns 401 without auth', async () => {
    const res = await request(app).get('/api/admin/topics/orphans');
    expect(res.status).toBe(401);
  });

  it('returns empty when all topics have categories', async () => {
    const res = await request(app)
      .get('/api/admin/topics/orphans')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.topics).toEqual([]);
    expect(res.body.count).toBe(0);
  });

  it('returns only unlinked topics', async () => {
    // Create two topics
    const t1 = await request(app)
      .post('/api/admin/topics')
      .set('Cookie', authCookie)
      .send({ name: 'Orphan Topic', status: 'active' });
    expect(t1.status).toBe(201);
    const orphanId = t1.body.id;

    const t2 = await request(app)
      .post('/api/admin/topics')
      .set('Cookie', authCookie)
      .send({ name: 'Linked Topic', status: 'active' });
    expect(t2.status).toBe(201);
    const linkedId = t2.body.id;

    // Create a category and link second topic
    const cat = await request(app)
      .post('/api/admin/categories')
      .set('Cookie', authCookie)
      .send({ name: 'Test Category', sort_order: 1 });
    expect(cat.status).toBe(201);
    const catId = cat.body.id;

    const link = await request(app)
      .post(`/api/admin/categories/${catId}/topics`)
      .set('Cookie', authCookie)
      .send({ topic_id: linkedId });
    expect(link.status).toBe(201);

    // Fetch orphans — only the unlinked topic should appear
    const res = await request(app)
      .get('/api/admin/topics/orphans')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.topics.length).toBe(1);
    expect(res.body.topics[0].id).toBe(orphanId);
    expect(res.body.topics[0].name).toBe('Orphan Topic');
  });

  it('response includes keyword_count and quote_count fields', async () => {
    const res = await request(app)
      .get('/api/admin/topics/orphans')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.topics.length).toBeGreaterThan(0);
    const topic = res.body.topics[0];
    expect(topic).toHaveProperty('keyword_count');
    expect(topic).toHaveProperty('quote_count');
    expect(typeof topic.keyword_count).toBe('number');
    expect(typeof topic.quote_count).toBe('number');
  });

  it('count field matches array length', async () => {
    const res = await request(app)
      .get('/api/admin/topics/orphans')
      .set('Cookie', authCookie);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.topics.length);
  });

  it('after assigning a topic to a category, it no longer appears as orphan', async () => {
    // Get orphan list first
    const before = await request(app)
      .get('/api/admin/topics/orphans')
      .set('Cookie', authCookie);
    expect(before.body.topics.length).toBeGreaterThan(0);
    const orphanId = before.body.topics[0].id;

    // Get a category to assign to
    const cats = await request(app)
      .get('/api/admin/categories')
      .set('Cookie', authCookie);
    const catId = cats.body.categories[0].id;

    // Assign
    const assign = await request(app)
      .post(`/api/admin/categories/${catId}/topics`)
      .set('Cookie', authCookie)
      .send({ topic_id: orphanId });
    expect(assign.status).toBe(201);

    // Verify it's gone from orphans
    const after = await request(app)
      .get('/api/admin/topics/orphans')
      .set('Cookie', authCookie);
    const ids = after.body.topics.map(t => t.id);
    expect(ids).not.toContain(orphanId);
    expect(after.body.count).toBe(after.body.topics.length);
  });
});
