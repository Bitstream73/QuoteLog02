import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

// Get review queue stats
router.get('/stats', (req, res) => {
  const db = getDb();

  const pending = db.prepare(
    "SELECT COUNT(*) as count FROM disambiguation_queue WHERE status = 'pending'"
  ).get().count;

  const resolvedToday = db.prepare(
    `SELECT COUNT(*) as count FROM disambiguation_queue
     WHERE resolved_at >= datetime('now', '-1 day')
     AND status != 'pending'`
  ).get().count;

  res.json({ pending, resolved_today: resolvedToday });
});

// List pending review items
router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;

  const total = db.prepare(
    "SELECT COUNT(*) as count FROM disambiguation_queue WHERE status = 'pending'"
  ).get().count;

  const items = db.prepare(`
    SELECT dq.*,
           p.canonical_name as candidate_canonical_name,
           p.disambiguation as candidate_disambiguation,
           p.quote_count as candidate_quote_count,
           p.metadata as candidate_metadata
    FROM disambiguation_queue dq
    LEFT JOIN persons p ON dq.candidate_person_id = p.id
    WHERE dq.status = 'pending'
    ORDER BY dq.created_at ASC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  // Enrich with aliases and recent quotes for each candidate
  const enrichedItems = items.map(item => {
    if (item.candidate_person_id) {
      const aliases = db.prepare(
        'SELECT alias FROM person_aliases WHERE person_id = ? LIMIT 10'
      ).all(item.candidate_person_id).map(a => a.alias);

      const recentQuotes = db.prepare(
        `SELECT text FROM quotes
         WHERE person_id = ? AND canonical_quote_id IS NULL
         ORDER BY created_at DESC LIMIT 3`
      ).all(item.candidate_person_id).map(q =>
        q.text.length > 100 ? q.text.substring(0, 100) + '...' : q.text
      );

      return {
        ...item,
        candidate_aliases: aliases,
        candidate_recent_quotes: recentQuotes,
        match_signals: item.match_signals ? JSON.parse(item.match_signals) : null,
        candidate_metadata: item.candidate_metadata ? JSON.parse(item.candidate_metadata) : null,
      };
    }
    return {
      ...item,
      match_signals: item.match_signals ? JSON.parse(item.match_signals) : null,
    };
  });

  res.json({
    items: enrichedItems,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

// Merge new name into existing person
router.post('/:id/merge', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const item = db.prepare('SELECT * FROM disambiguation_queue WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: 'Review item not found' });
  }

  if (item.status !== 'pending') {
    return res.status(400).json({ error: 'Item already resolved' });
  }

  if (!item.candidate_person_id) {
    return res.status(400).json({ error: 'No candidate person to merge into' });
  }

  db.transaction(() => {
    // Add the new name as an alias of the existing person
    db.prepare(`INSERT INTO person_aliases (person_id, alias, alias_normalized, alias_type, confidence, source)
      VALUES (?, ?, ?, 'variant', 1.0, 'user')`)
      .run(item.candidate_person_id, item.new_name, item.new_name_normalized);

    // Update the quote to point to the existing person
    if (item.quote_id) {
      db.prepare('UPDATE quotes SET person_id = ? WHERE id = ?')
        .run(item.candidate_person_id, item.quote_id);
    }

    // Update person last_seen_at and quote_count
    db.prepare(`UPDATE persons SET
      last_seen_at = datetime('now'),
      quote_count = (SELECT COUNT(*) FROM quotes WHERE person_id = ? AND canonical_quote_id IS NULL)
      WHERE id = ?`).run(item.candidate_person_id, item.candidate_person_id);

    // Mark review item as resolved
    db.prepare(`UPDATE disambiguation_queue SET
      status = 'merged', resolved_by = 'user', resolved_at = datetime('now')
      WHERE id = ?`).run(id);
  })();

  res.json({ success: true, action: 'merged' });
});

// Reject - create new person
router.post('/:id/reject', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const item = db.prepare('SELECT * FROM disambiguation_queue WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: 'Review item not found' });
  }

  if (item.status !== 'pending') {
    return res.status(400).json({ error: 'Item already resolved' });
  }

  let newPersonId;
  db.transaction(() => {
    // Create new person
    const result = db.prepare(`INSERT INTO persons (canonical_name, disambiguation, metadata)
      VALUES (?, NULL, '{}')`)
      .run(item.new_name);
    newPersonId = result.lastInsertRowid;

    // Add alias
    db.prepare(`INSERT INTO person_aliases (person_id, alias, alias_normalized, alias_type, confidence, source)
      VALUES (?, ?, ?, 'full_name', 1.0, 'user')`)
      .run(newPersonId, item.new_name, item.new_name_normalized);

    // Update the quote to point to the new person
    if (item.quote_id) {
      db.prepare('UPDATE quotes SET person_id = ? WHERE id = ?')
        .run(newPersonId, item.quote_id);
    }

    // Mark review item as resolved
    db.prepare(`UPDATE disambiguation_queue SET
      status = 'new_person', resolved_by = 'user', resolved_at = datetime('now')
      WHERE id = ?`).run(id);
  })();

  res.json({ success: true, action: 'new_person', personId: newPersonId });
});

// Skip for later
router.post('/:id/skip', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const item = db.prepare('SELECT * FROM disambiguation_queue WHERE id = ?').get(id);
  if (!item) {
    return res.status(404).json({ error: 'Review item not found' });
  }

  // Move to end of queue by updating created_at
  db.prepare(`UPDATE disambiguation_queue SET created_at = datetime('now') WHERE id = ?`).run(id);

  res.json({ success: true, action: 'skipped' });
});

// Batch operations
router.post('/batch', (req, res) => {
  const db = getDb();
  const { action, ids } = req.body;

  if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'action and ids array required' });
  }

  if (!['merge', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'action must be merge or reject' });
  }

  const results = [];

  db.transaction(() => {
    for (const id of ids) {
      const item = db.prepare('SELECT * FROM disambiguation_queue WHERE id = ?').get(id);
      if (!item || item.status !== 'pending') {
        results.push({ id, success: false, reason: 'not found or already resolved' });
        continue;
      }

      if (action === 'merge') {
        if (!item.candidate_person_id) {
          results.push({ id, success: false, reason: 'no candidate to merge into' });
          continue;
        }

        db.prepare(`INSERT INTO person_aliases (person_id, alias, alias_normalized, alias_type, confidence, source)
          VALUES (?, ?, ?, 'variant', 1.0, 'user')`)
          .run(item.candidate_person_id, item.new_name, item.new_name_normalized);

        if (item.quote_id) {
          db.prepare('UPDATE quotes SET person_id = ? WHERE id = ?')
            .run(item.candidate_person_id, item.quote_id);
        }

        db.prepare(`UPDATE persons SET
          last_seen_at = datetime('now'),
          quote_count = (SELECT COUNT(*) FROM quotes WHERE person_id = ? AND canonical_quote_id IS NULL)
          WHERE id = ?`).run(item.candidate_person_id, item.candidate_person_id);

        db.prepare(`UPDATE disambiguation_queue SET
          status = 'merged', resolved_by = 'user', resolved_at = datetime('now')
          WHERE id = ?`).run(id);

        results.push({ id, success: true, action: 'merged' });
      } else if (action === 'reject') {
        const result = db.prepare(`INSERT INTO persons (canonical_name, disambiguation, metadata)
          VALUES (?, NULL, '{}')`)
          .run(item.new_name);
        const newPersonId = result.lastInsertRowid;

        db.prepare(`INSERT INTO person_aliases (person_id, alias, alias_normalized, alias_type, confidence, source)
          VALUES (?, ?, ?, 'full_name', 1.0, 'user')`)
          .run(newPersonId, item.new_name, item.new_name_normalized);

        if (item.quote_id) {
          db.prepare('UPDATE quotes SET person_id = ? WHERE id = ?')
            .run(newPersonId, item.quote_id);
        }

        db.prepare(`UPDATE disambiguation_queue SET
          status = 'new_person', resolved_by = 'user', resolved_at = datetime('now')
          WHERE id = ?`).run(id);

        results.push({ id, success: true, action: 'new_person', personId: newPersonId });
      }
    }
  })();

  res.json({ results });
});

export default router;
