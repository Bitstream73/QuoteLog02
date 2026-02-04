import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

// Get paginated quotes for homepage
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  // Count total canonical quotes (not variants)
  const total = db.prepare(
    'SELECT COUNT(*) as count FROM quotes WHERE canonical_quote_id IS NULL'
  ).get().count;

  // Get quotes with person info
  const quotes = db.prepare(`
    SELECT q.id, q.text, q.source_urls, q.created_at, q.context, q.quote_type,
           p.id AS person_id, p.canonical_name
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.canonical_quote_id IS NULL
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  // Parse source_urls JSON
  const formattedQuotes = quotes.map(q => ({
    id: q.id,
    text: q.text,
    context: q.context,
    quoteType: q.quote_type,
    personId: q.person_id,
    personName: q.canonical_name,
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
  const quote = db.prepare(`
    SELECT q.*, p.canonical_name, p.disambiguation
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.id = ?
  `).get(req.params.id);

  if (!quote) {
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
      personId: quote.person_id,
      personName: quote.canonical_name,
      personDisambiguation: quote.disambiguation,
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

export default router;
