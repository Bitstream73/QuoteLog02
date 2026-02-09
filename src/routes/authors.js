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
    // Search by name (for backwards compatibility with old URL format)
    person = db.prepare('SELECT * FROM persons WHERE canonical_name = ?').get(decodeURIComponent(id));
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
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
