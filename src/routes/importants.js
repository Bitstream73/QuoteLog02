import { Router } from 'express';
import { getDb } from '../config/database.js';
import { createHash } from 'crypto';

const router = Router();

const VALID_TYPES = ['quote', 'article', 'person', 'topic'];
const TABLE_MAP = { quote: 'quotes', article: 'articles', person: 'persons', topic: 'topics' };

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

    const tableName = TABLE_MAP[entity_type];

    // Validate entity exists
    const entity = db.prepare(`SELECT id FROM ${tableName} WHERE id = ?`).get(entity_id);
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
      db.prepare(`UPDATE ${tableName} SET importants_count = MAX(importants_count - 1, 0) WHERE id = ?`).run(entity_id);
      isImportant = false;
    } else {
      // Toggle ON: insert record and increment count
      db.prepare(
        'INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)'
      ).run(entity_type, entity_id, voterHash);
      db.prepare(`UPDATE ${tableName} SET importants_count = importants_count + 1 WHERE id = ?`).run(entity_id);
      isImportant = true;
    }

    // Get updated count
    const updated = db.prepare(`SELECT importants_count FROM ${tableName} WHERE id = ?`).get(entity_id);
    const importants_count = updated.importants_count;

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
