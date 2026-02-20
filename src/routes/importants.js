import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';
import { recalculateEntityScore } from '../services/trendingCalculator.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

const VALID_TYPES = ['quote', 'article', 'person', 'topic', 'category'];
const TABLE_MAP = { quote: 'quotes', article: 'articles', person: 'persons', topic: 'topics', category: 'categories' };

// Pre-built SQL queries per entity type — eliminates all dynamic table name interpolation
const QUERIES = {
  quote: {
    exists: 'SELECT id FROM quotes WHERE id = ?',
    decrement: 'UPDATE quotes SET importants_count = MAX(importants_count - 1, 0) WHERE id = ?',
    increment: 'UPDATE quotes SET importants_count = importants_count + 1 WHERE id = ?',
    getCount: 'SELECT importants_count FROM quotes WHERE id = ?',
    superIncrement: 'UPDATE quotes SET importants_count = importants_count + 100 WHERE id = ?',
  },
  article: {
    exists: 'SELECT id FROM articles WHERE id = ?',
    decrement: 'UPDATE articles SET importants_count = MAX(importants_count - 1, 0) WHERE id = ?',
    increment: 'UPDATE articles SET importants_count = importants_count + 1 WHERE id = ?',
    getCount: 'SELECT importants_count FROM articles WHERE id = ?',
    superIncrement: 'UPDATE articles SET importants_count = importants_count + 100 WHERE id = ?',
  },
  person: {
    exists: 'SELECT id FROM persons WHERE id = ?',
    decrement: 'UPDATE persons SET importants_count = MAX(importants_count - 1, 0) WHERE id = ?',
    increment: 'UPDATE persons SET importants_count = importants_count + 1 WHERE id = ?',
    getCount: 'SELECT importants_count FROM persons WHERE id = ?',
    superIncrement: 'UPDATE persons SET importants_count = importants_count + 100 WHERE id = ?',
  },
  topic: {
    exists: 'SELECT id FROM topics WHERE id = ?',
    decrement: 'UPDATE topics SET importants_count = MAX(importants_count - 1, 0) WHERE id = ?',
    increment: 'UPDATE topics SET importants_count = importants_count + 1 WHERE id = ?',
    getCount: 'SELECT importants_count FROM topics WHERE id = ?',
    superIncrement: 'UPDATE topics SET importants_count = importants_count + 100 WHERE id = ?',
  },
  category: {
    exists: 'SELECT id FROM categories WHERE id = ?',
    decrement: 'UPDATE categories SET importants_count = MAX(importants_count - 1, 0) WHERE id = ?',
    increment: 'UPDATE categories SET importants_count = importants_count + 1 WHERE id = ?',
    getCount: 'SELECT importants_count FROM categories WHERE id = ?',
    superIncrement: 'UPDATE categories SET importants_count = importants_count + 100 WHERE id = ?',
  },
};

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

// POST /api/importants/toggle
router.post('/toggle', (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id } = req.body;

    if (!entity_type || !VALID_TYPES.includes(entity_type)) {
      return res.status(400).json({ error: `Invalid entity_type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }

    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }

    const queries = QUERIES[entity_type];

    // Validate entity exists
    const entity = db.prepare(queries.exists).get(entity_id);
    if (!entity) {
      return res.status(404).json({ error: `${entity_type} not found` });
    }

    const voterHash = getVoterHash(req);

    // Check if already marked as important
    const existing = db.prepare(
      'SELECT id FROM importants WHERE entity_type = ? AND entity_id = ? AND voter_hash = ?'
    ).get(entity_type, entity_id, voterHash);

    let isImportant;

    if (existing) {
      // Toggle OFF: delete record and decrement count
      db.prepare('DELETE FROM importants WHERE id = ?').run(existing.id);
      db.prepare(queries.decrement).run(entity_id);
      isImportant = false;
    } else {
      // Toggle ON: insert record and increment count
      db.prepare(
        'INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)'
      ).run(entity_type, entity_id, voterHash);
      db.prepare(queries.increment).run(entity_id);
      isImportant = true;
    }

    // Get updated count
    const updated = db.prepare(queries.getCount).get(entity_id);
    const importants_count = updated.importants_count;

    // Trigger trending score recalculation
    try {
      recalculateEntityScore(db, entity_type, entity_id);
    } catch (err) {
      console.error('Trending recalc error after important toggle:', err);
    }

    // Emit Socket.IO event
    const io = req.app.get('io');
    if (io) {
      io.emit('important_update', { entity_type, entity_id, importants_count });
    }

    res.json({
      success: true,
      is_important: isImportant,
      importants_count,
    });
  } catch (err) {
    console.error('Importants toggle error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/importants/super-toggle (admin-only, +100 boost)
router.post('/super-toggle', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id } = req.body;

    if (!entity_type || !VALID_TYPES.includes(entity_type)) {
      return res.status(400).json({ error: `Invalid entity_type. Must be one of: ${VALID_TYPES.join(', ')}` });
    }

    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }

    const queries = QUERIES[entity_type];

    // Validate entity exists
    const entity = db.prepare(queries.exists).get(entity_id);
    if (!entity) {
      return res.status(404).json({ error: `${entity_type} not found` });
    }

    // Increment importants_count by 100 (no voter_hash row)
    db.prepare(queries.superIncrement).run(entity_id);

    // Get updated count
    const updated = db.prepare(queries.getCount).get(entity_id);
    const importants_count = updated.importants_count;

    // Recalculate trending score
    try {
      recalculateEntityScore(db, entity_type, entity_id);
    } catch (err) {
      console.error('Trending recalc error after super-toggle:', err);
    }

    // Emit Socket.IO event
    const io = req.app.get('io');
    if (io) {
      io.emit('important_update', { entity_type, entity_id, importants_count });
    }

    res.json({ success: true, importants_count });
  } catch (err) {
    console.error('Super-toggle error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/importants/status
router.get('/status', (req, res) => {
  try {
    const db = getDb();
    const entitiesParam = req.query.entities || '';

    if (!entitiesParam) {
      return res.json({ statuses: {} });
    }

    const pairs = entitiesParam.split(',').map(s => s.trim()).filter(Boolean);
    const voterHash = getVoterHash(req);
    const statuses = {};

    for (const pair of pairs) {
      const [type, idStr] = pair.split(':');
      if (!type || !idStr || !VALID_TYPES.includes(type)) continue;

      const id = parseInt(idStr, 10);
      if (isNaN(id)) continue;

      const existing = db.prepare(
        'SELECT id FROM importants WHERE entity_type = ? AND entity_id = ? AND voter_hash = ?'
      ).get(type, id, voterHash);

      statuses[`${type}:${id}`] = !!existing;
    }

    res.json({ statuses });
  } catch (err) {
    console.error('Importants status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
