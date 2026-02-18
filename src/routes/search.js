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

// GET /api/search/unified?q=...&limit=20
// Searches across quotes, persons, articles
router.get('/unified', (req, res) => {
  try {
    const db = getDb();
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'Query must be at least 2 characters' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const searchTerm = `%${q}%`;
    const admin = isAdminRequest(req);
    const visibilityFilter = admin ? '' : 'AND q.is_visible = 1';

    // Search quotes
    const quotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.created_at, q.importants_count,
        p.id as person_id, p.canonical_name as person_name, p.photo_url
      FROM quotes q
      JOIN persons p ON p.id = q.person_id
      WHERE q.canonical_quote_id IS NULL ${visibilityFilter}
        AND (q.text LIKE ? OR q.context LIKE ?)
      ORDER BY q.importants_count DESC, q.created_at DESC
      LIMIT ?
    `).all(searchTerm, searchTerm, limit);

    // Search persons
    const persons = db.prepare(`
      SELECT p.id, p.canonical_name, p.photo_url, p.category, p.category_context,
        p.quote_count, p.importants_count
      FROM persons p
      WHERE p.canonical_name LIKE ?
      ORDER BY p.quote_count DESC
      LIMIT ?
    `).all(searchTerm, limit);

    // Search articles
    const articles = db.prepare(`
      SELECT a.id, a.url, a.title, a.published_at,
        s.domain as source_domain, s.name as source_name
      FROM articles a
      LEFT JOIN sources s ON s.id = a.source_id
      WHERE a.title LIKE ? AND a.status = 'completed'
      ORDER BY a.created_at DESC
      LIMIT ?
    `).all(searchTerm, limit);

    res.json({ quotes, persons, articles });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// GET /api/search/autocomplete?q=...&limit=8
// Fast autocomplete for search bar — returns a flat list of suggestions
router.get('/autocomplete', (req, res) => {
  try {
    const db = getDb();
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const limit = Math.min(parseInt(req.query.limit) || 8, 20);
    const searchTerm = `%${q}%`;
    const suggestions = [];

    // Person names
    const persons = db.prepare(`
      SELECT canonical_name as label, 'person' as type, id
      FROM persons
      WHERE canonical_name LIKE ?
      ORDER BY quote_count DESC
      LIMIT ?
    `).all(searchTerm, limit);
    suggestions.push(...persons);

    // Trim to overall limit
    res.json({ suggestions: suggestions.slice(0, limit) });
  } catch (err) {
    res.json({ suggestions: [] });
  }
});

// GET /api/search/noteworthy — public endpoint for noteworthy items on homepage
router.get('/noteworthy', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);

    const items = db.prepare(`
      SELECT n.id, n.entity_type, n.entity_id, n.display_order,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT q.text FROM quotes q WHERE q.id = n.entity_id)
          WHEN n.entity_type = 'article' THEN (SELECT a.title FROM articles a WHERE a.id = n.entity_id)
          WHEN n.entity_type = 'topic' THEN (SELECT t.name FROM topics t WHERE t.id = n.entity_id)
          WHEN n.entity_type = 'category' THEN (SELECT c.name FROM categories c WHERE c.id = n.entity_id)
        END as entity_label,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT p2.canonical_name FROM quotes q2 JOIN persons p2 ON p2.id = q2.person_id WHERE q2.id = n.entity_id)
          ELSE NULL
        END as person_name,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT p3.photo_url FROM quotes q3 JOIN persons p3 ON p3.id = q3.person_id WHERE q3.id = n.entity_id)
          ELSE NULL
        END as photo_url
      FROM noteworthy_items n
      WHERE n.active = 1
      ORDER BY n.display_order ASC, n.created_at DESC
      LIMIT ?
    `).all(limit);

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load noteworthy items' });
  }
});

export default router;
