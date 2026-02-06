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

// List all authors (persons) with quote counts
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;

  const total = db.prepare('SELECT COUNT(*) as count FROM persons').get().count;

  const authors = db.prepare(`
    SELECT id, canonical_name, disambiguation, quote_count, last_seen_at
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
      organizations: metadata.organizations || [],
      titles: metadata.titles || [],
      topics: metadata.topics || [],
    },
    aliases: aliases.map(a => ({ alias: a.alias, type: a.alias_type })),
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
    SELECT id, text, source_urls, created_at, context, quote_type, is_visible
    FROM quotes
    WHERE person_id = ? AND canonical_quote_id IS NULL ${visFilter}
    ORDER BY created_at DESC
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
    })),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

export default router;
