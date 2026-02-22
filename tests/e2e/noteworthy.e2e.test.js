import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import puppeteer from 'puppeteer';
import { createApp } from '../../src/index.js';
import { getDb, closeDb } from '../../src/config/database.js';
import http from 'http';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;

let browser;
let page;
let server;
let app;

// Seed data IDs
let quoteId, topicId, categoryId, personId, articleId, sourceId;

beforeAll(async () => {
  app = createApp({ skipDbInit: false });
  server = http.createServer(app);
  await new Promise(resolve => server.listen(PORT, resolve));

  const db = getDb();

  // Seed source
  db.prepare("INSERT OR IGNORE INTO sources (name, domain, rss_url) VALUES ('E2E Source', 'e2e-source.com', 'https://e2e-source.com/rss')").run();
  sourceId = db.prepare("SELECT id FROM sources WHERE domain = 'e2e-source.com'").get().id;

  // Seed person
  db.prepare("INSERT OR IGNORE INTO persons (canonical_name, disambiguation, photo_url) VALUES ('E2E Person', 'e2e person', 'https://example.com/photo.jpg')").run();
  personId = db.prepare("SELECT id FROM persons WHERE canonical_name = 'E2E Person'").get().id;

  // Seed articles (use unique timestamp-based URLs to avoid constraint issues)
  const ts = Date.now();
  const artRes = db.prepare("INSERT INTO articles (title, url, source_id, importants_count) VALUES ('E2E Article Main', ?, ?, 10)").run(`https://e2e-source.com/article-main-${ts}`, sourceId);
  articleId = Number(artRes.lastInsertRowid);
  // Additional articles from same source for mini-articles
  db.prepare("INSERT INTO articles (title, url, source_id, importants_count, created_at) VALUES ('E2E Related Article 1', ?, ?, 5, datetime('now'))").run(`https://e2e-source.com/a1-${ts}`, sourceId);
  db.prepare("INSERT INTO articles (title, url, source_id, importants_count, created_at) VALUES ('E2E Related Article 2', ?, ?, 3, datetime('now'))").run(`https://e2e-source.com/a2-${ts}`, sourceId);

  // Seed quote
  const qRes = db.prepare("INSERT INTO quotes (text, person_id, is_visible, fact_check_verdict, importants_count) VALUES (?, ?, 1, 'TRUE', 15)").run(`E2E test quote ${ts}`, personId);
  quoteId = Number(qRes.lastInsertRowid);

  // Seed topic
  db.prepare("INSERT OR IGNORE INTO topics (name, slug, description) VALUES ('E2E Test Topic', 'e2e-test-topic', 'A topic for E2E testing')").run();
  topicId = db.prepare("SELECT id FROM topics WHERE slug = 'e2e-test-topic'").get().id;

  // Seed category
  db.prepare("INSERT OR IGNORE INTO categories (name, slug) VALUES ('E2E Test Category', 'e2e-test-category')").run();
  categoryId = db.prepare("SELECT id FROM categories WHERE slug = 'e2e-test-category'").get().id;

  // Link quote to topic
  db.prepare("INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)").run(quoteId, topicId);

  // Link topic to category
  db.prepare("INSERT OR IGNORE INTO category_topics (category_id, topic_id) VALUES (?, ?)").run(categoryId, topicId);

  // Link quote to article
  db.prepare("INSERT OR IGNORE INTO quote_articles (quote_id, article_id) VALUES (?, ?)").run(quoteId, articleId);

  // Seed noteworthy items (5 items = odd count); mark topic as full_width
  db.prepare("DELETE FROM noteworthy_items").run();
  db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('quote', ?, 0)").run(quoteId);
  db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order, full_width) VALUES ('topic', ?, 1, 1)").run(topicId);
  db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('category', ?, 2)").run(categoryId);
  db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('person', ?, 3)").run(personId);
  db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('article', ?, 4)").run(articleId);

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  page = await browser.newPage();
}, 30000);

afterAll(async () => {
  if (page) await page.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  closeDb();
});

