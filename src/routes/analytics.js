import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

/**
 * Enrich an array of quotes with their top 2 topics
 */
function enrichQuotesWithTopics(db, quotes) {
  if (!quotes || quotes.length === 0) return quotes;
  const quoteIds = quotes.map(q => q.id);
  const placeholders = quoteIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT qt.quote_id, t.name, t.slug
    FROM quote_topics qt
    JOIN topics t ON t.id = qt.topic_id
    WHERE qt.quote_id IN (${placeholders})
  `).all(...quoteIds);

  const topicMap = {};
  for (const row of rows) {
    if (!topicMap[row.quote_id]) topicMap[row.quote_id] = [];
    if (topicMap[row.quote_id].length < 2) {
      topicMap[row.quote_id].push({ name: row.name, slug: row.slug });
    }
  }

  return quotes.map(q => ({ ...q, topics: topicMap[q.id] || [] }));
}

// GET /api/analytics/trending-topics - Topics sorted by trending_score, each with top 3 quotes
router.get('/trending-topics', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const topics = db.prepare(`
      SELECT t.id, t.name, t.slug, t.description, t.context,
        t.importants_count, t.trending_score,
        (SELECT COUNT(*) FROM quote_topics WHERE topic_id = t.id) as quote_count
      FROM topics t
      ORDER BY t.trending_score DESC
      LIMIT ?
    `).all(limit);

    // For each topic, get top 3 quotes
    const getTopQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context, a.id as article_id, a.title as article_title,
        a.url as article_url, s.domain as source_domain, s.name as source_name
      FROM quotes q
      JOIN quote_topics qt ON qt.quote_id = q.id AND qt.topic_id = ?
      JOIN persons p ON p.id = q.person_id
      LEFT JOIN quote_articles qa ON qa.quote_id = q.id
      LEFT JOIN articles a ON a.id = qa.article_id
      LEFT JOIN sources s ON s.id = a.source_id
      WHERE q.is_visible = 1
      GROUP BY q.id
      ORDER BY q.created_at DESC
      LIMIT 3
    `);

    // Fetch keywords for all topics in one query
    const topicIds = topics.map(t => t.id);
    const topicKeywordsMap = {};
    if (topicIds.length > 0) {
      const tkPlaceholders = topicIds.map(() => '?').join(',');
      const tkRows = db.prepare(`
        SELECT tk.topic_id, k.id, k.name, k.keyword_type
        FROM topic_keywords tk
        JOIN keywords k ON k.id = tk.keyword_id
        WHERE tk.topic_id IN (${tkPlaceholders})
      `).all(...topicIds);
      for (const row of tkRows) {
        if (!topicKeywordsMap[row.topic_id]) topicKeywordsMap[row.topic_id] = [];
        topicKeywordsMap[row.topic_id].push({ id: row.id, name: row.name, keyword_type: row.keyword_type });
      }
    }

    const topicsWithQuotes = topics.map(t => ({
      ...t,
      keywords: topicKeywordsMap[t.id] || [],
      quotes: enrichQuotesWithTopics(db, getTopQuotes.all(t.id)),
    }));

    res.json({ topics: topicsWithQuotes });
  } catch (err) {
    console.error('Trending topics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/analytics/trending-keywords - Top keywords by quote count
router.get('/trending-keywords', (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const days = parseInt(req.query.days) || 30;
  const type = req.query.type || null; // optional filter by keyword_type

  let query = `
    SELECT k.id, k.name, k.keyword_type, COUNT(qk.quote_id) AS quote_count
    FROM keywords k
    JOIN quote_keywords qk ON qk.keyword_id = k.id
    JOIN quotes q ON q.id = qk.quote_id AND q.is_visible = 1
    WHERE q.created_at >= datetime('now', ?)
  `;
  const params = [`-${days} days`];

  if (type) {
    query += ` AND k.keyword_type = ?`;
    params.push(type);
  }

  query += `
    GROUP BY k.id
    ORDER BY quote_count DESC
    LIMIT ?
  `;
  params.push(limit);

  const keywords = db.prepare(query).all(...params);

  res.json({ keywords, period_days: days });
});

// GET /api/analytics/overview - Combined analytics overview
router.get('/overview', (req, res) => {
  const db = getDb();
  const days = parseInt(req.query.days) || 30;
  const dateFilter = `-${days} days`;

  const topTopics = db.prepare(`
    SELECT t.id, t.name, t.slug, COUNT(qt.quote_id) AS quote_count
    FROM topics t
    JOIN quote_topics qt ON qt.topic_id = t.id
    JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
    WHERE q.created_at >= datetime('now', ?)
    GROUP BY t.id
    ORDER BY quote_count DESC
    LIMIT 15
  `).all(dateFilter);

  const topKeywords = db.prepare(`
    SELECT k.id, k.name, k.keyword_type, COUNT(qk.quote_id) AS quote_count
    FROM keywords k
    JOIN quote_keywords qk ON qk.keyword_id = k.id
    JOIN quotes q ON q.id = qk.quote_id AND q.is_visible = 1
    WHERE q.created_at >= datetime('now', ?)
    GROUP BY k.id
    ORDER BY quote_count DESC
    LIMIT 20
  `).all(dateFilter);

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
    topics: topTopics,
    keywords: topKeywords,
    authors: topAuthors,
  });
});

