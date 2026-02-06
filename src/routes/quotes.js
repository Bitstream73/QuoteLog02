import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import config from '../config/index.js';

const router = Router();

/**
 * Detect admin from JWT cookie (non-blocking — no auth required)
 */
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

// Get paginated quotes for homepage
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const admin = isAdminRequest(req);

  const visibilityFilter = admin ? '' : 'AND q.is_visible = 1';

  // Count total canonical quotes (not variants)
  const total = db.prepare(
    `SELECT COUNT(*) as count FROM quotes q WHERE q.canonical_quote_id IS NULL ${visibilityFilter}`
  ).get().count;

  // Get quotes with person info + first linked article/source
  const quotes = db.prepare(`
    SELECT q.id, q.text, q.source_urls, q.created_at, q.context, q.quote_type, q.is_visible,
           p.id AS person_id, p.canonical_name, p.photo_url,
           a.title AS article_title, a.published_at AS article_published_at,
           s.domain AS primary_source_domain, s.name AS primary_source_name
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE q.canonical_quote_id IS NULL ${visibilityFilter}
    GROUP BY q.id
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  // Parse source_urls JSON
  const formattedQuotes = quotes.map(q => ({
    id: q.id,
    text: q.text,
    context: q.context,
    quoteType: q.quote_type,
    isVisible: q.is_visible,
    personId: q.person_id,
    personName: q.canonical_name,
    photoUrl: q.photo_url || null,
    articleTitle: q.article_title || null,
    articlePublishedAt: q.article_published_at || null,
    primarySourceDomain: q.primary_source_domain || null,
    primarySourceName: q.primary_source_name || null,
    sourceUrls: JSON.parse(q.source_urls || '[]'),
    createdAt: q.created_at,
  }));

  res.json({
    quotes: formattedQuotes,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

// Get single quote with details
router.get('/:id', (req, res) => {
  const db = getDb();
  const admin = isAdminRequest(req);

  const quote = db.prepare(`
    SELECT q.*, p.canonical_name, p.disambiguation, p.photo_url
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.id = ?
  `).get(req.params.id);

  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  // Non-admin cannot see hidden quotes
  if (!admin && !quote.is_visible) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  // Get related articles
  const articles = db.prepare(`
    SELECT a.id, a.url, a.title, a.published_at, s.domain, s.name as source_name
    FROM quote_articles qa
    JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE qa.quote_id = ?
  `).all(quote.id);

  // Get related quotes from same person
  const relatedQuotes = db.prepare(`
    SELECT q.id, q.text, q.created_at
    FROM quotes q
    WHERE q.person_id = ? AND q.id != ? AND q.canonical_quote_id IS NULL
    ORDER BY q.created_at DESC
    LIMIT 5
  `).all(quote.person_id, quote.id);

  // Get variants of this quote if it's canonical
  const variants = db.prepare(`
    SELECT q.id, q.text, q.source_urls
    FROM quotes q
    WHERE q.canonical_quote_id = ?
  `).all(quote.id);

  res.json({
    quote: {
      id: quote.id,
      text: quote.text,
      context: quote.context,
      quoteType: quote.quote_type,
      isVisible: quote.is_visible,
      personId: quote.person_id,
      personName: quote.canonical_name,
      personDisambiguation: quote.disambiguation,
      photoUrl: quote.photo_url || null,
      sourceUrls: JSON.parse(quote.source_urls || '[]'),
      createdAt: quote.created_at,
    },
    articles,
    relatedQuotes: relatedQuotes.map(q => ({
      id: q.id,
      text: q.text.length > 150 ? q.text.substring(0, 150) + '...' : q.text,
      createdAt: q.created_at,
    })),
    variants: variants.map(v => ({
      id: v.id,
      text: v.text,
      sourceUrls: JSON.parse(v.source_urls || '[]'),
    })),
  });
});

// Toggle quote visibility (admin only)
router.patch('/:id/visibility', requireAdmin, (req, res) => {
  const db = getDb();
  const { isVisible } = req.body;

  if (typeof isVisible !== 'boolean') {
    return res.status(400).json({ error: 'isVisible must be a boolean' });
  }

  const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  db.prepare('UPDATE quotes SET is_visible = ? WHERE id = ?').run(isVisible ? 1 : 0, req.params.id);

  res.json({ success: true, isVisible });
});

export default router;
