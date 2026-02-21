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

// GET /:idOrSlug — Category detail
router.get('/:idOrSlug', (req, res) => {
  const db = getDb();
  const { idOrSlug } = req.params;

  let category;
  if (/^\d+$/.test(idOrSlug)) {
    category = db.prepare('SELECT id, name, slug, sort_order, image_url, icon_name FROM categories WHERE id = ?').get(idOrSlug);
  } else {
    category = db.prepare('SELECT id, name, slug, sort_order, image_url, icon_name FROM categories WHERE slug = ?').get(decodeURIComponent(idOrSlug));
  }

  if (!category) {
    return res.status(404).json({ error: 'Category not found' });
  }

  const topics = db.prepare(`
    SELECT t.id, t.name
    FROM topics t
    JOIN category_topics ct ON ct.topic_id = t.id
    WHERE ct.category_id = ?
    ORDER BY t.name
  `).all(category.id);

  const quoteCount = db.prepare(`
    SELECT COUNT(DISTINCT qt.quote_id) as count
    FROM category_topics ct
    JOIN quote_topics qt ON qt.topic_id = ct.topic_id
    JOIN quotes q ON q.id = qt.quote_id
    WHERE ct.category_id = ? AND q.canonical_quote_id IS NULL AND q.is_visible = 1
  `).get(category.id).count;

  res.json({
    category: { id: category.id, name: category.name, slug: category.slug, image_url: category.image_url || null, icon_name: category.icon_name || null },
    topics,
    quoteCount,
  });
});

// GET /:idOrSlug/quotes?page=1&limit=50&sort=date|importance — Paginated quotes for category
router.get('/:idOrSlug/quotes', (req, res) => {
  const db = getDb();
  const { idOrSlug } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const sort = req.query.sort || 'date';

  let category;
  if (/^\d+$/.test(idOrSlug)) {
    category = db.prepare('SELECT id FROM categories WHERE id = ?').get(idOrSlug);
  } else {
    category = db.prepare('SELECT id FROM categories WHERE slug = ?').get(decodeURIComponent(idOrSlug));
  }

  if (!category) {
    return res.status(404).json({ error: 'Category not found' });
  }

  const admin = isAdminRequest(req);
  const visFilter = admin ? '' : 'AND q.is_visible = 1';

  const total = db.prepare(`
    SELECT COUNT(DISTINCT q.id) as count
    FROM quotes q
    JOIN quote_topics qt ON qt.quote_id = q.id
    JOIN category_topics ct ON ct.topic_id = qt.topic_id
    WHERE ct.category_id = ? AND q.canonical_quote_id IS NULL ${visFilter}
  `).get(category.id).count;

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.quote_type, q.source_urls, q.created_at,
           q.quote_datetime, q.importants_count, q.is_visible,
           q.fact_check_verdict,
           p.id AS person_id, p.canonical_name AS person_name, p.photo_url, p.category_context,
           a.id AS article_id, a.title AS article_title, a.published_at AS article_published_at, a.url AS article_url,
           s.domain AS primary_source_domain, s.name AS primary_source_name,
           COALESCE((SELECT SUM(vote_value) FROM votes WHERE votes.quote_id = q.id), 0) as vote_score
    FROM quotes q
    JOIN persons p ON p.id = q.person_id
    JOIN quote_topics qt ON qt.quote_id = q.id
    JOIN category_topics ct ON ct.topic_id = qt.topic_id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE ct.category_id = ? AND q.canonical_quote_id IS NULL ${visFilter}
    GROUP BY q.id
    ORDER BY ${sort === 'importance' ? `
      CASE
        WHEN q.importants_count > 0 AND COALESCE(
          CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
            THEN q.quote_datetime ELSE NULL END,
          q.created_at) >= datetime('now', '-1 day') THEN 1
        WHEN q.importants_count > 0 AND COALESCE(
          CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
            THEN q.quote_datetime ELSE NULL END,
          q.created_at) >= datetime('now', '-7 days') THEN 2
        WHEN q.importants_count > 0 AND COALESCE(
          CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
            THEN q.quote_datetime ELSE NULL END,
          q.created_at) >= datetime('now', '-30 days') THEN 3
        WHEN q.importants_count > 0 THEN 4
        ELSE 5
      END ASC,
      q.importants_count DESC,
    ` : ''}
    COALESCE(
      CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
        THEN q.quote_datetime ELSE NULL END,
      q.created_at) DESC
    LIMIT ? OFFSET ?
  `).all(category.id, limit, offset);

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
      voteScore: q.vote_score,
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
