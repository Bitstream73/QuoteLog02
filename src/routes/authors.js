import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import config from '../config/index.js';
import gemini from '../services/ai/gemini.js';
import { fetchHeadshotUrl } from '../services/personPhoto.js';
import logger from '../services/logger.js';

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

// List all authors (persons) with quote counts
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM persons').get().count;

  const authors = db.prepare(`
    SELECT id, canonical_name, disambiguation, quote_count, last_seen_at, photo_url, category, category_context
    FROM persons
    ORDER BY quote_count DESC, last_seen_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  res.json({
    authors,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

// Get single author (person) details
router.get('/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  // Try to find by ID first, then by name
  let person;
  if (/^\d+$/.test(id)) {
    person = db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
  } else {
    // Search by name — redirect to canonical numeric URL
    person = db.prepare('SELECT * FROM persons WHERE canonical_name = ?').get(decodeURIComponent(id));
    if (person) {
      return res.redirect(301, `/api/authors/${person.id}`);
    }
  }

  if (!person) {
    return res.status(404).json({ error: 'Author not found' });
  }

  // Get aliases
  const aliases = db.prepare(
    'SELECT alias, alias_type FROM person_aliases WHERE person_id = ? ORDER BY confidence DESC'
  ).all(person.id);

  // Parse metadata
  const metadata = person.metadata ? JSON.parse(person.metadata) : {};

  res.json({
    author: {
      id: person.id,
      name: person.canonical_name,
      disambiguation: person.disambiguation,
      quoteCount: person.quote_count,
      firstSeenAt: person.first_seen_at,
      lastSeenAt: person.last_seen_at,
      wikidataId: person.wikidata_id,
      photoUrl: person.photo_url || null,
      category: person.category || 'Other',
      categoryContext: person.category_context || null,
      organizations: metadata.organizations || [],
      titles: metadata.titles || [],
      topics: metadata.topics || [],
    },
    aliases: aliases.map(a => ({ alias: a.alias, type: a.alias_type })),
  });
});

// Update author details (admin only)
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { photoUrl, category, categoryContext, canonicalName, disambiguation } = req.body;

  const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(id);
  if (!person) {
    return res.status(404).json({ error: 'Author not found' });
  }

  if (canonicalName !== undefined) {
    if (typeof canonicalName !== 'string' || canonicalName.trim().length === 0) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    db.prepare('UPDATE persons SET canonical_name = ? WHERE id = ?').run(canonicalName.trim(), id);
  }
  if (disambiguation !== undefined) {
    db.prepare('UPDATE persons SET disambiguation = ? WHERE id = ?').run(disambiguation || null, id);
  }
  if (photoUrl !== undefined) {
    db.prepare('UPDATE persons SET photo_url = ? WHERE id = ?').run(photoUrl || null, id);
  }
  if (category !== undefined) {
    db.prepare('UPDATE persons SET category = ? WHERE id = ?').run(category, id);
  }
  if (categoryContext !== undefined) {
    db.prepare('UPDATE persons SET category_context = ? WHERE id = ?').run(categoryContext || null, id);
  }

  const updated = db.prepare('SELECT * FROM persons WHERE id = ?').get(id);
  res.json({
    success: true,
    author: {
      id: updated.id,
      name: updated.canonical_name,
      disambiguation: updated.disambiguation,
      photoUrl: updated.photo_url,
      category: updated.category,
      categoryContext: updated.category_context,
    },
  });
});

// Get cached image suggestions for an author (admin only)
router.get('/:id/image-suggestions', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const person = db.prepare('SELECT image_suggestions FROM persons WHERE id = ?').get(id);
  if (!person) {
    return res.status(404).json({ error: 'Author not found' });
  }

  let suggestions = [];
  if (person.image_suggestions) {
    try {
      suggestions = JSON.parse(person.image_suggestions);
    } catch { /* invalid JSON, return empty */ }
  }

  res.json({ suggestions });
});

// AI-powered image search for an author (admin only)
router.post('/:id/image-search', requireAdmin, async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const person = db.prepare('SELECT canonical_name, disambiguation FROM persons WHERE id = ?').get(id);
  if (!person) {
    return res.status(404).json({ error: 'Author not found' });
  }

  const name = person.canonical_name;
  const desc = person.disambiguation || '';

  try {
    // Try Wikipedia first
    const wikiUrl = await fetchHeadshotUrl(name);

    // Call Gemini with grounded search
    const prompt = `Find 3 high-quality portrait/headshot photograph URLs of ${name}${desc ? ` (${desc})` : ''}.
Return direct image file URLs (jpg, png, webp) from reliable sources like Wikipedia, news outlets, government sites, or official sources.
Return a JSON array of objects: [{ "url": "direct image URL", "description": "brief description", "source": "website name" }]
Only return URLs that point directly to image files. Prefer official portraits and professional photos.`;

    let aiResults = [];
    try {
      const raw = await gemini.generateGroundedJSON(prompt, { temperature: 0.2 });
      aiResults = Array.isArray(raw) ? raw : (raw._groundingMetadata ? [] : [raw]);
      // Strip grounding metadata if present at top level
      aiResults = aiResults.filter(r => r && r.url);
    } catch (aiErr) {
      logger.warn('authors', 'image_search_ai_failed', { personId: id, error: aiErr.message });
    }

    // Validate each URL with HEAD request
    const validated = [];
    for (const item of aiResults) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const headRes = await fetch(item.url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timeout);
        if (headRes.ok && (headRes.headers.get('content-type') || '').startsWith('image/')) {
          validated.push({
            url: item.url,
            description: item.description || '',
            source: item.source || '',
          });
        }
      } catch { /* skip invalid URLs */ }
    }

    // Add Wikipedia result as first suggestion if valid and not already present
    if (wikiUrl && !validated.some(v => v.url === wikiUrl)) {
      validated.unshift({
        url: wikiUrl,
        description: 'Wikipedia portrait',
        source: 'Wikipedia',
      });
    }

    // Limit to 3 suggestions
    const suggestions = validated.slice(0, 3);

    // Cache in database
    db.prepare('UPDATE persons SET image_suggestions = ? WHERE id = ?')
      .run(JSON.stringify(suggestions), id);

    res.json({ suggestions });
  } catch (err) {
    logger.error('authors', 'image_search_failed', { personId: id }, err);
    res.status(500).json({ error: 'Image search failed' });
  }
});

// Get quotes for a specific author
router.get('/:id/quotes', (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  // Find person
  let personId;
  if (/^\d+$/.test(id)) {
    personId = parseInt(id, 10);
  } else {
    const person = db.prepare('SELECT id FROM persons WHERE canonical_name = ?')
      .get(decodeURIComponent(id));
    if (!person) {
      return res.status(404).json({ error: 'Author not found' });
    }
    personId = person.id;
  }

  const admin = isAdminRequest(req);
  const visFilter = admin ? '' : 'AND is_visible = 1';

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM quotes WHERE person_id = ? AND canonical_quote_id IS NULL ${visFilter}`
  ).get(personId).count;

  const quotes = db.prepare(`
    SELECT q.id, q.text, q.source_urls, q.created_at, q.context, q.quote_type, q.is_visible,
           q.fact_check_verdict,
           a.id AS article_id, a.title AS article_title, a.published_at AS article_published_at, a.url AS article_url,
           s.domain AS primary_source_domain, s.name AS primary_source_name,
           COALESCE((SELECT SUM(vote_value) FROM votes WHERE votes.quote_id = q.id), 0) as vote_score
    FROM quotes q
    LEFT JOIN quote_articles qa ON qa.quote_id = q.id
    LEFT JOIN articles a ON qa.article_id = a.id
    LEFT JOIN sources s ON a.source_id = s.id
    WHERE q.person_id = ? AND q.canonical_quote_id IS NULL ${visFilter}
    GROUP BY q.id
    ORDER BY q.created_at DESC
    LIMIT ? OFFSET ?
  `).all(personId, limit, offset);

  res.json({
    quotes: quotes.map(q => ({
      id: q.id,
      text: q.text,
      context: q.context,
      quoteType: q.quote_type,
      sourceUrls: JSON.parse(q.source_urls || '[]'),
      createdAt: q.created_at,
      articleId: q.article_id || null,
      articleTitle: q.article_title || null,
      articlePublishedAt: q.article_published_at || null,
      articleUrl: q.article_url || null,
      primarySourceDomain: q.primary_source_domain || null,
      primarySourceName: q.primary_source_name || null,
      voteScore: q.vote_score,
      factCheckVerdict: q.fact_check_verdict || null,
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
