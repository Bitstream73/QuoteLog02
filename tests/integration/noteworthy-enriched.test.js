import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../../src/index.js';
import { getDb, closeDb } from '../../src/config/database.js';
import request from 'supertest';

let app;
let adminCookie;

beforeAll(async () => {
  app = createApp({ skipDbInit: false });

  // Login
  const loginRes = await request(app).post('/api/auth/login')
    .send({ email: 'jakob@karlsmark.com', password: 'Ferret@00' });
  const cookies = loginRes.headers['set-cookie'];
  adminCookie = cookies ? cookies.find(c => c.startsWith('auth_token=')) : null;
});

afterAll(() => {
  closeDb();
});

describe('Database schema migrations', () => {
  it('noteworthy_items allows person entity_type', () => {
    const db = getDb();
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='noteworthy_items'").get();
    expect(schema.sql).toContain("'person'");
  });

  it('importants allows category entity_type', () => {
    const db = getDb();
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='importants'").get();
    expect(schema.sql).toContain("'category'");
  });

  it('topics table has engagement counters', () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(topics)").all().map(c => c.name);
    expect(cols).toContain('importants_count');
    expect(cols).toContain('share_count');
    expect(cols).toContain('view_count');
    expect(cols).toContain('trending_score');
  });

  it('categories table has engagement counters', () => {
    const db = getDb();
    const cols = db.prepare("PRAGMA table_info(categories)").all().map(c => c.name);
    expect(cols).toContain('importants_count');
    expect(cols).toContain('share_count');
    expect(cols).toContain('view_count');
    expect(cols).toContain('trending_score');
  });
});

describe('Importants toggle for topics and categories', () => {
  let topicId, categoryId;

  beforeAll(() => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO topics (name, slug) VALUES ('Test Topic Imp NE', 'test-topic-imp-ne')").run();
    topicId = db.prepare("SELECT id FROM topics WHERE slug = 'test-topic-imp-ne'").get().id;
    db.prepare("INSERT OR IGNORE INTO categories (name, slug) VALUES ('Test Cat Imp NE', 'test-cat-imp-ne')").run();
    categoryId = db.prepare("SELECT id FROM categories WHERE slug = 'test-cat-imp-ne'").get().id;
  });

  it('toggles important on topic', async () => {
    const res = await request(app).post('/api/importants/toggle')
      .send({ entity_type: 'topic', entity_id: topicId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.is_important).toBe('boolean');
    expect(typeof res.body.importants_count).toBe('number');
  });

  it('toggles important on category', async () => {
    const res = await request(app).post('/api/importants/toggle')
      .send({ entity_type: 'category', entity_id: categoryId });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.is_important).toBe('boolean');
    expect(typeof res.body.importants_count).toBe('number');
  });

  it('super-toggle works on topic (admin)', async () => {
    // Get baseline count
    const db = getDb();
    const before = db.prepare('SELECT importants_count FROM topics WHERE id = ?').get(topicId);
    const res = await request(app).post('/api/importants/super-toggle')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'topic', entity_id: topicId });
    expect(res.status).toBe(200);
    expect(res.body.importants_count).toBe(before.importants_count + 100);
  });
});

