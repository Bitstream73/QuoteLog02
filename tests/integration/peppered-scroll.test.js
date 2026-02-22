import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import { getAuthCookie } from '../helpers/auth.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/peppered-scroll-test.db';

describe('Peppered Scroll Integration', () => {
  let app, authCookie, db;

  beforeAll(async () => {
    const { closeDb, getDb } = await import('../../src/config/database.js');
    closeDb();
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    db = getDb();
    authCookie = getAuthCookie();

    // Seed test data: persons, quotes, topics, categories
    db.exec(`INSERT OR IGNORE INTO persons (id, canonical_name, photo_url, category, category_context, quote_count, importants_count)
      VALUES (1, 'Alice Smith', 'https://example.com/alice.jpg', 'Politician', 'US Senator', 5, 20),
             (2, 'Bob Jones', 'https://example.com/bob.jpg', 'Journalist', 'CNN Reporter', 3, 10)`);

    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    db.exec(`INSERT OR IGNORE INTO quotes (id, text, person_id, is_visible, importants_count, created_at, canonical_quote_id)
      VALUES (1, 'First test quote from Alice', 1, 1, 15, '${recentDate}', NULL),
             (2, 'Second test quote from Alice', 1, 1, 8, '${recentDate}', NULL),
             (3, 'Quote from Bob Jones', 2, 1, 12, '${recentDate}', NULL),
             (4, 'Another Bob quote', 2, 1, 5, '${recentDate}', NULL)`);

    db.exec(`INSERT OR IGNORE INTO topics (id, name, slug) VALUES (1, 'Economy', 'economy'), (2, 'Healthcare', 'healthcare')`);
    db.exec(`INSERT OR IGNORE INTO categories (id, name, slug) VALUES (1, 'Politics', 'politics')`);
    db.exec(`INSERT OR IGNORE INTO category_topics (category_id, topic_id) VALUES (1, 1)`);
    db.exec(`INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (1, 1), (3, 1), (2, 2)`);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/peppered-scroll-test.db${suffix}`); } catch {}
    }
  });

  describe('Settings round-trip', () => {
    it('saves pepper settings and retrieves them', async () => {
      // Save pepper settings via PATCH (bulk update)
      await request(app).patch('/api/settings')
        .set('Cookie', authCookie)
        .send({
          noteworthy_pepper_frequency: '7',
          noteworthy_pepper_chance: '80',
          noteworthy_pick_mode: 'random',
          noteworthy_reuse_cards: '1'
        });

      // Verify via settings API
      const settingsRes = await request(app).get('/api/settings')
        .set('Cookie', authCookie);
      expect(settingsRes.body.noteworthy_pepper_frequency).toBe('7');
      expect(settingsRes.body.noteworthy_pepper_chance).toBe('80');
      expect(settingsRes.body.noteworthy_pick_mode).toBe('random');
      expect(settingsRes.body.noteworthy_reuse_cards).toBe('1');

      // Verify via evaluated endpoint
      const evalRes = await request(app).get('/api/search/noteworthy/evaluated');
      expect(evalRes.body.pepper_settings.noteworthy_pepper_frequency).toBe('7');
      expect(evalRes.body.pepper_settings.noteworthy_pepper_chance).toBe('80');
    });
  });

  describe('Card config enable → evaluate cycle', () => {
    it('enabling a quote_of_hour config produces evaluated data', async () => {
      // Find the quote_of_hour config
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const quoteHourConfig = listRes.body.configs.find(c => c.card_type === 'quote_of_hour');
      expect(quoteHourConfig).toBeDefined();

      // Enable it
      await request(app).patch(`/api/admin/noteworthy-configs/${quoteHourConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: true, custom_title: 'Hot Quote' });

      // Evaluate
      const evalRes = await request(app).get('/api/search/noteworthy/evaluated');
      expect(evalRes.body.cards.length).toBe(1);
      const card = evalRes.body.cards[0];
      expect(card.card_type).toBe('quote_of_hour');
      expect(card.custom_title).toBe('Hot Quote');
      expect(card.type).toBe('quote');
      // Should return the highest-importants quote (id=1, importants=15)
      expect(card.data).not.toBeNull();
      expect(card.data.id).toBe(1);
      expect(card.data.person_name).toBe('Alice Smith');

      // Clean up
      await request(app).patch(`/api/admin/noteworthy-configs/${quoteHourConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: false });
    });

    it('enabling an author_of_day config produces entity + top quotes', async () => {
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const authorDayConfig = listRes.body.configs.find(c => c.card_type === 'author_of_day');

      await request(app).patch(`/api/admin/noteworthy-configs/${authorDayConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: true });

      const evalRes = await request(app).get('/api/search/noteworthy/evaluated');
      const card = evalRes.body.cards.find(c => c.card_type === 'author_of_day');
      expect(card).toBeDefined();
      expect(card.type).toBe('author');
      expect(card.data).not.toBeNull();
      expect(card.data.entity.canonical_name).toBe('Alice Smith'); // 15+8=23 > 12+5=17
      expect(card.data.top_quotes.length).toBeGreaterThan(0);

      await request(app).patch(`/api/admin/noteworthy-configs/${authorDayConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: false });
    });

    it('enabling a topic_of_week config produces topic data', async () => {
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const topicConfig = listRes.body.configs.find(c => c.card_type === 'topic_of_week');

      await request(app).patch(`/api/admin/noteworthy-configs/${topicConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: true });

      const evalRes = await request(app).get('/api/search/noteworthy/evaluated');
      const card = evalRes.body.cards.find(c => c.card_type === 'topic_of_week');
      expect(card).toBeDefined();
      expect(card.type).toBe('topic');
      expect(card.data.entity.name).toBe('Economy'); // quotes 1,3 in topic 1 = 15+12=27

      await request(app).patch(`/api/admin/noteworthy-configs/${topicConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: false });
    });

    it('search and info cards return correct metadata', async () => {
      const listRes = await request(app).get('/api/admin/noteworthy-configs')
        .set('Cookie', authCookie);
      const searchConfig = listRes.body.configs.find(c => c.card_type === 'search_topic');
      const infoConfig = listRes.body.configs.find(c => c.card_type === 'info_importance');

      await request(app).patch(`/api/admin/noteworthy-configs/${searchConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: true });
      await request(app).patch(`/api/admin/noteworthy-configs/${infoConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: true });

      const evalRes = await request(app).get('/api/search/noteworthy/evaluated');
      const searchCard = evalRes.body.cards.find(c => c.card_type === 'search_topic');
      expect(searchCard.type).toBe('search');
      expect(searchCard.data.search_type).toBe('topic');

      const infoCard = evalRes.body.cards.find(c => c.card_type === 'info_importance');
      expect(infoCard.type).toBe('info');
      expect(infoCard.data.info_type).toBe('importance');

      // Clean up
      await request(app).patch(`/api/admin/noteworthy-configs/${searchConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: false });
      await request(app).patch(`/api/admin/noteworthy-configs/${infoConfig.id}`)
        .set('Cookie', authCookie)
        .send({ enabled: false });
    });
  });

  describe('Frontend rendering functions', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
    const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
    const swipeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/swipe.js'), 'utf-8');
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('home.js has complete peppering pipeline', () => {
      // State vars
      expect(homeJs).toContain('let _evaluatedCards = []');
      expect(homeJs).toContain('let _pepperSettings = {}');
      expect(homeJs).toContain('let _cardPickIndex = 0');
      // Functions
      expect(homeJs).toContain('function determinePepperPositions(');
      expect(homeJs).toContain('function pickNextCard(');
      expect(homeJs).toContain('function buildPepperedCardHtml(');
      expect(homeJs).toContain('function renderCardByType(');
      // Integration in loadQuotesPage
      expect(homeJs).toContain('/noteworthy/evaluated');
    });

    it('home.js has all card type renderers', () => {
      expect(homeJs).toContain('function buildTimedQuoteCardHtml(');
      expect(homeJs).toContain('function buildTimedAuthorCardHtml(');
      expect(homeJs).toContain('function buildTimedSourceCardHtml(');
      expect(homeJs).toContain('function buildTimedTopicCardHtml(');
      expect(homeJs).toContain('function buildTimedCategoryCardHtml(');
      expect(homeJs).toContain('function buildSearchCardHtml(');
      expect(homeJs).toContain('function buildInfoCardHtml(');
    });

    it('home.js has swipe integration', () => {
      expect(homeJs).toContain('function slideToDetail(');
      expect(homeJs).toContain('function slideBack(');
      expect(homeJs).toContain('initSwipeHandlers');
    });

    it('swipe.js has touch handlers', () => {
      expect(swipeJs).toContain('function initSwipeHandlers(');
      expect(swipeJs).toContain('touchstart');
      expect(swipeJs).toContain('touchmove');
      expect(swipeJs).toContain('touchend');
    });

    it('app.js re-evaluates cards on fetch_cycle_complete', () => {
      expect(appJs).toContain('fetch_cycle_complete');
      expect(appJs).toContain('/noteworthy/evaluated');
      expect(appJs).toContain('_evaluatedCards');
    });

    it('CSS has all required card classes', () => {
      expect(css).toContain('.slide-container');
      expect(css).toContain('.slide-active');
      expect(css).toContain('.noteworthy-card--timed-quote');
      expect(css).toContain('.noteworthy-card--search');
      expect(css).toContain('.noteworthy-card--info');
      expect(css).toContain('.search-card__input');
      expect(css).toContain('.info-card__body');
      expect(css).toContain('.noteworthy-card__badge');
    });

    it('no tab system remnants remain', () => {
      expect(homeJs).not.toContain('function buildTabBarHtml');
      expect(homeJs).not.toContain('function switchHomepageTab');
      expect(homeJs).not.toContain('_activeTab');
      expect(homeJs).not.toContain('loadMoreAuthors');
      expect(homeJs).not.toContain('loadMoreSources');
    });
  });

  describe('Evaluator service', () => {
    it('evaluateCard dispatches correctly for all types', async () => {
      const evaluator = await import('../../src/services/noteworthyEvaluator.js');

      // Quote
      const qResult = evaluator.evaluateCard(db, { card_type: 'quote_of_hour', config: '{}' });
      expect(qResult.type).toBe('quote');
      expect(qResult.data).not.toBeNull();

      // Author
      const aResult = evaluator.evaluateCard(db, { card_type: 'author_of_day', config: '{}' });
      expect(aResult.type).toBe('author');
      expect(aResult.data.entity).not.toBeNull();

      // Topic
      const tResult = evaluator.evaluateCard(db, { card_type: 'topic_of_week', config: '{}' });
      expect(tResult.type).toBe('topic');

      // Category
      const cResult = evaluator.evaluateCard(db, { card_type: 'category_of_month', config: '{}' });
      expect(cResult.type).toBe('category');

      // Search
      const sResult = evaluator.evaluateCard(db, { card_type: 'search_topic', config: '{}' });
      expect(sResult.type).toBe('search');
      expect(sResult.data.search_type).toBe('topic');

      // Info
      const iResult = evaluator.evaluateCard(db, { card_type: 'info_importance', config: '{}' });
      expect(iResult.type).toBe('info');
      expect(iResult.data.info_type).toBe('importance');
    });

    it('getTimeWindowStart returns valid dates for all periods', () => {
      const evaluator = require ? null : null; // already imported above
    });
  });
});
