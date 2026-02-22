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

    // Search categories
    const categories = db.prepare(`
      SELECT c.id, c.name, c.slug, c.image_url, c.icon_name,
        (SELECT COUNT(DISTINCT qt.quote_id)
         FROM category_topics ct
         JOIN quote_topics qt ON qt.topic_id = ct.topic_id
         WHERE ct.category_id = c.id) AS quote_count
      FROM categories c
      WHERE c.name LIKE ?
      ORDER BY c.sort_order, c.name
      LIMIT ?
    `).all(searchTerm, limit);

    res.json({ quotes, persons, articles, categories });
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

// GET /api/search/noteworthy — public endpoint for noteworthy items on homepage (enriched)
router.get('/noteworthy', (req, res) => {
  try {
    const db = getDb();
    const limit = Math.min(parseInt(req.query.limit) || 10, 30);

    const items = db.prepare(`
      SELECT n.id, n.entity_type, n.entity_id, n.display_order, n.full_width,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT q.text FROM quotes q WHERE q.id = n.entity_id)
          WHEN n.entity_type = 'article' THEN (SELECT a.title FROM articles a WHERE a.id = n.entity_id)
          WHEN n.entity_type = 'topic' THEN (SELECT t.name FROM topics t WHERE t.id = n.entity_id)
          WHEN n.entity_type = 'category' THEN (SELECT c.name FROM categories c WHERE c.id = n.entity_id)
          WHEN n.entity_type = 'person' THEN (SELECT p.canonical_name FROM persons p WHERE p.id = n.entity_id)
        END as entity_label,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT p2.canonical_name FROM quotes q2 JOIN persons p2 ON p2.id = q2.person_id WHERE q2.id = n.entity_id)
          ELSE NULL
        END as person_name,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT p3.photo_url FROM quotes q3 JOIN persons p3 ON p3.id = q3.person_id WHERE q3.id = n.entity_id)
          WHEN n.entity_type = 'person' THEN (SELECT p4.photo_url FROM persons p4 WHERE p4.id = n.entity_id)
          ELSE NULL
        END as photo_url
      FROM noteworthy_items n
      WHERE n.active = 1
      ORDER BY n.display_order ASC, n.created_at DESC
      LIMIT ?
    `).all(limit);

    // Enrich each item with additional data
    for (const item of items) {
      if (item.entity_type === 'quote') {
        const extra = db.prepare(`
          SELECT q.fact_check_verdict, q.importants_count, q.context,
            p.category_context as person_category_context
          FROM quotes q LEFT JOIN persons p ON p.id = q.person_id WHERE q.id = ?
        `).get(item.entity_id);
        if (extra) {
          item.fact_check_verdict = extra.fact_check_verdict;
          item.importants_count = extra.importants_count;
          item.context = extra.context;
          item.person_category_context = extra.person_category_context;
        }
      } else if (item.entity_type === 'person') {
        const extra = db.prepare(`
          SELECT p.category, p.category_context FROM persons p WHERE p.id = ?
        `).get(item.entity_id);
        if (extra) {
          item.category = extra.category;
          item.category_context = extra.category_context;
        }
        // Top 3 quotes by importants_count (last 24h)
        item.top_quotes = db.prepare(`
          SELECT q.id, q.text, q.context, p.canonical_name as person_name,
            q.importants_count, q.fact_check_verdict, p.photo_url
          FROM quotes q
          JOIN persons p ON p.id = q.person_id
          WHERE q.person_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
            AND q.created_at >= datetime('now', '-1 day')
          ORDER BY q.importants_count DESC
          LIMIT 3
        `).all(item.entity_id);
        // If no recent quotes, get top 3 overall
        if (item.top_quotes.length === 0) {
          item.top_quotes = db.prepare(`
            SELECT q.id, q.text, q.context, p.canonical_name as person_name,
              q.importants_count, q.fact_check_verdict, p.photo_url
            FROM quotes q
            JOIN persons p ON p.id = q.person_id
            WHERE q.person_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
            ORDER BY q.importants_count DESC
            LIMIT 3
          `).all(item.entity_id);
        }
      } else if (item.entity_type === 'topic') {
        const extra = db.prepare(`
          SELECT t.slug, t.description FROM topics t WHERE t.id = ?
        `).get(item.entity_id);
        if (extra) {
          item.slug = extra.slug;
          item.description = extra.description;
        }
        // Top 3 quotes by importants_count (last 1 day) via quote_topics
        item.top_quotes = db.prepare(`
          SELECT q.id, q.text, q.context, p.canonical_name as person_name,
            q.importants_count, q.fact_check_verdict, p.photo_url
          FROM quotes q
          JOIN persons p ON p.id = q.person_id
          JOIN quote_topics qt ON qt.quote_id = q.id
          WHERE qt.topic_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
            AND q.created_at >= datetime('now', '-1 day')
          ORDER BY q.importants_count DESC
          LIMIT 3
        `).all(item.entity_id);
        if (item.top_quotes.length === 0) {
          item.top_quotes = db.prepare(`
            SELECT q.id, q.text, q.context, p.canonical_name as person_name,
              q.importants_count, q.fact_check_verdict, p.photo_url
            FROM quotes q
            JOIN persons p ON p.id = q.person_id
            JOIN quote_topics qt ON qt.quote_id = q.id
            WHERE qt.topic_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
            ORDER BY q.importants_count DESC
            LIMIT 3
          `).all(item.entity_id);
        }
      } else if (item.entity_type === 'category') {
        const extra = db.prepare(`
          SELECT c.slug, c.image_url, c.icon_name FROM categories c WHERE c.id = ?
        `).get(item.entity_id);
        if (extra) {
          item.slug = extra.slug;
          item.image_url = extra.image_url || null;
          item.icon_name = extra.icon_name || null;
        }
        // Top 3 quotes by importants_count (last 1 day) via category_topics -> quote_topics
        item.top_quotes = db.prepare(`
          SELECT q.id, q.text, q.context, p.canonical_name as person_name,
            q.importants_count, q.fact_check_verdict, p.photo_url
          FROM quotes q
          JOIN persons p ON p.id = q.person_id
          JOIN quote_topics qt ON qt.quote_id = q.id
          JOIN category_topics ct ON ct.topic_id = qt.topic_id
          WHERE ct.category_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
            AND q.created_at >= datetime('now', '-1 day')
          GROUP BY q.id
          ORDER BY q.importants_count DESC
          LIMIT 3
        `).all(item.entity_id);
        if (item.top_quotes.length === 0) {
          item.top_quotes = db.prepare(`
            SELECT q.id, q.text, q.context, p.canonical_name as person_name,
              q.importants_count, q.fact_check_verdict, p.photo_url
            FROM quotes q
            JOIN persons p ON p.id = q.person_id
            JOIN quote_topics qt ON qt.quote_id = q.id
            JOIN category_topics ct ON ct.topic_id = qt.topic_id
            WHERE ct.category_id = ? AND q.is_visible = 1 AND q.canonical_quote_id IS NULL
            GROUP BY q.id
            ORDER BY q.importants_count DESC
            LIMIT 3
          `).all(item.entity_id);
        }
      } else if (item.entity_type === 'article') {
        const extra = db.prepare(`
          SELECT s.name as source_name FROM articles a LEFT JOIN sources s ON s.id = a.source_id WHERE a.id = ?
        `).get(item.entity_id);
        if (extra) {
          item.source_name = extra.source_name;
        }
        // Top 3 articles from same source (last 1 day), fallback to all-time
        item.top_articles = db.prepare(`
          SELECT a2.id, a2.title, a2.importants_count
          FROM articles a2
          WHERE a2.source_id = (SELECT a.source_id FROM articles a WHERE a.id = ?)
            AND a2.id != ?
            AND a2.created_at >= datetime('now', '-1 day')
          ORDER BY a2.importants_count DESC
          LIMIT 3
        `).all(item.entity_id, item.entity_id);
        if (item.top_articles.length === 0) {
          item.top_articles = db.prepare(`
            SELECT a2.id, a2.title, a2.importants_count
            FROM articles a2
            WHERE a2.source_id = (SELECT a.source_id FROM articles a WHERE a.id = ?)
              AND a2.id != ?
            ORDER BY a2.importants_count DESC
            LIMIT 3
          `).all(item.entity_id, item.entity_id);
        }
      }
    }

    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load noteworthy items' });
  }
});

