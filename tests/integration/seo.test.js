import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/index.js';
import { getDb } from '../../src/config/database.js';

let app;
let testQuoteId;
let testPersonId;
let testArticleId;
let testPersonName;

beforeAll(() => {
  app = createApp();
  const db = getDb();

  // Ensure we have test data
  const person = db.prepare('SELECT id, canonical_name FROM persons LIMIT 1').get();
  if (person) {
    testPersonId = person.id;
    testPersonName = person.canonical_name;
  }

  const quote = db.prepare(`
    SELECT q.id FROM quotes q
    WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL
    LIMIT 1
  `).get();
  if (quote) testQuoteId = quote.id;

  const article = db.prepare('SELECT id FROM articles LIMIT 1').get();
  if (article) testArticleId = article.id;
});

// Phase 1: Compression
describe('Phase 1: Compression', () => {
  it('should return Content-Encoding header on HTML response', async () => {
    const res = await request(app)
      .get('/')
      .set('Accept-Encoding', 'gzip, deflate, br');
    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeTruthy();
  });
});

// Phase 2: robots.txt + sitemap.xml
describe('Phase 2: robots.txt', () => {
  it('should return text/plain content type', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
  });

  it('should contain correct Allow directives', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.text).toContain('Allow: /');
    expect(res.text).toContain('Allow: /quote/*');
    expect(res.text).toContain('Allow: /author/*');
    expect(res.text).toContain('Allow: /article/*');
    expect(res.text).toContain('Allow: /analytics');
  });

  it('should contain correct Disallow directives', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.text).toContain('Disallow: /api/');
    expect(res.text).toContain('Disallow: /login');
    expect(res.text).toContain('Disallow: /settings');
    expect(res.text).toContain('Disallow: /review');
    expect(res.text).toContain('Disallow: /admin');
    expect(res.text).toContain('Disallow: /forgot-password');
    expect(res.text).toContain('Disallow: /reset-password');
  });

  it('should contain Sitemap directive', async () => {
    const res = await request(app).get('/robots.txt');
    expect(res.text).toMatch(/Sitemap:.*\/sitemap\.xml/);
  });
});

describe('Phase 2: sitemap.xml', () => {
  it('should return valid XML with urlset', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.text).toContain('<?xml version="1.0"');
    expect(res.text).toContain('<urlset');
    expect(res.text).toContain('</urlset>');
  });

  it('should contain homepage URL', async () => {
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toMatch(/<loc>.*\/<\/loc>/);
  });

  it('should contain quote URLs if quotes exist', async () => {
    if (!testQuoteId) return;
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('/quote/');
  });

  it('should contain author URLs if authors exist', async () => {
    if (!testPersonId) return;
    const res = await request(app).get('/sitemap.xml');
    expect(res.text).toContain('/author/');
  });
});

// Phase 3: Server-side meta tags
describe('Phase 3: Server-side meta tags', () => {
  it('homepage should have og:title and canonical', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('TrueOrFalse.News');
    expect(res.text).toContain('rel="canonical"');
  });

  it('analytics page should have og:title and canonical', async () => {
    const res = await request(app).get('/analytics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('Analytics');
    expect(res.text).toContain('rel="canonical"');
  });

  it('quote page should have og:title, canonical, and share image', async () => {
    if (!testQuoteId) return;
    const res = await request(app).get(`/quote/${testQuoteId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('rel="canonical"');
    expect(res.text).toContain('og:image');
    expect(res.text).toContain('share-image');
  });

  it('author page should have og:title and canonical', async () => {
    if (!testPersonId) return;
    const res = await request(app).get(`/author/${testPersonId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('rel="canonical"');
    expect(res.text).toContain('Quotes');
  });

  it('article page should have og:title and canonical', async () => {
    if (!testArticleId) return;
    const res = await request(app).get(`/article/${testArticleId}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('og:title');
    expect(res.text).toContain('rel="canonical"');
  });

  it('non-existent quote should serve default HTML without crash', async () => {
    const res = await request(app).get('/quote/999999999');
    expect(res.status).toBe(200);
    expect(res.text).toContain('TrueOrFalse.News');
  });

  it('non-existent author should serve default HTML without crash', async () => {
    const res = await request(app).get('/author/999999999');
    expect(res.status).toBe(200);
    expect(res.text).toContain('TrueOrFalse.News');
  });
});

// Phase 5: Author URL deduplication
describe('Phase 5: Author URL deduplication', () => {
  it('should 301 redirect name-based author URL to numeric URL', async () => {
    if (!testPersonName) return;
    const res = await request(app)
      .get(`/author/${encodeURIComponent(testPersonName)}`)
      .redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`/author/${testPersonId}`);
  });

  it('should serve default HTML for numeric author that does not exist (no redirect)', async () => {
    const res = await request(app).get('/author/999999999');
    expect(res.status).toBe(200);
    // Should be regular HTML (not a redirect)
    expect(res.text).toContain('TrueOrFalse.News');
  });

  it('API should 301 redirect name-based author lookup', async () => {
    if (!testPersonName) return;
    const res = await request(app)
      .get(`/api/authors/${encodeURIComponent(testPersonName)}`)
      .redirects(0);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(`/api/authors/${testPersonId}`);
  });
});

// Phase 6: JSON-LD structured data
describe('Phase 6: JSON-LD structured data', () => {
  it('homepage should have WebSite JSON-LD with SearchAction', async () => {
    const res = await request(app).get('/');
    expect(res.text).toContain('application/ld+json');
    // Extract and parse the JSON-LD
    const match = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsonLd = JSON.parse(match[1]);
    expect(jsonLd['@type']).toBe('WebSite');
    expect(jsonLd.potentialAction['@type']).toBe('SearchAction');
  });

  it('quote page should have Quotation JSON-LD', async () => {
    if (!testQuoteId) return;
    const res = await request(app).get(`/quote/${testQuoteId}`);
    const match = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsonLd = JSON.parse(match[1]);
    expect(jsonLd['@type']).toBe('Quotation');
    expect(jsonLd.text).toBeTruthy();
    expect(jsonLd.creator).toBeTruthy();
    expect(jsonLd.creator['@type']).toBe('Person');
  });

  it('author page should have Person JSON-LD', async () => {
    if (!testPersonId) return;
    const res = await request(app).get(`/author/${testPersonId}`);
    const match = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsonLd = JSON.parse(match[1]);
    expect(jsonLd['@type']).toBe('Person');
    expect(jsonLd.name).toBeTruthy();
  });

  it('article page should have Article JSON-LD', async () => {
    if (!testArticleId) return;
    const res = await request(app).get(`/article/${testArticleId}`);
    const match = res.text.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(match).toBeTruthy();
    const jsonLd = JSON.parse(match[1]);
    expect(jsonLd['@type']).toBe('Article');
  });
});