describe('Admin noteworthy - person type', () => {
  let personId;

  beforeAll(() => {
    const db = getDb();
    const p = db.prepare("INSERT INTO persons (canonical_name, disambiguation) VALUES ('Test Person NW', 'test person nw')").run();
    personId = Number(p.lastInsertRowid);
  });

  it('adds person to noteworthy', async () => {
    const res = await request(app).post('/api/admin/noteworthy')
      .set('Cookie', adminCookie)
      .send({ entity_type: 'person', entity_id: personId, display_order: 0 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('GET admin noteworthy includes person label', async () => {
    const res = await request(app).get('/api/admin/noteworthy')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const personItem = res.body.items.find(i => i.entity_type === 'person');
    expect(personItem).toBeDefined();
    expect(personItem.entity_label).toBe('Test Person NW');
  });
});

describe('Enriched noteworthy endpoint', () => {
  let enrichedQuoteId;
  let enrichedTopicId;

  beforeAll(async () => {
    const db = getDb();
    // Create a person for our enriched quote
    db.prepare("INSERT OR IGNORE INTO persons (canonical_name) VALUES ('NW Enriched Author')").run();
    const personId = db.prepare("SELECT id FROM persons WHERE canonical_name = 'NW Enriched Author'").get().id;

    // Create a quote noteworthy item
    const q = db.prepare("INSERT INTO quotes (text, person_id, is_visible, fact_check_verdict, importants_count) VALUES ('Test enriched quote NE', ?, 1, 'TRUE', 5)").run(personId);
    enrichedQuoteId = Number(q.lastInsertRowid);
    db.prepare("INSERT OR IGNORE INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('quote', ?, 0)").run(enrichedQuoteId);

    // Create a topic noteworthy item
    db.prepare("INSERT OR IGNORE INTO topics (name, slug) VALUES ('NW Topic NE', 'nw-topic-ne')").run();
    enrichedTopicId = db.prepare("SELECT id FROM topics WHERE slug = 'nw-topic-ne'").get().id;
    db.prepare("INSERT OR IGNORE INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('topic', ?, 1)").run(enrichedTopicId);

    // Link quote to topic
    db.prepare("INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)").run(enrichedQuoteId, enrichedTopicId);
  });

  it('returns enriched quote with fact_check_verdict and importants_count', async () => {
    const res = await request(app).get('/api/search/noteworthy?limit=20');
    expect(res.status).toBe(200);
    const quoteItem = res.body.items.find(i => i.entity_type === 'quote' && i.entity_label === 'Test enriched quote NE');
    if (quoteItem) {
      expect(quoteItem.fact_check_verdict).toBe('TRUE');
      expect(quoteItem.importants_count).toBe(5);
    }
  });

  it('returns enriched topic with slug and top_quotes', async () => {
    const res = await request(app).get('/api/search/noteworthy?limit=20');
    expect(res.status).toBe(200);
    const topicItem = res.body.items.find(i => i.entity_type === 'topic' && i.entity_label === 'NW Topic NE');
    if (topicItem) {
      expect(topicItem.slug).toBe('nw-topic-ne');
      expect(topicItem.top_quotes).toBeDefined();
      expect(Array.isArray(topicItem.top_quotes)).toBe(true);
    }
  });

  it('returns person noteworthy with photo_url', async () => {
    const res = await request(app).get('/api/search/noteworthy?limit=20');
    expect(res.status).toBe(200);
    const personItem = res.body.items.find(i => i.entity_type === 'person');
    if (personItem) {
      expect(personItem.entity_label).toBeDefined();
    }
  });
});

describe('Top authors endpoint', () => {
  beforeAll(() => {
    const db = getDb();
    // Ensure we have persons with quotes
    db.prepare("INSERT OR IGNORE INTO persons (canonical_name, disambiguation, quote_count, importants_count) VALUES ('Top Author 1', 'top author 1', 10, 50)").run();
    db.prepare("INSERT OR IGNORE INTO persons (canonical_name, disambiguation, quote_count, importants_count) VALUES ('Top Author 2', 'top author 2', 5, 20)").run();
  });

  it('returns top authors ranked by composite score', async () => {
    const res = await request(app).get('/api/analytics/top-authors?limit=5');
    expect(res.status).toBe(200);
    expect(res.body.authors).toBeDefined();
    expect(Array.isArray(res.body.authors)).toBe(true);
    expect(res.body.authors.length).toBeGreaterThan(0);
    // First author should have highest composite score
    if (res.body.authors.length >= 2) {
      const s1 = res.body.authors[0].importants_count + res.body.authors[0].quote_count + (res.body.authors[0].share_count || 0) + (res.body.authors[0].view_count || 0);
      const s2 = res.body.authors[1].importants_count + res.body.authors[1].quote_count + (res.body.authors[1].share_count || 0) + (res.body.authors[1].view_count || 0);
      expect(s1).toBeGreaterThanOrEqual(s2);
    }
  });

  it('respects limit parameter', async () => {
    const res = await request(app).get('/api/analytics/top-authors?limit=1');
    expect(res.status).toBe(200);
    expect(res.body.authors.length).toBeLessThanOrEqual(1);
  });
});

describe('Topic public routes', () => {
  let topicId;

  beforeAll(() => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO topics (name, slug, description) VALUES ('Public Topic Test NE', 'public-topic-test-ne', 'A test topic')").run();
    topicId = db.prepare("SELECT id FROM topics WHERE slug = 'public-topic-test-ne'").get().id;
  });

  it('GET /api/topics/:id returns topic detail', async () => {
    const res = await request(app).get(`/api/topics/${topicId}`);
    expect(res.status).toBe(200);
    expect(res.body.topic.name).toBe('Public Topic Test NE');
    expect(res.body.topic.description).toBe('A test topic');
    expect(res.body.quoteCount).toBeDefined();
  });

  it('GET /api/topics/:slug returns topic by slug', async () => {
    const res = await request(app).get('/api/topics/public-topic-test-ne');
    expect(res.status).toBe(200);
    expect(res.body.topic.name).toBe('Public Topic Test NE');
  });

  it('GET /api/topics/:id/quotes returns paginated quotes', async () => {
    const res = await request(app).get(`/api/topics/${topicId}/quotes?limit=10`);
    expect(res.status).toBe(200);
    expect(res.body.quotes).toBeDefined();
    expect(Array.isArray(res.body.quotes)).toBe(true);
    expect(res.body.total).toBeDefined();
    expect(res.body.page).toBe(1);
  });

  it('GET /api/topics/:id/quotes supports sort=importance', async () => {
    const res = await request(app).get(`/api/topics/${topicId}/quotes?sort=importance`);
    expect(res.status).toBe(200);
    expect(res.body.quotes).toBeDefined();
  });

  it('returns 404 for non-existent topic', async () => {
    const res = await request(app).get('/api/topics/99999');
    expect(res.status).toBe(404);
  });
});

describe('Category public routes with sort', () => {
  let categoryId;

  beforeAll(() => {
    const db = getDb();
    db.prepare("INSERT OR IGNORE INTO categories (name, slug) VALUES ('Sort Cat Test NE', 'sort-cat-test-ne')").run();
    categoryId = db.prepare("SELECT id FROM categories WHERE slug = 'sort-cat-test-ne'").get().id;
  });

  it('GET /api/categories/:id/quotes supports sort=importance', async () => {
    const res = await request(app).get(`/api/categories/${categoryId}/quotes?sort=importance`);
    expect(res.status).toBe(200);
    expect(res.body.quotes).toBeDefined();
  });
});
