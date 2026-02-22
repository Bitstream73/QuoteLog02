import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/source-author-autolink-test.db';

describe('Source Author Auto-Link', () => {
  let app;
  let db;
  let authCookie;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();

    // Login
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'jakob@karlsmark.com', password: 'Ferret@00' });
    const cookies = loginRes.headers['set-cookie'];
    authCookie = cookies.find(c => c.startsWith('auth_token='));
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/source-author-autolink-test.db${suffix}`); } catch {}
    }
  });

  it('creates source_author and links when adding a new source', async () => {
    const testDomain = 'autolink-test-' + Date.now() + '.com';
    const res = await request(app)
      .post('/api/sources')
      .set('Cookie', authCookie)
      .send({ domain: testDomain, name: 'Autolink Test', rss_url: 'https://' + testDomain + '/rss' });

    expect(res.status).toBe(201);
    const sourceId = res.body.source.id;

    // Check source_author was created
    const sa = db.prepare('SELECT * FROM source_authors WHERE domain = ?').get(testDomain);
    expect(sa).toBeDefined();
    expect(sa.name.charAt(0)).toBe(sa.name.charAt(0).toUpperCase()); // Capitalized

    // Check source is linked
    const source = db.prepare('SELECT source_author_id FROM sources WHERE id = ?').get(sourceId);
    expect(source.source_author_id).toBe(sa.id);

    // Cleanup
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    db.prepare('DELETE FROM source_authors WHERE id = ?').run(sa.id);
  });

  it('reuses existing source_author for same domain', async () => {
    const testDomain = 'reuse-test-' + Date.now() + '.com';

    // Pre-create source_author
    db.prepare('INSERT INTO source_authors (name, domain) VALUES (?, ?)').run('ExistingOrg', testDomain);
    const existingSa = db.prepare('SELECT id FROM source_authors WHERE domain = ?').get(testDomain);

    // Add a source with same domain
    const res = await request(app)
      .post('/api/sources')
      .set('Cookie', authCookie)
      .send({ domain: testDomain, name: 'Reuse Test Feed', rss_url: 'https://' + testDomain + '/feed' });

    expect(res.status).toBe(201);
    const sourceId = res.body.source.id;

    // Should link to existing source_author
    const source = db.prepare('SELECT source_author_id FROM sources WHERE id = ?').get(sourceId);
    expect(source.source_author_id).toBe(existingSa.id);

    // Should not create a duplicate
    const count = db.prepare('SELECT COUNT(*) as count FROM source_authors WHERE domain = ?').get(testDomain).count;
    expect(count).toBe(1);

    // Cleanup
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    db.prepare('DELETE FROM source_authors WHERE id = ?').run(existingSa.id);
  });

  it('quote detail endpoint returns source_author data', async () => {
    // Create test data chain: source_author -> source -> article -> quote_articles -> quote -> person
    db.prepare('INSERT OR IGNORE INTO source_authors (name, domain, image_url) VALUES (?, ?, ?)').run('DetailTestOrg', 'detailtest.com', 'https://example.com/logo.jpg');
    const sa = db.prepare("SELECT id FROM source_authors WHERE domain = 'detailtest.com'").get();

    const srcResult = db.prepare('INSERT INTO sources (domain, name, rss_url, source_author_id) VALUES (?, ?, ?, ?)').run('detailtest.com', 'Detail Test', 'https://detailtest.com/rss', sa.id);
    const sourceId = srcResult.lastInsertRowid;

    const personResult = db.prepare("INSERT INTO persons (canonical_name) VALUES ('Detail Test Person')").run();
    const personId = personResult.lastInsertRowid;

    const artResult = db.prepare("INSERT INTO articles (url, title, source_id, status) VALUES (?, ?, ?, 'completed')").run('https://detailtest.com/article1', 'Test Article', sourceId);
    const articleId = artResult.lastInsertRowid;

    const quoteResult = db.prepare("INSERT INTO quotes (person_id, text, source_urls) VALUES (?, ?, '[]')").run(personId, 'Detail test quote text');
    const quoteId = quoteResult.lastInsertRowid;

    db.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(quoteId, articleId);

    // Fetch quote detail
    const res = await request(app).get(`/api/quotes/${quoteId}`);
    expect(res.status).toBe(200);
    expect(res.body.articles).toHaveLength(1);
    expect(res.body.articles[0].source_author_id).toBe(sa.id);
    expect(res.body.articles[0].source_author_name).toBe('DetailTestOrg');
    expect(res.body.articles[0].source_author_image_url).toBe('https://example.com/logo.jpg');

    // Cleanup
    db.prepare('DELETE FROM quote_articles WHERE quote_id = ?').run(quoteId);
    db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);
    db.prepare('DELETE FROM articles WHERE id = ?').run(articleId);
    db.prepare('DELETE FROM persons WHERE id = ?').run(personId);
    db.prepare('DELETE FROM sources WHERE id = ?').run(sourceId);
    db.prepare("DELETE FROM source_authors WHERE domain = 'detailtest.com'").run();
  });
});
