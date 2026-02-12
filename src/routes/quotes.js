import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { searchQuotes } from '../services/vectorDb.js';
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

// Broad category mappings for the simplified tab system
const BROAD_CATEGORY_MAP = {
  Politicians: ['Politician', 'Government Official'],
  Professionals: ['Business Leader', 'Scientist/Academic', 'Legal/Judicial', 'Journalist', 'Military/Defense'],
  // "Other" is everything not in Politicians or Professionals
};

function getBroadCategoryFilter(broadCategory) {
  if (!broadCategory || broadCategory === 'All') return { sql: '', params: [] };
  const cats = BROAD_CATEGORY_MAP[broadCategory];
  if (cats) {
    const placeholders = cats.map(() => '?').join(',');
    return { sql: `AND p.category IN (${placeholders})`, params: cats };
  }
  if (broadCategory === 'Other') {
    const allMapped = [...BROAD_CATEGORY_MAP.Politicians, ...BROAD_CATEGORY_MAP.Professionals];
    const placeholders = allMapped.map(() => '?').join(',');
    return { sql: `AND (p.category NOT IN (${placeholders}) OR p.category IS NULL)`, params: allMapped };
  }
  return { sql: '', params: [] };
}

// Get paginated quotes for homepage (supports broad category filter, sub-filter, and article grouping)
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const admin = isAdminRequest(req);
  const category = req.query.category || null;
  const subFilter = req.query.subFilter || null;
  const search = req.query.search || null;
  const tab = req.query.tab || null;

  const visibilityFilter = admin ? '' : 'AND q.is_visible = 1';
  const topStoriesFilter = tab === 'top-stories' ? 'AND (a.is_top_story = 1 OR s.is_top_story = 1)' : '';
  const { sql: categoryFilter, params: categoryParams } = getBroadCategoryFilter(category);
  const subFilterSql = subFilter ? 'AND (p.category_context LIKE ? OR p.category LIKE ? OR q.context LIKE ?)' : '';
  const searchFilter = search ? 'AND (q.text LIKE ? OR p.canonical_name LIKE ? OR p.category LIKE ? OR q.context LIKE ? OR a.title LIKE ?)' : '';

  const params = [...categoryParams];
  if (subFilterSql) {
    const sfTerm = `%${subFilter}%`;
    params.push(sfTerm, sfTerm, sfTerm);
  }
  if (searchFilter) {
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }

  // Count total canonical quotes (not variants)
  const total = db.prepare(
    `SELECT COUNT(DISTINCT q.id) as count FROM quotes q
     JOIN persons p ON q.person_id = p.id
     LEFT JOIN quote_articles qa ON qa.quote_id = q.id
     LEFT JOIN articles a ON qa.article_id = a.id
     LEFT JOIN sources s ON a.source_id = s.id
     WHERE q.canonical_quote_id IS NULL ${visibilityFilter} ${topStoriesFilter} ${categoryFilter} ${subFilterSql} ${searchFilter}`
  ).get(...params).count;

  // Get quotes with person info + first linked article/source + vote score
  const quotes = db.prepare(`
    SELECT q.id, q.text, q.source_urls, q.created_at, q.context, q.quote_type, q.is_visible,
           q.rss_metadata,
           p.id AS person_id, p.canonical_name, p.photo_url, p.category AS person_category,
           p.category_context AS person_category_context,
           a.id AS article_id, a.title AS article_title, a.published_at AS article_published_at, a.url AS article_url,
           s.domain AS primary_source_domain, s.name AS primary_source_name,
           q.importants_count
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE q.canonical_quote_id IS NULL ${visibilityFilter} ${topStoriesFilter} ${categoryFilter} ${subFilterSql} ${searchFilter}
    GROUP BY q.id
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const formattedQuotes = quotes.map(q => ({
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
    articleId: q.article_id || null,
    articleTitle: q.article_title || null,
    articlePublishedAt: q.article_published_at || null,
    articleUrl: q.article_url || null,
    primarySourceDomain: q.primary_source_domain || null,
    primarySourceName: q.primary_source_name || null,
    sourceUrls: JSON.parse(q.source_urls || '[]'),
    rssMetadata: q.rss_metadata ? JSON.parse(q.rss_metadata) : null,
    createdAt: q.created_at,
    importantsCount: q.importants_count,
  }));

  // Get broad category counts for tab rendering
  const allCats = db.prepare(`
    SELECT p.category, COUNT(*) as count
    FROM persons p
    JOIN quotes q ON q.person_id = p.id
    WHERE q.canonical_quote_id IS NULL ${admin ? '' : 'AND q.is_visible = 1'}
    GROUP BY p.category
  `).all();

  const politicianCats = new Set(BROAD_CATEGORY_MAP.Politicians);
  const professionalCats = new Set(BROAD_CATEGORY_MAP.Professionals);
  let politiciansCount = 0, professionalsCount = 0, otherCount = 0, allCount = 0;
  for (const c of allCats) {
    allCount += c.count;
    if (politicianCats.has(c.category)) politiciansCount += c.count;
    else if (professionalCats.has(c.category)) professionalsCount += c.count;
    else otherCount += c.count;
  }

  // Count top stories quotes
  const topStoriesCount = db.prepare(`
    SELECT COUNT(DISTINCT q.id) as count FROM quotes q
    JOIN persons p ON q.person_id = p.id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE q.canonical_quote_id IS NULL ${admin ? '' : 'AND q.is_visible = 1'}
    AND (a.is_top_story = 1 OR s.is_top_story = 1)
  `).get().count;

  const broadCategories = [
    { category: 'Top Stories', count: topStoriesCount },
    { category: 'All', count: allCount },
    { category: 'Politicians', count: politiciansCount },
    { category: 'Professionals', count: professionalsCount },
    { category: 'Other', count: otherCount },
  ];

  res.json({
    quotes: formattedQuotes,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    categories: broadCategories,
  });
});

// Search quotes — tries Pinecone semantic search first, falls back to SQLite LIKE
router.get('/search', async (req, res) => {
  const db = getDb();
  const { q: query } = req.query;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const admin = isAdminRequest(req);

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: 'Search query must be at least 2 characters' });
  }

  const trimmedQuery = query.trim();
  const visibilityFilter = admin ? '' : 'AND q.is_visible = 1';

  // Try Pinecone semantic search first
  let semanticResults = [];
  let searchMethod = 'text';
  if (config.pineconeApiKey && config.pineconeIndexHost) {
    try {
      semanticResults = await searchQuotes(trimmedQuery, 50);
    } catch {
      // Fall through to SQLite
    }
  }

  if (semanticResults.length > 0) {
    searchMethod = 'semantic';
    // Extract quote IDs from Pinecone hits (preserve relevance order)
    const quoteIds = semanticResults
      .map(r => r.metadata?.quote_id)
      .filter(Boolean);

    if (quoteIds.length > 0) {
      const placeholders = quoteIds.map(() => '?').join(',');
      const allQuotes = db.prepare(`
        SELECT q.id, q.text, q.source_urls, q.created_at, q.context, q.quote_type, q.is_visible,
               p.id AS person_id, p.canonical_name, p.photo_url, p.category AS person_category,
               p.category_context AS person_category_context,
               a.id AS article_id, a.title AS article_title, a.published_at AS article_published_at, a.url AS article_url,
               s.domain AS primary_source_domain, s.name AS primary_source_name
        FROM quotes q
        JOIN persons p ON q.person_id = p.id
        LEFT JOIN quote_articles qa ON qa.quote_id = q.id
        LEFT JOIN articles a ON qa.article_id = a.id
        LEFT JOIN sources s ON a.source_id = s.id
        WHERE q.id IN (${placeholders}) AND q.canonical_quote_id IS NULL ${visibilityFilter}
        GROUP BY q.id
      `).all(...quoteIds);

      // Re-order by Pinecone relevance score
      const quoteMap = new Map(allQuotes.map(q => [q.id, q]));
      const ordered = quoteIds
        .map(id => quoteMap.get(id))
        .filter(Boolean);

      const total = ordered.length;
      const paged = ordered.slice(offset, offset + limit);

      return res.json({
        quotes: paged.map(q => formatQuoteResult(q)),
        total,
        page,
        totalPages: Math.ceil(total / limit),
        query: trimmedQuery,
        searchMethod,
      });
    }
  }

  // Fallback: SQLite LIKE search
  const searchTerm = `%${trimmedQuery}%`;

  const total = db.prepare(`
    SELECT COUNT(DISTINCT q.id) as count FROM quotes q
    JOIN persons p ON q.person_id = p.id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    WHERE q.canonical_quote_id IS NULL ${visibilityFilter}
    AND (q.text LIKE ? OR p.canonical_name LIKE ? OR p.category LIKE ? OR q.context LIKE ? OR a.title LIKE ?)
  `).get(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm).count;

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.source_urls, q.created_at, q.context, q.quote_type, q.is_visible,
           p.id AS person_id, p.canonical_name, p.photo_url, p.category AS person_category,
           p.category_context AS person_category_context,
           a.id AS article_id, a.title AS article_title, a.published_at AS article_published_at, a.url AS article_url,
           s.domain AS primary_source_domain, s.name AS primary_source_name
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE q.canonical_quote_id IS NULL ${visibilityFilter}
    AND (q.text LIKE ? OR p.canonical_name LIKE ? OR p.category LIKE ? OR q.context LIKE ? OR a.title LIKE ?)
    GROUP BY q.id
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, limit, offset);

  res.json({
    quotes: quotes.map(q => formatQuoteResult(q)),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    query: trimmedQuery,
    searchMethod,
  });
});

function formatQuoteResult(q) {
  return {
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
    articleId: q.article_id || null,
    articleTitle: q.article_title || null,
    articlePublishedAt: q.article_published_at || null,
    articleUrl: q.article_url || null,
    primarySourceDomain: q.primary_source_domain || null,
    primarySourceName: q.primary_source_name || null,
    sourceUrls: JSON.parse(q.source_urls || '[]'),
    createdAt: q.created_at,
  };
}

// Get keywords and topics for a quote
router.get('/:id/keywords-topics', (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);

    const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const keywords = db.prepare(`
      SELECT k.id, k.name, k.keyword_type
      FROM keywords k JOIN quote_keywords qk ON k.id = qk.keyword_id
      WHERE qk.quote_id = ?
    `).all(quoteId);

    const topics = db.prepare(`
      SELECT t.id, t.name, t.slug
      FROM topics t JOIN quote_topics qt ON t.id = qt.topic_id
      WHERE qt.quote_id = ?
    `).all(quoteId);

    res.json({ keywords, topics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch keywords/topics: ' + err.message });
  }
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
      importantsCount: quote.importants_count,
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

// Edit quote text (admin only)
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { text, context } = req.body;

  const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  if (text !== undefined) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Quote text cannot be empty' });
    }
    db.prepare('UPDATE quotes SET text = ? WHERE id = ?').run(text.trim(), req.params.id);
  }

  if (context !== undefined) {
    db.prepare('UPDATE quotes SET context = ? WHERE id = ?').run(context || null, req.params.id);
  }

  const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  res.json({ success: true, quote: { id: updated.id, text: updated.text, context: updated.context } });
});

export default router;
