import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { searchQuotes } from '../services/vectorDb.js';
import { generateShareImage, invalidateShareImageCache } from '../services/shareImage.js';
import { autoApproveQuoteKeywords } from '../services/unmatchedEntityHandler.js';
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

  const publishedAfter = req.query.publishedAfter || null;
  const publishedBefore = req.query.publishedBefore || null;
  const excludeReviewed = req.query.excludeReviewed === '1';

  const visibilityFilter = admin ? '' : 'AND q.is_visible = 1';
  const topStoriesFilter = tab === 'top-stories' ? 'AND (a.is_top_story = 1 OR s.is_top_story = 1)' : '';
  const { sql: categoryFilter, params: categoryParams } = getBroadCategoryFilter(category);
  const subFilterSql = subFilter ? 'AND (p.category_context LIKE ? OR p.category LIKE ? OR q.context LIKE ?)' : '';
  const searchFilter = search ? 'AND (q.text LIKE ? OR p.canonical_name LIKE ? OR p.category LIKE ? OR q.context LIKE ? OR a.title LIKE ?)' : '';
  const publishedAfterFilter = publishedAfter ? 'AND a.published_at >= ?' : '';
  const publishedBeforeFilter = publishedBefore ? 'AND a.published_at <= ?' : '';
  const reviewedFilter = excludeReviewed ? 'AND q.reviewed_at IS NULL' : '';

  const params = [...categoryParams];
  if (subFilterSql) {
    const sfTerm = `%${subFilter}%`;
    params.push(sfTerm, sfTerm, sfTerm);
  }
  if (searchFilter) {
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
  }
  if (publishedAfter) params.push(publishedAfter);
  if (publishedBefore) params.push(publishedBefore);

  // Count total canonical quotes (not variants)
  const total = db.prepare(
    `SELECT COUNT(DISTINCT q.id) as count FROM quotes q
     JOIN persons p ON q.person_id = p.id
     LEFT JOIN quote_articles qa ON qa.quote_id = q.id
     LEFT JOIN articles a ON qa.article_id = a.id
     LEFT JOIN sources s ON a.source_id = s.id
     WHERE q.canonical_quote_id IS NULL ${visibilityFilter} ${topStoriesFilter} ${categoryFilter} ${subFilterSql} ${searchFilter} ${publishedAfterFilter} ${publishedBeforeFilter} ${reviewedFilter}`
  ).get(...params).count;

  // Get quotes with person info + first linked article/source + vote score
  const quotes = db.prepare(`
    SELECT q.id, q.text, q.source_urls, q.created_at, q.quote_datetime, q.context, q.quote_type, q.is_visible,
           q.rss_metadata, q.fact_check_verdict,
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
    WHERE q.canonical_quote_id IS NULL ${visibilityFilter} ${topStoriesFilter} ${categoryFilter} ${subFilterSql} ${searchFilter} ${publishedAfterFilter} ${publishedBeforeFilter} ${reviewedFilter}
    GROUP BY q.id
    ORDER BY COALESCE(
      CASE WHEN q.quote_datetime GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
        THEN q.quote_datetime ELSE NULL END,
      q.created_at) DESC
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
    quoteDateTime: q.quote_datetime || null,
    importantsCount: q.importants_count,
    factCheckVerdict: q.fact_check_verdict || null,
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
               q.fact_check_verdict,
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
           q.fact_check_verdict,
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
    factCheckVerdict: q.fact_check_verdict || null,
  };
}

// Get unreviewed quote counts grouped by person category (admin only)
router.get('/category-counts', requireAdmin, (req, res) => {
  const db = getDb();
  const counts = db.prepare(`
    SELECT p.category, COUNT(*) as count
    FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.reviewed_at IS NULL AND q.canonical_quote_id IS NULL AND q.is_visible = 1
    GROUP BY p.category
    ORDER BY count DESC
  `).all();

  res.json({ counts: counts.map(c => ({ category: c.category || 'Other', count: c.count })) });
});

// Bulk mark all unreviewed quotes for a category as reviewed (admin only)
router.post('/bulk-review', requireAdmin, (req, res) => {
  const db = getDb();
  const { category } = req.body;

  if (!category) {
    return res.status(400).json({ error: 'category is required' });
  }

  // Find all unreviewed quote IDs matching this category
  const categoryFilter = category === 'Other'
    ? 'AND (p.category IS NULL OR p.category = ?)'
    : 'AND p.category = ?';
  const categoryParam = category === 'Other' ? 'Other' : category;

  const quotes = db.prepare(`
    SELECT q.id FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.reviewed_at IS NULL AND q.canonical_quote_id IS NULL AND q.is_visible = 1
    ${categoryFilter}
  `).all(categoryParam);

  if (quotes.length === 0) {
    return res.json({ success: true, count: 0 });
  }

  // Bulk update reviewed_at
  const bulkReview = db.transaction(() => {
    const stmt = db.prepare("UPDATE quotes SET reviewed_at = datetime('now') WHERE id = ?");
    for (const q of quotes) {
      stmt.run(q.id);
    }
  });
  bulkReview();

  // Auto-approve keywords for each quote (non-fatal)
  for (const q of quotes) {
    try {
      autoApproveQuoteKeywords(q.id);
    } catch {
      // Non-fatal
    }
  }

  res.json({ success: true, count: quotes.length });
});

// Bulk delete all unreviewed quotes for a category (admin only)
router.post('/bulk-delete', requireAdmin, (req, res) => {
  const db = getDb();
  const { category } = req.body;

  if (!category) {
    return res.status(400).json({ error: 'category is required' });
  }

  const categoryFilter = category === 'Other'
    ? 'AND (p.category IS NULL OR p.category = ?)'
    : 'AND p.category = ?';
  const categoryParam = category === 'Other' ? 'Other' : category;

  const quotes = db.prepare(`
    SELECT q.id, q.person_id FROM quotes q
    JOIN persons p ON q.person_id = p.id
    WHERE q.reviewed_at IS NULL AND q.canonical_quote_id IS NULL AND q.is_visible = 1
    ${categoryFilter}
  `).all(categoryParam);

  if (quotes.length === 0) {
    return res.json({ success: true, count: 0 });
  }

  const affectedPersonIds = new Set(quotes.map(q => q.person_id));

  const bulkDelete = db.transaction(() => {
    for (const q of quotes) {
      const quoteId = q.id;
      db.prepare('UPDATE quotes SET canonical_quote_id = NULL WHERE canonical_quote_id = ?').run(quoteId);
      db.prepare('DELETE FROM quote_relationships WHERE quote_id_a = ? OR quote_id_b = ?').run(quoteId, quoteId);
      db.prepare("DELETE FROM importants WHERE entity_type = 'quote' AND entity_id = ?").run(quoteId);
      db.prepare("DELETE FROM noteworthy_items WHERE entity_type = 'quote' AND entity_id = ?").run(quoteId);
      db.prepare('UPDATE disambiguation_queue SET quote_id = NULL WHERE quote_id = ?').run(quoteId);
      db.prepare('DELETE FROM quote_articles WHERE quote_id = ?').run(quoteId);
      db.prepare('DELETE FROM votes WHERE quote_id = ?').run(quoteId);
      db.prepare('DELETE FROM quote_context_cache WHERE quote_id = ?').run(quoteId);
      db.prepare('DELETE FROM quote_smart_related WHERE quote_id = ? OR related_quote_id = ?').run(quoteId, quoteId);
      db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);
    }

    // Recalculate quote_count for all affected persons
    for (const personId of affectedPersonIds) {
      db.prepare(`
        UPDATE persons SET quote_count = (
          SELECT COUNT(*) FROM quotes WHERE person_id = ? AND is_visible = 1 AND canonical_quote_id IS NULL
        ) WHERE id = ?
      `).run(personId, personId);
    }
  });

  bulkDelete();

  res.json({ success: true, count: quotes.length });
});

// 1x1 transparent JPEG for 404 fallback (prevents broken images in social crawlers)
const FALLBACK_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AKwA//9k=',
  'base64'
);

// Generate share image for a quote (landscape for OG, portrait for download)
router.get('/:id/share-image', async (req, res) => {
  try {
    const db = getDb();
    const format = req.query.format === 'portrait' ? 'portrait' : 'landscape';

    const quote = db.prepare(`
      SELECT q.id, q.text, q.context, q.fact_check_category, q.fact_check_verdict,
             q.fact_check_claim, q.fact_check_explanation, q.is_visible,
             p.canonical_name, p.disambiguation, p.photo_url,
             a.title AS article_title, s.name AS source_name
      FROM quotes q
      JOIN persons p ON q.person_id = p.id
      LEFT JOIN quote_articles qa ON qa.quote_id = q.id
      LEFT JOIN articles a ON qa.article_id = a.id
      LEFT JOIN sources s ON a.source_id = s.id
      WHERE q.id = ?
    `).get(req.params.id);

    if (!quote || !quote.is_visible) {
      res.set('Content-Type', 'image/jpeg');
      res.set('Cache-Control', 'no-cache');
      return res.status(404).send(FALLBACK_JPEG);
    }

    const jpegBuffer = await generateShareImage({
      quoteId: quote.id,
      quoteText: quote.text,
      authorName: quote.canonical_name,
      disambiguation: quote.disambiguation,
      photoUrl: quote.photo_url || null,
      verdict: quote.fact_check_verdict,
      category: quote.fact_check_category,
      claim: quote.fact_check_claim,
      explanation: quote.fact_check_explanation,
    }, format);

    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(jpegBuffer);
  } catch (err) {
    console.error('[share-image] Generation failed:', err.message);
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'no-cache');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.status(500).send(FALLBACK_JPEG);
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

  const response = {
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
  };

  // Admin-only: include full details for the admin panel
  if (admin) {
    response.quote.quoteDateTime = quote.quote_datetime || null;
    response.quote.firstSeenAt = quote.first_seen_at || null;
    response.quote.rssMetadata = quote.rss_metadata ? JSON.parse(quote.rss_metadata) : null;
    response.quote.shareCount = quote.share_count || 0;
    response.quote.trendingScore = quote.trending_score || 0;
    response.quote.factCheckCategory = quote.fact_check_category || null;
    response.quote.factCheckConfidence = quote.fact_check_confidence != null ? quote.fact_check_confidence : null;
    response.quote.canonicalQuoteId = quote.canonical_quote_id || null;

    const person = db.prepare('SELECT * FROM persons WHERE id = ?').get(quote.person_id);
    if (person) {
      const metadata = person.metadata ? JSON.parse(person.metadata) : {};
      response.adminAuthor = {
        id: person.id,
        canonicalName: person.canonical_name,
        disambiguation: person.disambiguation,
        wikidataId: person.wikidata_id,
        firstSeenAt: person.first_seen_at,
        lastSeenAt: person.last_seen_at,
        quoteCount: person.quote_count,
        photoUrl: person.photo_url || null,
        category: person.category || 'Other',
        categoryContext: person.category_context || null,
        importantsCount: person.importants_count || 0,
        shareCount: person.share_count || 0,
        viewCount: person.view_count || 0,
        trendingScore: person.trending_score || 0,
        organizations: metadata.organizations || [],
        titles: metadata.titles || [],
      };
    }

    if (articles.length > 0) {
      const sourceIds = new Set();
      const adminSources = [];
      for (const a of articles) {
        const art = db.prepare('SELECT source_id FROM articles WHERE id = ?').get(a.id);
        if (art && art.source_id && !sourceIds.has(art.source_id)) {
          sourceIds.add(art.source_id);
          const src = db.prepare('SELECT * FROM sources WHERE id = ?').get(art.source_id);
          if (src) {
            adminSources.push({
              id: src.id, domain: src.domain, name: src.name,
              rssUrl: src.rss_url, enabled: src.enabled,
              isTopStory: src.is_top_story,
              consecutiveFailures: src.consecutive_failures,
              createdAt: src.created_at, updatedAt: src.updated_at,
            });
          }
        }
      }
      response.adminSources = adminSources;
    }

    const topics = db.prepare(`
      SELECT t.id, t.name, t.status FROM quote_topics qt
      JOIN topics t ON qt.topic_id = t.id WHERE qt.quote_id = ? ORDER BY t.name
    `).all(quote.id);
    response.adminTopics = topics;

    const keywords = db.prepare(`
      SELECT k.id, k.name, qk.confidence FROM quote_keywords qk
      JOIN keywords k ON qk.keyword_id = k.id WHERE qk.quote_id = ? ORDER BY k.name
    `).all(quote.id);
    response.adminKeywords = keywords;

    response.adminExtractedKeywords = quote.extracted_keywords
      ? JSON.parse(quote.extracted_keywords)
      : [];
  }

  res.json(response);
});

// Mark quote as reviewed (admin only)
router.post('/:id/reviewed', requireAdmin, (req, res) => {
  const db = getDb();
  const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' });
  }
  db.prepare("UPDATE quotes SET reviewed_at = datetime('now') WHERE id = ?").run(req.params.id);

  // Auto-approve extracted keywords and link to quote
  try {
    autoApproveQuoteKeywords(parseInt(req.params.id));
  } catch {
    // Non-fatal — reviewed status already saved
  }

  res.json({ success: true });
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

// Delete a single quote (admin only)
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const quoteId = parseInt(req.params.id);

  const quote = db.prepare('SELECT id, person_id FROM quotes WHERE id = ?').get(quoteId);
  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  const deleteOne = db.transaction(() => {
    // Unlink variants pointing to this quote
    db.prepare('UPDATE quotes SET canonical_quote_id = NULL WHERE canonical_quote_id = ?').run(quoteId);
    // Clean related tables (no FK cascade)
    db.prepare('DELETE FROM quote_relationships WHERE quote_id_a = ? OR quote_id_b = ?').run(quoteId, quoteId);
    db.prepare("DELETE FROM importants WHERE entity_type = 'quote' AND entity_id = ?").run(quoteId);
    db.prepare("DELETE FROM noteworthy_items WHERE entity_type = 'quote' AND entity_id = ?").run(quoteId);
    db.prepare('UPDATE disambiguation_queue SET quote_id = NULL WHERE quote_id = ?').run(quoteId);
    db.prepare('DELETE FROM quote_articles WHERE quote_id = ?').run(quoteId);
    db.prepare('DELETE FROM votes WHERE quote_id = ?').run(quoteId);
    db.prepare('DELETE FROM quote_context_cache WHERE quote_id = ?').run(quoteId);
    db.prepare('DELETE FROM quote_smart_related WHERE quote_id = ? OR related_quote_id = ?').run(quoteId, quoteId);
    // Delete the quote itself
    db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);
    // Recalculate person quote_count
    db.prepare(`
      UPDATE persons SET quote_count = (
        SELECT COUNT(*) FROM quotes WHERE person_id = ? AND is_visible = 1 AND canonical_quote_id IS NULL
      ) WHERE id = ?
    `).run(quote.person_id, quote.person_id);
  });

  deleteOne();

  res.json({ success: true, deletedId: quoteId });
});

// Edit quote fields (admin only)
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { text, context, quoteType, quoteDateTime, isVisible } = req.body;

  const quote = db.prepare('SELECT id, person_id FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) {
    return res.status(404).json({ error: 'Quote not found' });
  }

  if (text !== undefined) {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Quote text cannot be empty' });
    }
    db.prepare('UPDATE quotes SET text = ? WHERE id = ?').run(text.trim(), req.params.id);
    // Invalidate fact check cache — text changed, results are stale
    db.prepare(`
      UPDATE quotes
      SET fact_check_html = NULL, fact_check_references_json = NULL,
          fact_check_verdict = NULL, fact_check_claim = NULL, fact_check_explanation = NULL
      WHERE id = ?
    `).run(req.params.id);
  }

  if (context !== undefined) {
    db.prepare('UPDATE quotes SET context = ? WHERE id = ?').run(context || null, req.params.id);
  }

  if (quoteType !== undefined) {
    if (!['direct', 'indirect'].includes(quoteType)) {
      return res.status(400).json({ error: 'quoteType must be "direct" or "indirect"' });
    }
    db.prepare('UPDATE quotes SET quote_type = ? WHERE id = ?').run(quoteType, req.params.id);
  }

  if (quoteDateTime !== undefined) {
    db.prepare('UPDATE quotes SET quote_datetime = ? WHERE id = ?').run(quoteDateTime || null, req.params.id);
  }

  if (isVisible !== undefined) {
    db.prepare('UPDATE quotes SET is_visible = ? WHERE id = ?').run(isVisible ? 1 : 0, req.params.id);
    db.prepare(`
      UPDATE persons SET quote_count = (
        SELECT COUNT(*) FROM quotes WHERE person_id = ? AND is_visible = 1 AND canonical_quote_id IS NULL
      ) WHERE id = ?
    `).run(quote.person_id, quote.person_id);
  }

  // Invalidate share image cache when quote is edited
  invalidateShareImageCache(parseInt(req.params.id));

  const updated = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  res.json({
    success: true,
    quote: {
      id: updated.id, text: updated.text, context: updated.context,
      quoteType: updated.quote_type, quoteDateTime: updated.quote_datetime,
      isVisible: updated.is_visible,
    },
  });
});

export default router;