// GET /api/noteworthy/evaluated — public endpoint for evaluated card configs
router.get('/noteworthy/evaluated', (req, res) => {
  try {
    const db = getDb();

    // Fetch enabled card configs
    const configs = db.prepare(`
      SELECT ncc.*, nc.name as collection_name
      FROM noteworthy_card_configs ncc
      LEFT JOIN noteworthy_collections nc ON nc.id = ncc.collection_id
      WHERE ncc.enabled = 1
      ORDER BY ncc.display_order ASC
    `).all();

    // Fetch enabled collections
    const collections = db.prepare(
      'SELECT * FROM noteworthy_collections WHERE enabled = 1 ORDER BY display_order ASC'
    ).all();

    // Fetch pepper settings
    const pepperKeys = [
      'noteworthy_pepper_frequency',
      'noteworthy_pepper_chance',
      'noteworthy_pick_mode',
      'noteworthy_reuse_cards',
    ];
    const pepper_settings = {};
    for (const key of pepperKeys) {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
      pepper_settings[key] = row ? row.value : null;
    }

    // Evaluate each config (stub — evaluator added in Phase 7)
    const cards = configs.map(config => {
      const cardType = config.card_type;
      let data = {};

      if (cardType.startsWith('search_')) {
        data = { search_type: cardType.replace('search_', '') };
      } else if (cardType.startsWith('info_')) {
        data = { info_type: cardType.replace('info_', '') };
      } else {
        // Time-based cards — stub until evaluator is built
        const parts = cardType.split('_of_');
        data = { entity_type: parts[0], time_period: parts[1], entity: null, top_quotes: [] };
      }

      return {
        id: config.id,
        card_type: cardType,
        custom_title: config.custom_title,
        collection_id: config.collection_id,
        config: config.config,
        data,
      };
    });

    res.json({ cards, collections, pepper_settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to evaluate noteworthy cards' });
  }
});

export default router;
