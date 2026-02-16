import { Router } from 'express';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// Get review queue stats
router.get('/stats', requireAdmin, (req, res) => {
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
router.get('/', requireAdmin, (req, res) => {
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
router.post('/:id/merge', requireAdmin, (req, res) => {
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

    // Record merge in audit trail
    db.prepare(`INSERT INTO person_merges (surviving_person_id, merged_person_id, merged_by, confidence, reason)
      VALUES (?, ?, 'user', ?, ?)`)
      .run(item.candidate_person_id, item.id, item.similarity_score, `Merged "${item.new_name}" into existing person`);

    // Mark review item as resolved
    db.prepare(`UPDATE disambiguation_queue SET
      status = 'merged', resolved_by = 'user', resolved_at = datetime('now')
      WHERE id = ?`).run(id);
  })();

  res.json({ success: true, action: 'merged' });
});

// Reject - create new person
router.post('/:id/reject', requireAdmin, (req, res) => {
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
router.post('/:id/skip', requireAdmin, (req, res) => {
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
router.post('/batch', requireAdmin, (req, res) => {
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

        // Record merge in audit trail
        db.prepare(`INSERT INTO person_merges (surviving_person_id, merged_person_id, merged_by, confidence, reason)
          VALUES (?, ?, 'user', ?, ?)`)
          .run(item.candidate_person_id, id, item.similarity_score, `Batch merged "${item.new_name}" into existing person`);

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

// --- Topic/Keyword Review Routes ---

// GET /api/review/topics-keywords — list items pending review
router.get('/topics-keywords', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const status = req.query.status || 'pending';
    const entityType = req.query.entity_type || null;

    let where = 'WHERE tkr.status = ?';
    const params = [status];

    if (entityType && ['topic', 'keyword'].includes(entityType)) {
      where += ' AND tkr.entity_type = ?';
      params.push(entityType);
    }

    const total = db.prepare(`
      SELECT COUNT(*) as count FROM topic_keyword_review tkr ${where}
    `).get(...params).count;

    params.push(limit, offset);
    const items = db.prepare(`
      SELECT tkr.*,
        CASE
          WHEN tkr.entity_type = 'topic' THEN (SELECT t.name FROM topics t WHERE t.id = tkr.entity_id)
          WHEN tkr.entity_type = 'keyword' THEN (SELECT k.name FROM keywords k WHERE k.id = tkr.entity_id)
        END as current_name,
        CASE
          WHEN tkr.entity_type = 'topic' THEN (SELECT t.enabled FROM topics t WHERE t.id = tkr.entity_id)
          WHEN tkr.entity_type = 'keyword' THEN (SELECT k.enabled FROM keywords k WHERE k.id = tkr.entity_id)
        END as enabled
      FROM topic_keyword_review tkr
      ${where}
      ORDER BY tkr.created_at ASC
      LIMIT ? OFFSET ?
    `).all(...params);

    res.json({
      items,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list review items' });
  }
});

// GET /api/review/topics-keywords/stats — review stats
router.get('/topics-keywords/stats', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const pending = db.prepare("SELECT COUNT(*) as count FROM topic_keyword_review WHERE status = 'pending'").get().count;
    const approved = db.prepare("SELECT COUNT(*) as count FROM topic_keyword_review WHERE status = 'approved'").get().count;
    const rejected = db.prepare("SELECT COUNT(*) as count FROM topic_keyword_review WHERE status = 'rejected'").get().count;
    const pendingTopics = db.prepare("SELECT COUNT(*) as count FROM topic_keyword_review WHERE status = 'pending' AND entity_type = 'topic'").get().count;
    const pendingKeywords = db.prepare("SELECT COUNT(*) as count FROM topic_keyword_review WHERE status = 'pending' AND entity_type = 'keyword'").get().count;

    res.json({ pending, approved, rejected, pendingTopics, pendingKeywords });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get review stats' });
  }
});

// POST /api/review/topics-keywords/:id/approve — approve and enable the entity
router.post('/topics-keywords/:id/approve', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM topic_keyword_review WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Review item not found' });
    if (item.status !== 'pending') return res.status(400).json({ error: 'Item already resolved' });

    db.transaction(() => {
      // Enable the entity
      if (item.entity_type === 'topic') {
        db.prepare('UPDATE topics SET enabled = 1 WHERE id = ?').run(item.entity_id);
      } else {
        db.prepare('UPDATE keywords SET enabled = 1 WHERE id = ?').run(item.entity_id);
      }
      // Mark as approved
      db.prepare("UPDATE topic_keyword_review SET status = 'approved', resolved_at = datetime('now') WHERE id = ?").run(item.id);
    })();

    res.json({ success: true, action: 'approved' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to approve item' });
  }
});

// POST /api/review/topics-keywords/:id/reject — reject and keep disabled
router.post('/topics-keywords/:id/reject', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const item = db.prepare('SELECT * FROM topic_keyword_review WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Review item not found' });
    if (item.status !== 'pending') return res.status(400).json({ error: 'Item already resolved' });

    db.prepare("UPDATE topic_keyword_review SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?").run(item.id);

    res.json({ success: true, action: 'rejected' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject item' });
  }
});

// POST /api/review/topics-keywords/:id/edit — rename the entity and approve
router.post('/topics-keywords/:id/edit', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { new_name } = req.body;
    if (!new_name || typeof new_name !== 'string') {
      return res.status(400).json({ error: 'new_name is required' });
    }

    const item = db.prepare('SELECT * FROM topic_keyword_review WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Review item not found' });
    if (item.status !== 'pending') return res.status(400).json({ error: 'Item already resolved' });

    const trimmedName = new_name.trim();

    db.transaction(() => {
      if (item.entity_type === 'topic') {
        const slug = trimmedName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        db.prepare('UPDATE topics SET name = ?, slug = ?, enabled = 1 WHERE id = ?').run(trimmedName, slug, item.entity_id);
      } else {
        db.prepare('UPDATE keywords SET name = ?, name_normalized = ?, enabled = 1 WHERE id = ?')
          .run(trimmedName, trimmedName.toLowerCase(), item.entity_id);
      }
      db.prepare("UPDATE topic_keyword_review SET status = 'edited', resolved_at = datetime('now') WHERE id = ?").run(item.id);
    })();

    res.json({ success: true, action: 'edited', new_name: trimmedName });
  } catch (err) {
    res.status(500).json({ error: 'Failed to edit item' });
  }
});

// POST /api/review/topics-keywords/reject-all-keywords — reject all pending keywords at once
router.post('/topics-keywords/reject-all-keywords', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const count = db.prepare(
      "SELECT COUNT(*) as count FROM topic_keyword_review WHERE status = 'pending' AND entity_type = 'keyword'"
    ).get().count;

    if (count === 0) {
      return res.json({ success: true, rejected: 0, message: 'No pending keywords to reject' });
    }

    const result = db.prepare(
      "UPDATE topic_keyword_review SET status = 'rejected', resolved_at = datetime('now') WHERE status = 'pending' AND entity_type = 'keyword'"
    ).run();

    res.json({ success: true, rejected: result.changes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject all keywords' });
  }
});

// POST /api/review/topics-keywords/batch — batch approve/reject
router.post('/topics-keywords/batch', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { action, ids } = req.body;

    if (!action || !ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'action and ids array required' });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'action must be approve or reject' });
    }

    const results = [];

    db.transaction(() => {
      for (const id of ids) {
        const item = db.prepare('SELECT * FROM topic_keyword_review WHERE id = ?').get(id);
        if (!item || item.status !== 'pending') {
          results.push({ id, success: false, reason: 'not found or already resolved' });
          continue;
        }

        if (action === 'approve') {
          if (item.entity_type === 'topic') {
            db.prepare('UPDATE topics SET enabled = 1 WHERE id = ?').run(item.entity_id);
          } else {
            db.prepare('UPDATE keywords SET enabled = 1 WHERE id = ?').run(item.entity_id);
          }
          db.prepare("UPDATE topic_keyword_review SET status = 'approved', resolved_at = datetime('now') WHERE id = ?").run(id);
          results.push({ id, success: true, action: 'approved' });
        } else {
          db.prepare("UPDATE topic_keyword_review SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?").run(id);
          results.push({ id, success: true, action: 'rejected' });
        }
      }
    })();

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Batch operation failed' });
  }
});

export default router;
