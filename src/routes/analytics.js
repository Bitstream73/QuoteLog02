import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

/**
 * SQL expression that safely resolves a quote's effective date.
 * Only uses quote_datetime if it's in ISO format (YYYY-MM-DD...),
 * otherwise falls back to created_at. This prevents non-ISO dates
 * (e.g. "October 28, 1932") from sorting incorrectly via lexicographic comparison.
 */
const QUOTE_DATE_EXPR = `COALESCE(
  CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
    THEN q.quote_datetime ELSE NULL END,
  q.created_at)`;

/**
 * Build tiered importance ORDER BY clause for quotes.
 * Tier 1: importance today (skip 0), Tier 2: this week (skip 0),
 * Tier 3: this month (skip 0), Tier 4: all time (skip 0),
 * Tier 5: by date (newest first)
 * @param {string} dateCol - the date column to use for tiers (e.g. QUOTE_DATE_EXPR)
 * @param {string} importantsCol - the importants_count column (e.g. 'q.importants_count')
 * @returns {string} SQL ORDER BY clause (without ORDER BY keyword)
 */
function tieredImportanceOrder(dateCol, importantsCol) {
  return `
    CASE
      WHEN ${importantsCol} > 0 AND ${dateCol} >= datetime('now', '-1 day') THEN 1
      WHEN ${importantsCol} > 0 AND ${dateCol} >= datetime('now', '-7 days') THEN 2
      WHEN ${importantsCol} > 0 AND ${dateCol} >= datetime('now', '-30 days') THEN 3
      WHEN ${importantsCol} > 0 THEN 4
      ELSE 5
    END ASC,
    CASE WHEN ${importantsCol} > 0 THEN ${importantsCol} ELSE 0 END DESC,
    ${dateCol} DESC
  `;
}

// GET /api/analytics/overview - Combined analytics overview
router.get('/overview', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 30;
  const dateFilter = `-${days} days`;

  const topAuthors = db.prepare(`
    SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
           COUNT(q.id) AS quote_count
    FROM persons p
    JOIN quotes q ON q.person_id = p.id AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
    WHERE q.created_at >= datetime('now', ?)
    GROUP BY p.id
    ORDER BY quote_count DESC
    LIMIT 10
  `).all(dateFilter);

  const totalQuotes = db.prepare(`
    SELECT COUNT(*) AS count FROM quotes
    WHERE is_visible = 1 AND created_at >= datetime('now', ?)
  `).get(dateFilter).count;

  const totalAuthors = db.prepare(`
    SELECT COUNT(DISTINCT person_id) AS count FROM quotes
    WHERE is_visible = 1 AND created_at >= datetime('now', ?)
  `).get(dateFilter).count;

  res.json({
    period_days: days,
    total_quotes: totalQuotes,
    total_authors: totalAuthors,
    authors: topAuthors,
  });
});