// GET /api/analytics/topic/:slug - Quotes for a specific topic
router.get('/topic/:slug', (req, res) => {
  const db = getDb();
  const { slug } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  const topic = db.prepare('SELECT * FROM topics WHERE slug = ?').get(slug);
  if (!topic) {
    return res.status(404).json({ error: 'Topic not found' });
  }

  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM quote_topics qt
    JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
    WHERE qt.topic_id = ?
  `).get(topic.id).count;

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.created_at,
           p.id AS person_id, p.canonical_name, p.photo_url, p.category
    FROM quote_topics qt
    JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
    JOIN persons p ON p.id = q.person_id
    WHERE qt.topic_id = ?
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(topic.id, limit, offset);

  res.json({ topic, quotes, total, page, limit });
});

// GET /api/analytics/keyword/:id - Quotes for a specific keyword
router.get('/keyword/:id', (req, res) => {
  const db = getDb();
  const keywordId = parseInt(req.params.id);
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = (page - 1) * limit;

  const keyword = db.prepare('SELECT * FROM keywords WHERE id = ?').get(keywordId);
  if (!keyword) {
    return res.status(404).json({ error: 'Keyword not found' });
  }

  const total = db.prepare(`
    SELECT COUNT(*) AS count FROM quote_keywords qk
    JOIN quotes q ON q.id = qk.quote_id AND q.is_visible = 1
    WHERE qk.keyword_id = ?
  `).get(keyword.id).count;

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.created_at,
           p.id AS person_id, p.canonical_name, p.photo_url, p.category
    FROM quote_keywords qk
    JOIN quotes q ON q.id = qk.quote_id AND q.is_visible = 1
    JOIN persons p ON p.id = q.person_id
    WHERE qk.keyword_id = ?
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(keyword.id, limit, offset);

  res.json({ keyword, quotes, total, page, limit });
});

// GET /api/analytics/trending-sources - Articles sorted by trending_score, each with top 3 quotes
router.get('/trending-sources', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const articles = db.prepare(`
      SELECT a.id, a.url, a.title, a.published_at, a.importants_count, a.share_count,
        a.view_count, a.trending_score,
        s.domain as source_domain, s.name as source_name,
        (SELECT COUNT(*) FROM quote_articles WHERE article_id = a.id) as quote_count
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      WHERE a.trending_score > 0
      ORDER BY a.trending_score DESC
      LIMIT ?
    `).all(limit);

    // For each article, get top 3 quotes
    const getTopQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id AND qa.article_id = ?
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1
      ORDER BY q.created_at DESC
      LIMIT 3
    `);

    const articlesWithQuotes = articles.map(a => ({
      ...a,
      quotes: enrichQuotesWithTopics(db, getTopQuotes.all(a.id).map(q => ({
        ...q,
        article_id: a.id,
        article_title: a.title,
        article_url: a.url,
        source_domain: a.source_domain,
        source_name: a.source_name,
      }))),
    }));

    res.json({ articles: articlesWithQuotes });
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

    const baseSelect = `
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.trending_score, q.created_at,
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

    const quoteOfDay = db.prepare(`${baseSelect}
      AND q.created_at >= datetime('now', '-1 day')
      GROUP BY q.id ORDER BY q.importants_count DESC LIMIT 1
    `).get();

    const quoteOfWeek = db.prepare(`${baseSelect}
      AND q.created_at >= datetime('now', '-7 days')
      GROUP BY q.id ORDER BY q.importants_count DESC LIMIT 1
    `).get();

    const quoteOfMonth = db.prepare(`${baseSelect}
      AND q.created_at >= datetime('now', '-30 days')
      GROUP BY q.id ORDER BY q.importants_count DESC LIMIT 1
    `).get();

    const recentSort = req.query.sort === 'importance'
      ? 'q.importants_count + q.share_count DESC'
      : 'q.created_at DESC';
    const recentQuotes = db.prepare(`${baseSelect}
      GROUP BY q.id ORDER BY ${recentSort} LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(
      'SELECT COUNT(*) as count FROM quotes WHERE is_visible = 1 AND canonical_quote_id IS NULL'
    ).get().count;

    // Enrich all quotes with topics
    const allQuotes = [quoteOfDay, quoteOfWeek, quoteOfMonth, ...recentQuotes].filter(Boolean);
    const enriched = enrichQuotesWithTopics(db, allQuotes);
    const enrichedMap = {};
    for (const q of enriched) enrichedMap[q.id] = q;

    res.json({
      quote_of_day: quoteOfDay ? enrichedMap[quoteOfDay.id] || quoteOfDay : null,
      quote_of_week: quoteOfWeek ? enrichedMap[quoteOfWeek.id] || quoteOfWeek : null,
      quote_of_month: quoteOfMonth ? enrichedMap[quoteOfMonth.id] || quoteOfMonth : null,
      recent_quotes: recentQuotes.map(q => enrichedMap[q.id] || q),
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
    const sort = req.query.sort === 'importance' ? 'a.trending_score DESC' : 'a.published_at DESC';

    const articles = db.prepare(`
      SELECT a.id, a.url, a.title, a.published_at, a.importants_count, a.share_count,
        a.view_count, a.trending_score,
        s.domain as source_domain, s.name as source_name,
        (SELECT COUNT(*) FROM quote_articles WHERE article_id = a.id) as quote_count
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      WHERE a.status = 'completed' AND a.quote_count > 0
      ORDER BY ${sort}
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = db.prepare(
      "SELECT COUNT(*) as count FROM articles WHERE status = 'completed' AND quote_count > 0"
    ).get().count;

    // For each article, get top 3 quotes
    const getTopQuotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.quote_datetime, q.importants_count, q.share_count,
        q.created_at,
        p.id as person_id, p.canonical_name as person_name, p.photo_url,
        p.category_context
      FROM quotes q
      JOIN quote_articles qa ON qa.quote_id = q.id AND qa.article_id = ?
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1
      ORDER BY q.created_at DESC
      LIMIT 3
    `);

    const articlesWithQuotes = articles.map(a => ({
      ...a,
      quotes: enrichQuotesWithTopics(db, getTopQuotes.all(a.id).map(q => ({
        ...q,
        article_id: a.id,
        article_title: a.title,
        article_url: a.url,
        source_domain: a.source_domain,
        source_name: a.source_name,
      }))),
    }));

    res.json({ articles: articlesWithQuotes, total, page, limit });
  } catch (err) {
    console.error('All sources error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