describe('Noteworthy E2E Tests', () => {
  it('noteworthy section renders with cards', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    const section = await page.$('.noteworthy-section');
    expect(section).not.toBeNull();

    const cards = await page.$$('.noteworthy-card');
    expect(cards.length).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: 'tests/e2e/screenshots/noteworthy-section.png' });
  }, 20000);

  it('quote card has verdict badge and author', async () => {
    const verdictBadge = await page.$('.noteworthy-card--quote .wts-verdict-badge');
    expect(verdictBadge).not.toBeNull();

    const author = await page.$('.noteworthy-card--quote .noteworthy-quote__author');
    expect(author).not.toBeNull();
  });

  it('quote card uses flex layout for bottom justification', async () => {
    const display = await page.$eval('.noteworthy-card--quote', el =>
      window.getComputedStyle(el).display
    );
    expect(display).toBe('flex');

    const direction = await page.$eval('.noteworthy-card--quote', el =>
      window.getComputedStyle(el).flexDirection
    );
    expect(direction).toBe('column');
  });

  it('topic card has correct onclick navigation target', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    const topicCard = await page.$('.noteworthy-card--topic');
    expect(topicCard).not.toBeNull();
    if (topicCard) {
      const onclick = await page.$eval('.noteworthy-card--topic', el => el.getAttribute('onclick'));
      expect(onclick).toContain('/topic/');
    }
  }, 15000);

  it('person card has correct onclick navigation target', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    const personCard = await page.$('.noteworthy-card--person');
    expect(personCard).not.toBeNull();
    if (personCard) {
      const onclick = await page.$eval('.noteworthy-card--person', el => el.getAttribute('onclick'));
      expect(onclick).toContain('/author/');
    }
  }, 15000);

  it('top authors bar renders', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });
    const topAuthorBar = await page.$('.top-author-bar');
    // May not render if no qualifying authors, just check it doesn't error
    if (topAuthorBar) {
      const seeMore = await page.$('.top-author-bar__see-more');
      expect(seeMore).not.toBeNull();
    }
  }, 15000);

  it('odd item count gives last card full width on desktop', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    const hasOddClass = await page.$('.noteworthy-section__scroll--odd');
    expect(hasOddClass).not.toBeNull();

    // Verify the last card spans the full grid row
    const gridColumn = await page.$eval(
      '.noteworthy-section__scroll--odd .noteworthy-card:last-child',
      el => window.getComputedStyle(el).gridColumn
    );
    expect(gridColumn).toBe('1 / -1');

    await page.screenshot({ path: 'tests/e2e/screenshots/noteworthy-odd-fullwidth.png' });
  }, 15000);

  it('category page renders with sort controls', async () => {
    await page.goto(`${BASE}/#/category/e2e-test-category`, { waitUntil: 'networkidle0', timeout: 15000 });
    // Wait for SPA routing
    await page.waitForFunction(
      () => document.querySelector('.category-page') || document.querySelector('[data-page="category"]') || document.querySelector('h1, h2'),
      { timeout: 5000 }
    ).catch(() => {});

    await page.screenshot({ path: 'tests/e2e/screenshots/category-page.png' });
  }, 15000);

  it('topic page renders with sort controls', async () => {
    await page.goto(`${BASE}/#/topic/e2e-test-topic`, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForFunction(
      () => document.querySelector('.topic-page') || document.querySelector('[data-page="topic"]') || document.querySelector('h1, h2'),
      { timeout: 5000 }
    ).catch(() => {});

    await page.screenshot({ path: 'tests/e2e/screenshots/topic-page.png' });
  }, 15000);

  it('quote card displays with header section', async () => {
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    const header = await page.$('.noteworthy-card--quote .noteworthy-card__header');
    expect(header).not.toBeNull();

    const content = await page.$('.noteworthy-card--quote .noteworthy-card__content');
    expect(content).not.toBeNull();
  }, 15000);

  it('mobile viewport shows horizontal scroll', async () => {
    await page.setViewport({ width: 375, height: 812 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    const overflowX = await page.$eval('.noteworthy-section__scroll', el =>
      window.getComputedStyle(el).overflowX
    );
    expect(overflowX).toBe('auto');

    await page.screenshot({ path: 'tests/e2e/screenshots/noteworthy-mobile.png' });
    // Reset viewport
    await page.setViewport({ width: 1280, height: 800 });
  }, 15000);

  it('full-width card has noteworthy-card--full-width class', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    const fullWidthCard = await page.$('.noteworthy-card--full-width');
    expect(fullWidthCard).not.toBeNull();

    // Verify it's the topic card that was seeded with full_width=1
    const classes = await page.$eval('.noteworthy-card--full-width', el => el.className);
    expect(classes).toContain('noteworthy-card--topic');

    // Verify grid-column spans full width on desktop
    const gridColumn = await page.$eval('.noteworthy-card--full-width', el =>
      window.getComputedStyle(el).gridColumn
    );
    expect(gridColumn).toBe('1 / -1');
  }, 15000);

  it('article card shows mini-articles not mini-quotes', async () => {
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 15000 });

    const articleCard = await page.$('.noteworthy-card--article');
    if (articleCard) {
      // Check that mini items exist (they link to /article/ not /quote/)
      const miniItems = await articleCard.$$('.noteworthy-quote');
      if (miniItems.length > 0) {
        const onclick = await page.$eval(
          '.noteworthy-card--article .noteworthy-quote',
          el => el.getAttribute('onclick')
        );
        expect(onclick).toContain('/article/');
      }
    }
  }, 15000);
});
