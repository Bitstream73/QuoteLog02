import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';
import { recalculateEntityScore } from '../services/trendingCalculator.js';

const router = Router();

const VIEW_TABLES = { article: 'articles', person: 'persons' };
const SHARE_TABLES = { quote: 'quotes', article: 'articles', person: 'persons' };

// Pre-built SQL queries per entity type — eliminates all dynamic table name interpolation
const VIEW_QUERIES = {
  article: {
    exists: 'SELECT id FROM articles WHERE id = ?',
    increment: 'UPDATE articles SET view_count = view_count + 1 WHERE id = ?',
  },
  person: {
    exists: 'SELECT id FROM persons WHERE id = ?',
    increment: 'UPDATE persons SET view_count = view_count + 1 WHERE id = ?',
  },
};

const SHARE_QUERIES = {
  quote: {
    exists: 'SELECT id FROM quotes WHERE id = ?',
    increment: 'UPDATE quotes SET share_count = share_count + 1 WHERE id = ?',
    getCount: 'SELECT share_count FROM quotes WHERE id = ?',
  },
  article: {
    exists: 'SELECT id FROM articles WHERE id = ?',
    increment: 'UPDATE articles SET share_count = share_count + 1 WHERE id = ?',
    getCount: 'SELECT share_count FROM articles WHERE id = ?',
  },
  person: {
    exists: 'SELECT id FROM persons WHERE id = ?',
    increment: 'UPDATE persons SET share_count = share_count + 1 WHERE id = ?',
    getCount: 'SELECT share_count FROM persons WHERE id = ?',
  },
};

function getVoterHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  const ua = req.get('User-Agent') || '';
  return createHash('sha256').update(`${ip}:${ua}`).digest('hex');
}

// In-memory view dedup: max 1 view per entity per voter per 5 minutes
const viewDedup = new Map();

function isDuplicateView(voterHash, entityType, entityId) {
  const key = `${voterHash}:${entityType}:${entityId}`;
  const last = viewDedup.get(key);
  if (last && Date.now() - last < 5 * 60 * 1000) return true;
  viewDedup.set(key, Date.now());
  // Periodic cleanup: remove entries older than 10 minutes
  if (viewDedup.size > 10000) {
    const cutoff = Date.now() - 10 * 60 * 1000;
    for (const [k, v] of viewDedup) {
      if (v < cutoff) viewDedup.delete(k);
    }
  }
  return false;
}

// POST /api/tracking/view
router.post('/view', (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id } = req.body;

    if (!entity_type || !VIEW_TABLES[entity_type]) {
      return res.status(400).json({ error: `Invalid entity_type for view. Must be one of: ${Object.keys(VIEW_TABLES).join(', ')}` });
    }

    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }

    const viewQueries = VIEW_QUERIES[entity_type];

    // Validate entity exists
    const entity = db.prepare(viewQueries.exists).get(entity_id);
    if (!entity) {
      return res.status(404).json({ error: `${entity_type} not found` });
    }

    // Dedup check
    const voterHash = getVoterHash(req);
    if (!isDuplicateView(voterHash, entity_type, entity_id)) {
      db.prepare(viewQueries.increment).run(entity_id);
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Tracking view error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/tracking/share
router.post('/share', (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id } = req.body;

    if (!entity_type || !SHARE_TABLES[entity_type]) {
      return res.status(400).json({ error: `Invalid entity_type for share. Must be one of: ${Object.keys(SHARE_TABLES).join(', ')}` });
    }

    if (!entity_id) {
      return res.status(400).json({ error: 'Missing entity_id' });
    }

    const shareQueries = SHARE_QUERIES[entity_type];

    // Validate entity exists
    const entity = db.prepare(shareQueries.exists).get(entity_id);
    if (!entity) {
      return res.status(404).json({ error: `${entity_type} not found` });
    }

    // Increment share_count
    db.prepare(shareQueries.increment).run(entity_id);

    // Get updated count
    const updated = db.prepare(shareQueries.getCount).get(entity_id);

    // Trigger trending score recalculation
    try {
      recalculateEntityScore(db, entity_type, entity_id);
    } catch (err) {
      console.error('Trending recalc error after share:', err);
    }

    res.json({
      success: true,
      share_count: updated.share_count,
    });
  } catch (err) {
    console.error('Tracking share error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
