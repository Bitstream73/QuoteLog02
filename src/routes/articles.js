import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
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

// Get article with all its quotes
router.get('/:id', (req, res) => {
  const db = getDb();
  const admin = isAdminRequest(req);

  const article = db.prepare(`
    SELECT a.id, a.url, a.title, a.published_at, a.quote_count, a.is_top_story,
           s.domain, s.name AS source_name
    FROM articles a
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  const visibilityFilter = admin ? '' : 'AND q.is_visible = 1';

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.context, q.quote_type, q.is_visible, q.created_at, q.source_urls,
           q.fact_check_verdict,
           p.id AS person_id, p.canonical_name, p.photo_url, p.category AS person_category,
           p.category_context AS person_category_context,
           COALESCE((SELECT SUM(vote_value) FROM votes WHERE votes.quote_id = q.id), 0) as vote_score
    FROM quote_articles qa
    JOIN quotes q ON qa.quote_id = q.id
    JOIN persons p ON q.person_id = p.id
    WHERE qa.article_id = ? AND q.canonical_quote_id IS NULL ${visibilityFilter}
    ORDER BY q.created_at ASC
  `).all(req.params.id);

  res.json({
    article: {
      id: article.id,
      url: article.url,
      title: article.title,
      publishedAt: article.published_at,
      quoteCount: article.quote_count,
      isTopStory: article.is_top_story,
      sourceDomain: article.domain,
      sourceName: article.source_name,
    },
    quotes: quotes.map(q => ({
      id: q.id,
      text: q.text,
      context: q.context,
      quoteType: q.quote_type,
      isVisible: q.is_visible,
      personId: q.person_id,
      personName: q.canonical_name,
      photoUrl: q.photo_url || null,
      personCategory: q.person_category || 'Other',
      personCategoryContext: q.person_category_context || null,
      sourceUrls: JSON.parse(q.source_urls || '[]'),
      createdAt: q.created_at,
      voteScore: q.vote_score,
      factCheckVerdict: q.fact_check_verdict || null,
    })),
  });
});

// Update article (admin only) — currently supports is_top_story toggle
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { is_top_story } = req.body;

  const article = db.prepare('SELECT id FROM articles WHERE id = ?').get(req.params.id);
  if (!article) {
    return res.status(404).json({ error: 'Article not found' });
  }

  const updates = [];
  const values = [];

  if (is_top_story !== undefined) {
    updates.push('is_top_story = ?');
    values.push(is_top_story ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.json({ success: true });
  }

  values.push(req.params.id);
  db.prepare(`UPDATE articles SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare(`
    SELECT a.id, a.url, a.title, a.published_at, a.quote_count, a.is_top_story,
           s.domain, s.name AS source_name
    FROM articles a
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE a.id = ?
  `).get(req.params.id);

  res.json({
    success: true,
    article: {
      id: updated.id,
      url: updated.url,
      title: updated.title,
      publishedAt: updated.published_at,
      quoteCount: updated.quote_count,
      isTopStory: updated.is_top_story,
      sourceDomain: updated.domain,
      sourceName: updated.source_name,
    },
  });
});

export default router;
