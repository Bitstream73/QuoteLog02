import { Router } from 'express';
import gemini from '../services/ai/gemini.js';
import { requireAdmin } from '../middleware/auth.js';
import { createBackup, listBackups, exportDatabaseJson, importDatabaseJson } from '../services/backup.js';
import { backfillHeadshots } from '../services/personPhoto.js';
import vectorDb, { embedQuote } from '../services/vectorDb.js';
import { getDb } from '../config/database.js';
import config from '../config/index.js';
import logger from '../services/logger.js';

const router = Router();

// All admin routes require authentication
router.use(requireAdmin);

// Download database as JSON export
router.get('/backup', (req, res) => {
  try {
    const data = exportDatabaseJson();
    const filename = `quotelog-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Export failed: ' + err.message });
  }
});

// Trigger manual backup to disk
router.post('/backup', async (req, res) => {
  try {
    const result = await createBackup();
    res.json({ message: 'Backup created', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Backup failed: ' + err.message });
  }
});

// Upload and restore from JSON export
router.post('/restore', (req, res) => {
  try {
    const data = req.body;
    if (!data || !data.tables) {
      return res.status(400).json({ error: 'Invalid backup format: missing tables property' });
    }
    const result = importDatabaseJson(data);
    res.json({ message: 'Restore complete', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Restore failed: ' + err.message });
  }
});

// List available on-disk backups
router.get('/backups', (req, res) => {
  try {
    const backups = listBackups();
    res.json({ backups });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list backups: ' + err.message });
  }
});

// Backfill headshot photos from Wikipedia
router.post('/backfill-headshots', async (req, res) => {
  try {
    const limit = parseInt(req.body?.limit) || 50;
    const result = await backfillHeadshots(limit);
    res.json({ message: 'Headshot backfill complete', ...result });
  } catch (err) {
    res.status(500).json({ error: 'Backfill failed: ' + err.message });
  }
});

// Backfill Pinecone with enriched quote data (context + person_name)
router.post('/backfill-pinecone', async (req, res) => {
  const batchSize = Math.min(parseInt(req.body?.batch_size) || 50, 200);

  if (!config.pineconeApiKey || !config.pineconeIndexHost) {
    return res.status(400).json({ error: 'Pinecone not configured' });
  }

  try {
    const db = getDb();

    const quotes = db.prepare(`
      SELECT q.id, q.text, q.context, q.person_id, p.canonical_name
      FROM quotes q
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL
      ORDER BY q.created_at DESC
      LIMIT ?
    `).all(batchSize);

    if (quotes.length === 0) {
      return res.json({ message: 'No quotes to backfill', processed: 0, errors: 0, remaining: 0 });
    }

    const totalVisible = db.prepare(`
      SELECT COUNT(*) AS count FROM quotes
      WHERE is_visible = 1 AND canonical_quote_id IS NULL
    `).get().count;

    let processed = 0;
    let errors = 0;

    for (const quote of quotes) {
      try {
        await embedQuote(quote.id, quote.text, quote.person_id, quote.context, quote.canonical_name);
        processed++;
      } catch (err) {
        logger.error('admin', 'backfill_pinecone_error', { quoteId: quote.id, error: err.message });
        errors++;
      }

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 100));
    }

    res.json({
      message: 'Pinecone backfill complete',
      processed,
      errors,
      remaining: totalVisible - processed,
    });
  } catch (err) {
    res.status(500).json({ error: 'Backfill failed: ' + err.message });
  }
});

// --- Quote Quality Purge ---

async function classifyQuoteBatch(quotes) {
  const items = quotes.map((q, i) => `[${i + 1}] "${q.text}" — ${q.canonical_name}${q.context ? ` (context: ${q.context})` : ''}`).join('\n');
  const prompt = `Classify each quote into exactly one category:
A = Verifiable factual claim (contains statistics, dates, quantities, specific events that can be checked)
B = Opinion, value judgment, prediction, or editorial (substantive but not fact-checkable)
C = Platitude, fluff, fragment, or rhetorical statement (no substance, cliché, or incomplete)

Quotes:
${items}

Return JSON: {"classifications":[{"index":1,"category":"A","confidence":0.9},...]}
Every quote MUST have exactly one classification. The "index" matches the number in brackets.`;

  const result = await gemini.generateJSON(prompt, { temperature: 0.1 });
  return (result.classifications || []).map(c => ({
    quoteId: quotes[c.index - 1]?.id,
    category: c.category,
    confidence: c.confidence,
  })).filter(c => c.quoteId && ['A', 'B', 'C'].includes(c.category));
}

function deleteQuotesBatch(db, quoteIds) {
  if (quoteIds.length === 0) return;
  const CHUNK = 500;
  const deleteChunked = db.transaction((ids) => {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const placeholders = chunk.map(() => '?').join(',');

      // Unlink variants pointing to deleted quotes
      db.prepare(`UPDATE quotes SET canonical_quote_id = NULL WHERE canonical_quote_id IN (${placeholders})`).run(...chunk);
      // Clean quote_relationships (no cascade)
      db.prepare(`DELETE FROM quote_relationships WHERE quote_id_a IN (${placeholders}) OR quote_id_b IN (${placeholders})`).run(...chunk, ...chunk);
      // Clean importants (polymorphic)
      db.prepare(`DELETE FROM importants WHERE entity_type = 'quote' AND entity_id IN (${placeholders})`).run(...chunk);
      // Clean noteworthy_items (polymorphic)
      db.prepare(`DELETE FROM noteworthy_items WHERE entity_type = 'quote' AND entity_id IN (${placeholders})`).run(...chunk);
      // Null out disambiguation_queue refs
      db.prepare(`UPDATE disambiguation_queue SET quote_id = NULL WHERE quote_id IN (${placeholders})`).run(...chunk);
      // Delete from tables with FK to quotes (cascade not enforced)
      db.prepare(`DELETE FROM quote_articles WHERE quote_id IN (${placeholders})`).run(...chunk);
      db.prepare(`DELETE FROM votes WHERE quote_id IN (${placeholders})`).run(...chunk);
      db.prepare(`DELETE FROM quote_context_cache WHERE quote_id IN (${placeholders})`).run(...chunk);
      db.prepare(`DELETE FROM quote_smart_related WHERE quote_id IN (${placeholders}) OR related_quote_id IN (${placeholders})`).run(...chunk, ...chunk);
      // Delete the quotes themselves
      db.prepare(`DELETE FROM quotes WHERE id IN (${placeholders})`).run(...chunk);
    }
  });
  deleteChunked(quoteIds);

  // Recalculate person quote_count for affected persons
  db.prepare(`
    UPDATE persons SET quote_count = (
      SELECT COUNT(*) FROM quotes WHERE person_id = persons.id AND is_visible = 1 AND canonical_quote_id IS NULL
    )
  `).run();
}

router.post('/purge-quality', async (req, res) => {
  const dryRun = req.body?.dry_run !== false;
  const batchSize = Math.min(Math.max(parseInt(req.body?.batch_size) || 10, 1), 20);

  try {
    const db = getDb();
    const result = { dry_run: dryRun, phase1: {}, phase2: {}, pinecone_deleted: 0 };
    const allDeletedIds = [];

    // Phase 1: Delete invisible quotes
    const invisibleQuotes = db.prepare(`
      SELECT id FROM quotes WHERE is_visible = 0 AND canonical_quote_id IS NULL
    `).all();
    result.phase1.invisible_found = invisibleQuotes.length;

    if (!dryRun && invisibleQuotes.length > 0) {
      const ids = invisibleQuotes.map(q => q.id);
      deleteQuotesBatch(db, ids);
      allDeletedIds.push(...ids);
      result.phase1.deleted = ids.length;
    } else {
      result.phase1.deleted = 0;
    }

    // Phase 2: Classify unclassified visible quotes
    const unclassifiedTotal = db.prepare(`
      SELECT COUNT(*) as count FROM quotes
      WHERE is_visible = 1 AND canonical_quote_id IS NULL AND fact_check_category IS NULL
    `).get().count;

    let classified = 0;
    let classifyErrors = 0;
    const breakdown = { category_A: 0, category_B: 0, category_C: 0 };

    if (config.geminiApiKey && unclassifiedTotal > 0) {
      let remaining = true;
      while (remaining) {
        const batch = db.prepare(`
          SELECT q.id, q.text, q.context, p.canonical_name
          FROM quotes q
          JOIN persons p ON p.id = q.person_id
          WHERE q.is_visible = 1 AND q.canonical_quote_id IS NULL AND q.fact_check_category IS NULL
          LIMIT ?
        `).all(batchSize);

        if (batch.length === 0) { remaining = false; break; }

        try {
          const classifications = await classifyQuoteBatch(batch);
          const updateStmt = db.prepare(`UPDATE quotes SET fact_check_category = ?, fact_check_confidence = ? WHERE id = ?`);
          const applyClassifications = db.transaction((cls) => {
            for (const c of cls) {
              updateStmt.run(c.category, c.confidence, c.quoteId);
              breakdown[`category_${c.category}`]++;
            }
          });
          applyClassifications(classifications);
          classified += classifications.length;
          if (classifications.length === 0) break; // No progress — avoid infinite loop
        } catch (err) {
          if (err.message?.includes('429') || err.message?.includes('rate')) {
            logger.warn('admin', 'purge_quality_rate_limit', { error: err.message });
            break;
          }
          classifyErrors++;
          logger.error('admin', 'purge_quality_classify_error', { error: err.message });
        }

        await new Promise(r => setTimeout(r, 200));
      }
    }

    const remainingUnclassified = db.prepare(`
      SELECT COUNT(*) as count FROM quotes
      WHERE is_visible = 1 AND canonical_quote_id IS NULL AND fact_check_category IS NULL
    `).get().count;

    // Phase 3: Delete B and C quotes
    const bcQuotes = db.prepare(`
      SELECT id FROM quotes WHERE fact_check_category IN ('B', 'C')
    `).all();

    result.phase2 = {
      classified,
      classify_errors: classifyErrors,
      remaining_unclassified: remainingUnclassified,
      pending_deletion: bcQuotes.length,
      deleted: 0,
      breakdown,
    };

    if (!dryRun && bcQuotes.length > 0) {
      const ids = bcQuotes.map(q => q.id);
      deleteQuotesBatch(db, ids);
      allDeletedIds.push(...ids);
      result.phase2.deleted = ids.length;
    }

    // Pinecone cleanup
    if (!dryRun && allDeletedIds.length > 0) {
      try {
        const pineconeIds = allDeletedIds.map(id => `quote-${id}`);
        await vectorDb.deleteManyByIds(pineconeIds);
        result.pinecone_deleted = pineconeIds.length;
      } catch (err) {
        logger.error('admin', 'purge_quality_pinecone_error', { error: err.message });
        result.pinecone_error = err.message;
      }
    }

    res.json(result);
  } catch (err) {
    logger.error('admin', 'purge_quality_error', { error: err.message });
    res.status(500).json({ error: 'Purge failed: ' + err.message });
  }
});

// --- Noteworthy CRUD ---

// GET /api/admin/noteworthy — list noteworthy items
router.get('/noteworthy', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const items = db.prepare(`
      SELECT n.*,
        CASE
          WHEN n.entity_type = 'quote' THEN (SELECT q.text FROM quotes q WHERE q.id = n.entity_id)
          WHEN n.entity_type = 'article' THEN (SELECT a.title FROM articles a WHERE a.id = n.entity_id)
          WHEN n.entity_type = 'topic' THEN (SELECT t.name FROM topics t WHERE t.id = n.entity_id)
        END as entity_label
      FROM noteworthy_items n
      WHERE n.active = 1
      ORDER BY n.display_order ASC, n.created_at DESC
    `).all();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list noteworthy items' });
  }
});

// POST /api/admin/noteworthy — add a noteworthy item
router.post('/noteworthy', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { entity_type, entity_id, display_order } = req.body;

    if (!entity_type || !entity_id) {
      return res.status(400).json({ error: 'entity_type and entity_id are required' });
    }

    if (!['quote', 'article', 'topic'].includes(entity_type)) {
      return res.status(400).json({ error: 'entity_type must be quote, article, or topic' });
    }

    const result = db.prepare(`
      INSERT OR IGNORE INTO noteworthy_items (entity_type, entity_id, display_order)
      VALUES (?, ?, ?)
    `).run(entity_type, entity_id, display_order || 0);

    if (result.changes === 0) {
      return res.status(409).json({ error: 'Item already in noteworthy list' });
    }

    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add noteworthy item' });
  }
});

// PATCH /api/admin/noteworthy/:id — update display_order or active status
router.patch('/noteworthy/:id', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { display_order, active } = req.body;

    const existing = db.prepare('SELECT * FROM noteworthy_items WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Noteworthy item not found' });
    }

    if (display_order !== undefined) {
      db.prepare('UPDATE noteworthy_items SET display_order = ? WHERE id = ?').run(display_order, id);
    }
    if (active !== undefined) {
      db.prepare('UPDATE noteworthy_items SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update noteworthy item' });
  }
});

// DELETE /api/admin/noteworthy/:id — remove a noteworthy item
router.delete('/noteworthy/:id', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM noteworthy_items WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Noteworthy item not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete noteworthy item' });
  }
});

// --- Back-propagation routes ---

// POST /api/admin/backprop/trigger — trigger a back-propagation cycle
router.post('/backprop/trigger', requireAdmin, async (req, res) => {
  try {
    const { runBackPropCycle, runBackPropForDate } = await import('../services/backPropagation.js');
    const io = req.app.get('io');
    const { target_date } = req.body;

    let result;
    if (target_date) {
      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(target_date)) {
        return res.status(400).json({ error: 'target_date must be YYYY-MM-DD format' });
      }
      result = await runBackPropForDate(target_date, io);
    } else {
      result = await runBackPropCycle(io);
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Back-propagation failed: ' + err.message });
  }
});

// GET /api/admin/backprop/status — get back-propagation history
router.get('/backprop/status', requireAdmin, async (req, res) => {
  try {
    const { getBackPropStatus } = await import('../services/backPropagation.js');
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const entries = getBackPropStatus(limit);
    res.json({ entries });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get backprop status' });
  }
});

// --- Categories CRUD ---

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/admin/categories — list all categories with topic count
router.get('/categories', (req, res) => {
  try {
    const db = getDb();
    const categories = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM category_topics WHERE category_id = c.id) AS topic_count
      FROM categories c ORDER BY c.sort_order, c.name
    `).all();
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list categories: ' + err.message });
  }
});

