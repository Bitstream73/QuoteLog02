import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

// GET /api/analytics/trending-topics - Top topics by quote count
router.get('/trending-topics', (req, res) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  const days = parseInt(req.query.days) || 30;

  const topics = db.prepare(`
    SELECT t.id, t.name, t.slug, COUNT(qt.quote_id) AS quote_count
    FROM topics t
    JOIN quote_topics qt ON qt.topic_id = t.id
    JOIN quotes q ON q.id = qt.quote_id AND q.is_visible = 1
    WHERE q.created_at >= datetime('now', ?)
    GROUP BY t.id
    ORDER BY quote_count DESC
    LIMIT ?
  `).all(`-${days} days`, limit);

  res.json({ topics, period_days: days });
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

export default router;