// GET /api/analytics/trending-sources - Articles sorted by date or importance, each with top 3 quotes
router.get('/trending-sources', (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    const sortMode = req.query.sort;
    let sourceOrder;
    if (sortMode === 'importance') {
      sourceOrder = tieredImportanceOrder('COALESCE(a.published_at, a.created_at)', 'a.importants_count');
    } else {
      sourceOrder = 'COALESCE(a.published_at, a.created_at) DESC';
    }

    const searchFilter = search.length >= 2 ? 'AND a.title LIKE ?' : '';
    const searchParam = search.length >= 2 ? `%${search}%` : null;

    const baseWhere = `
      WHERE a.trending_score > 0
        AND (SELECT COUNT(*) FROM quote_articles qa3 JOIN quotes q ON q.id = qa3.quote_id AND q.is_visible = 1 WHERE qa3.article_id = a.id) > 0
        ${searchFilter}
    `;

    const queryParams = searchParam ? [searchParam, limit, offset] : [limit, offset];
    const articles = db.prepare(`
      SELECT a.id, a.url, a.title, a.published_at, a.importants_count, a.share_count,
        a.view_count, a.trending_score,
        s.domain as source_domain, s.name as source_name,
        (SELECT COUNT(*) FROM quote_articles qa2 JOIN quotes q ON q.id = qa2.quote_id AND q.is_visible = 1 WHERE qa2.article_id = a.id) as quote_count
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      ${baseWhere}
      ORDER BY ${sourceOrder}
      LIMIT ? OFFSET ?
    `).all(...queryParams);

    const countParams = searchParam ? [searchParam] : [];
    const total = db.prepare(`
      SELECT COUNT(*) as count FROM articles a
      ${baseWhere}
    `).get(...countParams).count;

    // For each article, get top 3 quotes
    const getTopQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at, q.fact_check_verdict,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id AND qa.article_id = ?
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1
      ORDER BY ${QUOTE_DATE_EXPR} DESC
      LIMIT 3
    `);

    const articlesWithQuotes = articles.map(a => ({
      ...a,
      quotes: getTopQuotes.all(a.id).map(q => ({
        ...q,
        article_id: a.id,
        article_title: a.title,
        article_url: a.url,
        source_domain: a.source_domain,
        source_name: a.source_name,
      })),
    }));

    res.json({ articles: articlesWithQuotes, total, page, limit });
  } catch (err) {
    console.error('Trending sources error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trending-quotes - Quote of day/week/month + recent quotes
router.get('/trending-quotes', (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    const baseSelect = `
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.trending_score, q.created_at, q.fact_check_verdict,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context,
        a.id as article_id, a.title as article_title, a.url as article_url,
        s.domain as source_domain, s.name as source_name
      FROM quotes q
      JOIN persons p ON p.id = q.person_id
      LEFT JOIN quote_articles qa ON qa.quote_id = q.id
      LEFT JOIN articles a ON a.id = qa.article_id
      LEFT JOIN sources s ON s.id = a.source_id
      WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL
    `;

    const isSearching = search.length >= 2;

    // Skip quote_of_day/week/month when searching
    let quoteOfDay = null, quoteOfWeek = null, quoteOfMonth = null;
    if (!isSearching) {
      quoteOfDay = db.prepare(`${baseSelect}
        AND q.created_at >= datetime('now', '-1 day')
        GROUP BY q.id ORDER BY q.importants_count DESC LIMIT 1
      `).get() || null;

      quoteOfWeek = db.prepare(`${baseSelect}
        AND q.created_at >= datetime('now', '-7 days')
        GROUP BY q.id ORDER BY q.importants_count DESC LIMIT 1
      `).get() || null;

      quoteOfMonth = db.prepare(`${baseSelect}
        AND q.created_at >= datetime('now', '-30 days')
        GROUP BY q.id ORDER BY q.importants_count DESC LIMIT 1
      `).get() || null;
    }

    const searchFilter = isSearching ? 'AND (q.text LIKE ? OR q.context LIKE ?)' : '';
    const searchParams = isSearching ? [`%${search}%`, `%${search}%`] : [];

    const recentSort = req.query.sort === 'importance'
      ? tieredImportanceOrder(QUOTE_DATE_EXPR, 'q.importants_count')
      : `${QUOTE_DATE_EXPR} DESC`;
    const recentQuotes = db.prepare(`${baseSelect}
      ${searchFilter}
      GROUP BY q.id ORDER BY ${recentSort} LIMIT ? OFFSET ?
    `).all(...searchParams, limit, offset);

    const total = db.prepare(
      `SELECT COUNT(*) as count FROM quotes q WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL ${searchFilter}`
    ).get(...searchParams).count;

    res.json({
      quote_of_day: quoteOfDay,
      quote_of_week: quoteOfWeek,
      quote_of_month: quoteOfMonth,
      recent_quotes: recentQuotes,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error('Trending quotes error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/all-sources - All articles with quotes, newest first
router.get('/all-sources', (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const sort = req.query.sort === 'importance' ? 'a.trending_score DESC' : 'COALESCE(a.published_at, a.created_at) DESC';

    const articles = db.prepare(`
      SELECT a.id, a.url, a.title, a.published_at, a.importants_count, a.share_count,
        a.view_count, a.trending_score,
        s.domain as source_domain, s.name as source_name,
        aqc.visible_quote_count as quote_count
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      JOIN (
        SELECT qa.article_id, COUNT(*) as visible_quote_count
        FROM quote_articles qa
        JOIN quotes q ON q.id = qa.quote_id AND q.is_visible = 1
        GROUP BY qa.article_id
      ) aqc ON aqc.article_id = a.id
      WHERE a.status = 'completed'
      ORDER BY ${sort}
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM articles a
      JOIN (
        SELECT DISTINCT qa.article_id
        FROM quote_articles qa
        JOIN quotes q ON q.id = qa.quote_id AND q.is_visible = 1
      ) aqc ON aqc.article_id = a.id
      WHERE a.status = 'completed'
    `).get().count;

    // For each article, get top 3 quotes
    const getTopQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at, q.fact_check_verdict,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id AND qa.article_id = ?
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1
      ORDER BY ${QUOTE_DATE_EXPR} DESC
      LIMIT 3
    `);

    const articlesWithQuotes = articles.map(a => ({
      ...a,
      quotes: getTopQuotes.all(a.id).map(q => ({
        ...q,
        article_id: a.id,
        article_title: a.title,
        article_url: a.url,
        source_domain: a.source_domain,
        source_name: a.source_name,
      })),
    }));

    res.json({ articles: articlesWithQuotes, total, page, limit });
  } catch (err) {
    console.error('All sources error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trends/article/:id - Chart data for an article
router.get('/trends/article/:id', (req, res) => {
  try {
    const db = getDb();
    const articleId = parseInt(req.params.id);

    // Authors who were quoted in this article
    const authors = db.prepare(`
      SELECT p.canonical_name as name, COUNT(q.id) as quote_count
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id AND qa.article_id = ?
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1
      GROUP BY p.id
      ORDER BY quote_count DESC
    `).all(articleId);

    res.json({ authors });
  } catch (err) {
    console.error('Article trends error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trends/author/:id - Chart data for an author
router.get('/trends/author/:id', (req, res) => {
  try {
    const db = getDb();
    const authorId = parseInt(req.params.id);
    const period = req.query.period === 'week' ? 7 : 30;

    const author = db.prepare(
      'SELECT id, canonical_name as name FROM persons WHERE id = ?'
    ).get(authorId);
    if (!author) return res.status(404).json({ error: 'Author not found' });

    // Timeline: quotes per day for the period
    const timeline = db.prepare(`
      SELECT date(q.created_at) as bucket, COUNT(*) as count
      FROM quotes q
      WHERE q.person_id = ? AND q.is_visible = 1
        AND q.created_at >= datetime('now', ?)
      GROUP BY bucket
      ORDER BY bucket
    `).all(authorId, `-${period} days`);

    res.json({ author, timeline });
  } catch (err) {
    console.error('Author trends error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trending-authors - Authors sorted by date or importance with top quotes
router.get('/trending-authors', (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    const sortMode = req.query.sort;
    let authorOrder;
    if (sortMode === 'importance') {
      // For authors, use most recent quote date for tiering
      authorOrder = `
        CASE
          WHEN p.importants_count > 0 AND p.last_seen_at >= datetime('now', '-1 day') THEN 1
          WHEN p.importants_count > 0 AND p.last_seen_at >= datetime('now', '-7 days') THEN 2
          WHEN p.importants_count > 0 AND p.last_seen_at >= datetime('now', '-30 days') THEN 3
          WHEN p.importants_count > 0 THEN 4
          ELSE 5
        END ASC,
        p.importants_count DESC,
        p.trending_score DESC
      `;
    } else {
      authorOrder = 'p.last_seen_at DESC';
    }

    const searchFilter = search.length >= 2 ? 'AND p.canonical_name LIKE ?' : '';
    const searchParam = search.length >= 2 ? `%${search}%` : null;

    const queryParams = searchParam ? [searchParam, limit, offset] : [limit, offset];
    const authors = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
        p.importants_count, p.share_count, p.view_count, p.quote_count, p.trending_score
      FROM persons p
      WHERE p.quote_count > 0
      ${searchFilter}
      ORDER BY ${authorOrder}
      LIMIT ? OFFSET ?
    `).all(...queryParams);

    const countParams = searchParam ? [searchParam] : [];
    const total = db.prepare(
      `SELECT COUNT(*) as count FROM persons p WHERE p.quote_count > 0 ${searchFilter}`
    ).get(...countParams).count;

    // For each author, get top 4 recent quotes
    const getTopQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at, q.fact_check_verdict,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context,
        a.id as article_id, a.title as article_title, a.url as article_url,
        s.domain as source_domain, s.name as source_name
      FROM quotes q
      JOIN persons p ON p.id = q.person_id
      LEFT JOIN quote_articles qa ON qa.quote_id = q.id
      LEFT JOIN articles a ON a.id = qa.article_id
      LEFT JOIN sources s ON s.id = a.source_id
      WHERE q.person_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      GROUP BY q.id
      ORDER BY ${QUOTE_DATE_EXPR} DESC
      LIMIT 4
    `);

    const authorsWithQuotes = authors.map(a => ({
      ...a,
      quotes: getTopQuotes.all(a.id),
    }));

    res.json({ authors: authorsWithQuotes, total, page, limit });
  } catch (err) {
    console.error('Trending authors error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/highlights?days=N - Importance + truth/falsehood highlights
router.get('/highlights', (req, res) => {
  try {
    const db = getDb();
    const days = parseInt(req.query.days) || 30;
    const dateFilter = `-${days} days`;

    // Top 3 quotes by importants_count
    const topQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at, q.fact_check_verdict,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context
      FROM quotes q
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL
        AND q.created_at >= datetime('now', ?)
        AND q.importants_count > 0
      ORDER BY q.importants_count DESC
      LIMIT 3
    `).all(dateFilter);

    // Top 3 authors by SUM(importants_count)
    const topAuthors = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
        SUM(q.importants_count) as total_importants
      FROM persons p
      JOIN quotes q ON q.person_id = p.id AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      WHERE q.created_at >= datetime('now', ?)
      GROUP BY p.id
      HAVING total_importants > 0
      ORDER BY total_importants DESC
      LIMIT 3
    `).all(dateFilter);

    // Top 3 topics by SUM(importants_count)
    const topTopics = db.prepare(`
      SELECT t.id, t.name, t.slug, SUM(q.importants_count) as total_importants
      FROM topics t
      JOIN quote_topics qt ON qt.topic_id = t.id
      JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      WHERE t.status = 'active'
        AND q.created_at >= datetime('now', ?)
      GROUP BY t.id
      HAVING total_importants > 0
      ORDER BY total_importants DESC
      LIMIT 3
    `).all(dateFilter);

    // Truthful authors (TRUE/MOSTLY_TRUE)
    const truthful = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category,
        COUNT(q.id) as verdict_count
      FROM persons p
      JOIN quotes q ON q.person_id = p.id AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      WHERE q.fact_check_verdict IN ('TRUE', 'MOSTLY_TRUE')
        AND q.created_at >= datetime('now', ?)
      GROUP BY p.id
      ORDER BY verdict_count DESC
      LIMIT 3
    `).all(dateFilter);

    // Misleading authors
    const misleading = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category,
        COUNT(q.id) as verdict_count
      FROM persons p
      JOIN quotes q ON q.person_id = p.id AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      WHERE q.fact_check_verdict = 'MISLEADING'
        AND q.created_at >= datetime('now', ?)
      GROUP BY p.id
      ORDER BY verdict_count DESC
      LIMIT 3
    `).all(dateFilter);

    // False authors (FALSE/MOSTLY_FALSE)
    const falseAuthors = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category,
        COUNT(q.id) as verdict_count
      FROM persons p
      JOIN quotes q ON q.person_id = p.id AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
      WHERE q.fact_check_verdict IN ('FALSE', 'MOSTLY_FALSE')
        AND q.created_at >= datetime('now', ?)
      GROUP BY p.id
      ORDER BY verdict_count DESC
      LIMIT 3
    `).all(dateFilter);

    res.json({
      period_days: days,
      importance: { quotes: topQuotes, authors: topAuthors, topics: topTopics },
      truth_falsehood: { truthful, misleading, false: falseAuthors },
    });
  } catch (err) {
    console.error('Highlights error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/top-authors?limit=5 — Top N authors by composite score
router.get('/top-authors', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 5, 20);

    const authors = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
        p.importants_count, p.quote_count, p.share_count, p.view_count,
        (p.importants_count + p.quote_count + p.share_count + p.view_count) as composite_score
      FROM persons p
      WHERE p.quote_count > 0
      ORDER BY composite_score DESC, p.importants_count DESC
      LIMIT ?
    `).all(limit);

    res.json({ authors });
  } catch (err) {
    console.error('Top authors error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