// GET /api/admin/categories/:id — get single category with associated topics
router.get('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const category = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    const topics = db.prepare(`
      SELECT t.* FROM topics t
      JOIN category_topics ct ON ct.topic_id = t.id
      WHERE ct.category_id = ?
      ORDER BY t.name
    `).all(req.params.id);
    res.json({ category, topics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get category: ' + err.message });
  }
});

// POST /api/admin/categories — create category
router.post('/categories', (req, res) => {
  try {
    const db = getDb();
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const slug = generateSlug(name.trim());
    const maxOrder = db.prepare('SELECT MAX(sort_order) AS max_order FROM categories').get();
    const sortOrder = (maxOrder?.max_order ?? -1) + 1;
    const result = db.prepare(
      'INSERT INTO categories (name, slug, sort_order) VALUES (?, ?, ?)'
    ).run(name.trim(), slug, sortOrder);
    res.status(201).json({ id: Number(result.lastInsertRowid), name: name.trim(), slug, sort_order: sortOrder });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Category with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create category: ' + err.message });
  }
});

// PUT /api/admin/categories/:id — update category
router.put('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { name, sort_order } = req.body;

    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'Category not found' });
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: 'name cannot be empty' });
      }
      const slug = generateSlug(name.trim());
      db.prepare('UPDATE categories SET name = ?, slug = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(name.trim(), slug, id);
    }

    if (sort_order !== undefined) {
      db.prepare('UPDATE categories SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(sort_order, id);
    }

    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.json({ category: updated });
  } catch (err) {
    if (err.message?.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Category with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to update category: ' + err.message });
  }
});

// DELETE /api/admin/categories/:id — delete category
router.delete('/categories/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete category: ' + err.message });
  }
});

// POST /api/admin/categories/:id/topics — link topic to category
router.post('/categories/:id/topics', (req, res) => {
  try {
    const db = getDb();
    const { id } = req.params;
    const { topic_id } = req.body;

    if (!topic_id) {
      return res.status(400).json({ error: 'topic_id is required' });
    }

    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const topic = db.prepare('SELECT id FROM topics WHERE id = ?').get(topic_id);
    if (!topic) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    const result = db.prepare(
      'INSERT OR IGNORE INTO category_topics (category_id, topic_id) VALUES (?, ?)'
    ).run(id, topic_id);

    if (result.changes === 0) {
      return res.status(409).json({ error: 'Topic already linked to this category' });
    }

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to link topic: ' + err.message });
  }
});

// DELETE /api/admin/categories/:id/topics/:topicId — unlink topic from category
router.delete('/categories/:id/topics/:topicId', (req, res) => {
  try {
    const db = getDb();
    const { id, topicId } = req.params;
    const result = db.prepare(
      'DELETE FROM category_topics WHERE category_id = ? AND topic_id = ?'
    ).run(id, topicId);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Topic not linked to this category' });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlink topic: ' + err.message });
  }
});

export default router;
