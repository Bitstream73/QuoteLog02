import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import config from '../config/index.js';

const router = Router();

function isAdminRequest(req) {
  const token = req.cookies?.auth_token;
  if (!token) return false;
  try {
    jwt.verify(token, config.jwtSecret);
    return true;
  } catch {
    return false;
  }
}

// GET /:idOrSlug — Topic detail
router.get('/:idOrSlug', (req, res) => {
  const db = getDb();
  const { idOrSlug } = req.params;

  let topic;
  if (/^\d+$/.test(idOrSlug)) {
    topic = db.prepare('SELECT id, name, slug, description, status FROM topics WHERE id = ?').get(idOrSlug);
  } else {
    topic = db.prepare('SELECT id, name, slug, description, status FROM topics WHERE slug = ?').get(decodeURIComponent(idOrSlug));
  }

  if (!topic) {
    return res.status(404).json({ error: 'Topic not found' });
  }

  const categories = db.prepare(`
    SELECT c.id, c.name, c.slug
    FROM categories c
    JOIN category_topics ct ON ct.category_id = c.id
    WHERE ct.topic_id = ?
    ORDER BY c.name
  `).all(topic.id);

  const quoteCount = db.prepare(`
    SELECT COUNT(DISTINCT qt.quote_id) as count
    FROM quote_topics qt
    JOIN quotes q ON q.id = qt.quote_id
    WHERE qt.topic_id = ? AND q.canonical_quote_id IS NULL AND q.is_visible = 1
  `).get(topic.id).count;

  res.json({
    topic: { id: topic.id, name: topic.name, slug: topic.slug, description: topic.description },
    categories,
    quoteCount,
  });
});

// GET /:idOrSlug/quotes?page=1&limit=50&sort=date|importance — Paginated quotes for topic
router.get('/:idOrSlug/quotes', (req, res) => {
  const db = getDb();
  const { idOrSlug } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'date';

  let topic;
  if (/^\d+$/.test(idOrSlug)) {
    topic = db.prepare('SELECT id FROM topics WHERE id = ?').get(idOrSlug);
  } else {
    topic = db.prepare('SELECT id FROM topics WHERE slug = ?').get(decodeURIComponent(idOrSlug));
  }

  if (!topic) {
    return res.status(404).json({ error: 'Topic not found' });
  }

  const admin = isAdminRequest(req);
  const visFilter = admin ? '' : 'AND q.is_visible = 1';

  const total = db.prepare(`
    SELECT COUNT(DISTINCT q.id) as count
    FROM quotes q
    JOIN quote_topics qt ON qt.quote_id = q.id
    WHERE qt.topic_id = ? AND q.canonical_quote_id IS NULL ${visFilter}
  `).get(topic.id).count;

  const dateExpr = `COALESCE(
    CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
      THEN q.quote_datetime ELSE NULL END,
    q.created_at)`;

  let orderBy;
  if (sort === 'importance') {
    orderBy = `
      CASE
        WHEN q.importants_count > 0 AND ${dateExpr} >= datetime('now', '-1 day') THEN 1
        WHEN q.importants_count > 0 AND ${dateExpr} >= datetime('now', '-7 days') THEN 2
        WHEN q.importants_count > 0 AND ${dateExpr} >= datetime('now', '-30 days') THEN 3
        WHEN q.importants_count > 0 THEN 4
        ELSE 5
      END ASC,
      q.importants_count DESC,
      ${dateExpr} DESC`;
  } else {
    orderBy = `${dateExpr} DESC`;
  }

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.quote_type, q.source_urls, q.created_at,
           q.quote_datetime, q.importants_count, q.is_visible,
           q.fact_check_verdict,
           p.id AS person_id, p.canonical_name AS person_name, p.photo_url, p.category_context,
           a.id AS article_id, a.title AS article_title, a.published_at AS article_published_at, a.url AS article_url,
           s.domain AS primary_source_domain, s.name AS primary_source_name
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    JOIN quote_topics qt ON qt.quote_id = q.id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE qt.topic_id = ? AND q.canonical_quote_id IS NULL ${visFilter}
    GROUP BY q.id
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).all(topic.id, limit, offset);

  res.json({
    quotes: quotes.map(q => ({
      id: q.id,
      text: q.text,
      context: q.context,
      quoteType: q.quote_type,
      sourceUrls: JSON.parse(q.source_urls || '[]'),
      createdAt: q.created_at,
      quoteDateTime: q.quote_datetime || null,
      importantsCount: q.importants_count || 0,
      isVisible: q.is_visible,
      articleId: q.article_id || null,
      articleTitle: q.article_title || null,
      articlePublishedAt: q.article_published_at || null,
      articleUrl: q.article_url || null,
      primarySourceDomain: q.primary_source_domain || null,
      primarySourceName: q.primary_source_name || null,
      factCheckVerdict: q.fact_check_verdict || null,
      personId: q.person_id,
      personName: q.person_name,
      photoUrl: q.photo_url || null,
      personCategoryContext: q.category_context || null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
