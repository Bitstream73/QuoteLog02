import { Router } from 'express';
import gemini from '../services/ai/gemini.js';
import { requireAdmin } from '../middleware/auth.js';
import { createBackup, listBackups, exportDatabaseJson, importDatabaseJson } from '../services/backup.js';
import { backfillHeadshots } from '../services/personPhoto.js';
import { storeTopicsAndKeywords } from '../services/quoteDeduplicator.js';
import vectorDb, { embedQuote } from '../services/vectorDb.js';
import { materializeSingleTopic } from '../services/topicMaterializer.js';
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

// Backfill topics and keywords for existing quotes that don't have them
router.post('/backfill-keywords', async (req, res) => {
  const batchSize = Math.min(parseInt(req.body?.batch_size) || 20, 50);

  try {
    const db = getDb();

    // Find quotes without topics/keywords
    const quotesWithout = db.prepare(`
      SELECT q.id, q.text, q.context, p.canonical_name
      FROM quotes q
      JOIN persons p ON p.id = q.person_id
      WHERE q.is_visible = 1
        AND q.canonical_quote_id IS NULL
        AND q.id NOT IN (SELECT DISTINCT quote_id FROM quote_topics)
        AND q.id NOT IN (SELECT DISTINCT quote_id FROM quote_keywords)
      ORDER BY q.created_at DESC
      LIMIT ?
    `).all(batchSize);

    if (quotesWithout.length === 0) {
      return res.json({ message: 'All quotes already have topics/keywords', processed: 0, remaining: 0 });
    }

    // Count remaining
    const remaining = db.prepare(`
      SELECT COUNT(*) AS count FROM quotes q
      WHERE q.is_visible = 1
        AND q.canonical_quote_id IS NULL
        AND q.id NOT IN (SELECT DISTINCT quote_id FROM quote_topics)
        AND q.id NOT IN (SELECT DISTINCT quote_id FROM quote_keywords)
    `).get().count;

    if (!config.geminiApiKey) {
      return res.status(400).json({ error: 'Gemini API key not configured' });
    }

    let processed = 0;
    let errors = 0;

    for (const quote of quotesWithout) {
      try {
        const prompt = `Analyze this news quote and extract topics and keywords.

Quote: "${quote.text}"
Speaker: ${quote.canonical_name}
${quote.context ? `Context: ${quote.context}` : ''}

Return a JSON object with:
- topics: Array of 1-3 SPECIFIC subject categories. Use the most specific applicable name from this taxonomy:

  Politics: "U.S. Presidential Politics", "U.S. Congressional Politics", "UK Politics", "EU Politics", "State/Local Politics", "Voting Rights"
  Government: "U.S. Foreign Policy", "Diplomacy", "Intelligence & Espionage", "Military & Defense", "Governance"
  Law: "Supreme Court", "Criminal Justice", "Constitutional Law", "Civil Rights & Liberties", "Law Enforcement"
  Economy: "U.S. Finance", "Global Economy", "Federal Reserve", "Trade & Tariffs", "Labor & Employment", "Cryptocurrency"
  Business: "Big Tech", "Startups", "Corporate Governance", "Energy Industry"
  Social: "Healthcare", "Education", "Immigration", "Housing", "Gun Control", "Reproductive Rights"
  Science: "Climate & Environment", "Space Exploration", "Artificial Intelligence", "Public Health"
  Culture: "Film & Television", "Music", "Olympic Sports", "NFL", "NBA", "MLB", "Soccer", "Social Media"
  World: "Middle East Conflict", "Ukraine War", "China-Taiwan Relations", "African Affairs", "Latin American Affairs"
  Media: "Journalism", "Misinformation", "Media Industry"
  Philosophy: "Philosophy", "Ethics", "Religion"

  IMPORTANT: Use specific names, NOT broad ones. "U.S. Finance" not "Business". "UK Politics" not "Politics".

- keywords: Array of 2-5 specific named entities. Follow these rules STRICTLY:
  1. ALWAYS use FULL proper names: "Donald Trump" not "Trump", "Federal Reserve" not "Fed"
  2. Multi-word entities are ONE keyword: "January 6th Committee" is one keyword
  3. Every keyword MUST be a proper noun, named event, specific organization, legislation, or geographic location
  4. NEVER include: verbs, adjectives, generic nouns, common words, the speaker's own name
  5. Single-word keywords are ONLY allowed for proper nouns (e.g., "NATO", "OPEC", "Brexit", "Hamas")
  6. If no specific named entities exist, return an EMPTY array

Return: { "topics": [...], "keywords": [...] }`;

        const parsed = await gemini.generateJSON(prompt);

        storeTopicsAndKeywords(quote.id, parsed.topics || [], parsed.keywords || [], db);
        processed++;
      } catch (err) {
        logger.error('admin', 'backfill_keyword_error', { quoteId: quote.id, error: err.message });
        errors++;
        // If rate limited, stop early
        if (err.message?.includes('429') || err.message?.includes('RESOURCE_EXHAUSTED')) {
          break;
        }
      }

      // Small delay between API calls to avoid rate limits
      await new Promise(r => setTimeout(r, 200));
    }

    res.json({
      message: 'Backfill complete',
      processed,
      errors,
      remaining: remaining - processed,
    });
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
      db.prepare(`DELETE FROM quote_topics WHERE quote_id IN (${placeholders})`).run(...chunk);
      db.prepare(`DELETE FROM quote_keywords WHERE quote_id IN (${placeholders})`).run(...chunk);
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

// --- Topic CRUD ---

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// GET /api/admin/topics — list all topics with keyword and quote counts
router.get('/topics', (req, res) => {
  try {
    const db = getDb();
    const topics = db.prepare(`
      SELECT t.*,
        (SELECT COUNT(*) FROM topic_keywords WHERE topic_id = t.id) as keyword_count,
        (SELECT COUNT(*) FROM quote_topics WHERE topic_id = t.id) as quote_count
      FROM topics t ORDER BY t.name
    `).all();

    res.json({ topics });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list topics: ' + err.message });
  }
});

// POST /api/admin/topics — create topic with keywords
router.post('/topics', (req, res) => {
  try {
    const db = getDb();
    const { name, description, keywords } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Topic name is required' });
    }

    const slug = generateSlug(name.trim());

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM topics WHERE slug = ?').get(slug);
    if (existing) {
      return res.status(409).json({ error: 'Topic with this name already exists' });
    }

    const result = db.prepare(
      'INSERT INTO topics (name, slug, description) VALUES (?, ?, ?)'
    ).run(name.trim(), slug, description || null);
    const topicId = Number(result.lastInsertRowid);

    // Add keywords
    let keywordsLinked = 0;
    if (keywords && Array.isArray(keywords)) {
      const upsertKeyword = db.prepare(
        `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')
         ON CONFLICT(name) DO NOTHING`
      );
      const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
      const linkKeyword = db.prepare(
        'INSERT OR IGNORE INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)'
      );

      for (const kw of keywords) {
        if (!kw || typeof kw !== 'string') continue;
        const trimmed = kw.trim();
        if (!trimmed) continue;
        upsertKeyword.run(trimmed, trimmed.toLowerCase());
        const keyword = getKeyword.get(trimmed);
        if (keyword) {
          linkKeyword.run(topicId, keyword.id);
          keywordsLinked++;
        }
      }
    }

    // Run materialization for this topic
    materializeSingleTopic(topicId, db);

    const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
    const linkedKeywords = db.prepare(`
      SELECT k.name FROM topic_keywords tk JOIN keywords k ON k.id = tk.keyword_id WHERE tk.topic_id = ?
    `).all(topicId).map(r => r.name);

    res.json({ topic, keywords: linkedKeywords });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create topic: ' + err.message });
  }
});

// PUT /api/admin/topics/:id — update topic
router.put('/topics/:id', (req, res) => {
  try {
    const db = getDb();
    const topicId = parseInt(req.params.id);
    const { name, description, context, keywords, enabled } = req.body;

    const existing = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
    if (!existing) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Update topic fields
    const newName = name ? name.trim() : existing.name;
    const newSlug = name ? generateSlug(name.trim()) : existing.slug;
    const newDesc = description !== undefined ? description : existing.description;
    const newCtx = context !== undefined ? context : existing.context;
    const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;

    db.prepare(
      'UPDATE topics SET name = ?, slug = ?, description = ?, context = ?, enabled = ? WHERE id = ?'
    ).run(newName, newSlug, newDesc, newCtx, newEnabled, topicId);

    // Update keywords if provided
    if (keywords && Array.isArray(keywords)) {
      db.prepare('DELETE FROM topic_keywords WHERE topic_id = ?').run(topicId);

      const upsertKeyword = db.prepare(
        `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, 'concept')
         ON CONFLICT(name) DO NOTHING`
      );
      const getKeyword = db.prepare('SELECT id FROM keywords WHERE name = ?');
      const linkKeyword = db.prepare(
        'INSERT OR IGNORE INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)'
      );

      for (const kw of keywords) {
        if (!kw || typeof kw !== 'string') continue;
        const trimmed = kw.trim();
        if (!trimmed) continue;
        upsertKeyword.run(trimmed, trimmed.toLowerCase());
        const keyword = getKeyword.get(trimmed);
        if (keyword) {
          linkKeyword.run(topicId, keyword.id);
        }
      }

      // Re-materialize after keyword update
      materializeSingleTopic(topicId, db);
    }

    const topic = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
    const linkedKeywords = db.prepare(`
      SELECT k.name FROM topic_keywords tk JOIN keywords k ON k.id = tk.keyword_id WHERE tk.topic_id = ?
    `).all(topicId).map(r => r.name);

    res.json({ topic, keywords: linkedKeywords });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update topic: ' + err.message });
  }
});

// DELETE /api/admin/topics/:id — delete topic (cascades to topic_keywords and quote_topics)
router.delete('/topics/:id', (req, res) => {
  try {
    const db = getDb();
    const topicId = parseInt(req.params.id);

    const existing = db.prepare('SELECT id, name FROM topics WHERE id = ?').get(topicId);
    if (!existing) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    db.prepare('DELETE FROM topics WHERE id = ?').run(topicId);

    res.json({ success: true, deleted: existing.name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete topic: ' + err.message });
  }
});

// --- Topic Keyword Link/Unlink ---

// GET /api/admin/topics/:id/keywords — list keywords for a topic
router.get('/topics/:id/keywords', (req, res) => {
  try {
    const db = getDb();
    const topicId = parseInt(req.params.id);

    const topic = db.prepare('SELECT id, name FROM topics WHERE id = ?').get(topicId);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const keywords = db.prepare(`
      SELECT k.id, k.name, k.keyword_type, k.enabled
      FROM topic_keywords tk
      JOIN keywords k ON k.id = tk.keyword_id
      WHERE tk.topic_id = ?
      ORDER BY k.name
    `).all(topicId);

    res.json({ keywords });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get topic keywords: ' + err.message });
  }
});

// POST /api/admin/topics/:id/keywords — link a keyword to a topic
router.post('/topics/:id/keywords', (req, res) => {
  try {
    const db = getDb();
    const topicId = parseInt(req.params.id);
    const { keyword_id } = req.body;

    const topic = db.prepare('SELECT id FROM topics WHERE id = ?').get(topicId);
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    if (!keyword_id) return res.status(400).json({ error: 'keyword_id required' });

    const keyword = db.prepare('SELECT id, name FROM keywords WHERE id = ?').get(keyword_id);
    if (!keyword) return res.status(404).json({ error: 'Keyword not found' });

    db.prepare('INSERT OR IGNORE INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(topicId, keyword_id);

    res.json({ success: true, keyword });
  } catch (err) {
    res.status(500).json({ error: 'Failed to link keyword: ' + err.message });
  }
});

// DELETE /api/admin/topics/:id/keywords/:keywordId — unlink a keyword from a topic
router.delete('/topics/:id/keywords/:keywordId', (req, res) => {
  try {
    const db = getDb();
    const topicId = parseInt(req.params.id);
    const keywordId = parseInt(req.params.keywordId);

    const result = db.prepare('DELETE FROM topic_keywords WHERE topic_id = ? AND keyword_id = ?').run(topicId, keywordId);

    res.json({ success: true, deleted: result.changes > 0 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unlink keyword: ' + err.message });
  }
});

// --- Standalone Keyword CRUD ---

const VALID_KEYWORD_TYPES = ['person', 'organization', 'event', 'legislation', 'location', 'concept'];

// GET /api/admin/keywords — list all keywords with quote counts
router.get('/keywords', (req, res) => {
  try {
    const db = getDb();
    const keywords = db.prepare(`
      SELECT k.id, k.name, k.name_normalized, k.keyword_type, k.created_at,
        COUNT(qk.quote_id) as quote_count
      FROM keywords k
      LEFT JOIN quote_keywords qk ON k.id = qk.keyword_id
      GROUP BY k.id
      ORDER BY quote_count DESC
    `).all();

    res.json({ keywords });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list keywords: ' + err.message });
  }
});

// POST /api/admin/keywords — create a standalone keyword
router.post('/keywords', (req, res) => {
  try {
    const db = getDb();
    const { name, keyword_type } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Keyword name is required' });
    }

    const trimmedName = name.trim();
    const normalizedName = trimmedName.toLowerCase();
    const type = keyword_type && VALID_KEYWORD_TYPES.includes(keyword_type) ? keyword_type : 'concept';

    // Check for duplicate
    const existing = db.prepare('SELECT id FROM keywords WHERE name = ?').get(trimmedName);
    if (existing) {
      return res.status(409).json({ error: 'Keyword with this name already exists' });
    }

    const result = db.prepare(
      'INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, ?)'
    ).run(trimmedName, normalizedName, type);

    const keyword = db.prepare('SELECT id, name, keyword_type FROM keywords WHERE id = ?').get(Number(result.lastInsertRowid));

    res.json({ success: true, keyword });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create keyword: ' + err.message });
  }
});

// PATCH /api/admin/keywords/:id — update keyword name/type/enabled
router.patch('/keywords/:id', (req, res) => {
  try {
    const db = getDb();
    const keywordId = parseInt(req.params.id);
    const { name, keyword_type, enabled } = req.body;

    const existing = db.prepare('SELECT * FROM keywords WHERE id = ?').get(keywordId);
    if (!existing) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    if (!name && !keyword_type && enabled === undefined) {
      return res.status(400).json({ error: 'At least one of name, keyword_type, or enabled is required' });
    }

    const newName = name ? name.trim() : existing.name;
    const newNormalized = name ? name.trim().toLowerCase() : existing.name_normalized;
    const newType = keyword_type && VALID_KEYWORD_TYPES.includes(keyword_type) ? keyword_type : existing.keyword_type;
    const newEnabled = enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled;

    db.prepare('UPDATE keywords SET name = ?, name_normalized = ?, keyword_type = ?, enabled = ? WHERE id = ?')
      .run(newName, newNormalized, newType, newEnabled, keywordId);

    const keyword = db.prepare('SELECT id, name, keyword_type, enabled FROM keywords WHERE id = ?').get(keywordId);

    res.json({ success: true, keyword });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update keyword: ' + err.message });
  }
});

// DELETE /api/admin/keywords/:id — cascade delete keyword
router.delete('/keywords/:id', (req, res) => {
  try {
    const db = getDb();
    const keywordId = parseInt(req.params.id);

    const existing = db.prepare('SELECT id, name FROM keywords WHERE id = ?').get(keywordId);
    if (!existing) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    // Cascade delete from join tables
    db.prepare('DELETE FROM quote_keywords WHERE keyword_id = ?').run(keywordId);
    db.prepare('DELETE FROM topic_keywords WHERE keyword_id = ?').run(keywordId);
    db.prepare('DELETE FROM keywords WHERE id = ?').run(keywordId);

    res.json({ success: true, deleted: existing.name });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete keyword: ' + err.message });
  }
});

// --- Quote-level Keyword CRUD ---

// POST /api/admin/quotes/:id/keywords — link (or create-and-link) a keyword to a quote
router.post('/quotes/:id/keywords', (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);
    const { name, keyword_type } = req.body;

    // Validate quote exists
    const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Keyword name is required' });
    }

    const trimmedName = name.trim();
    const normalizedName = trimmedName.toLowerCase();
    const type = keyword_type && VALID_KEYWORD_TYPES.includes(keyword_type) ? keyword_type : 'concept';

    // Upsert keyword
    db.prepare(
      `INSERT INTO keywords (name, name_normalized, keyword_type) VALUES (?, ?, ?)
       ON CONFLICT(name) DO NOTHING`
    ).run(trimmedName, normalizedName, type);

    // Get keyword ID
    const keyword = db.prepare('SELECT id, name, keyword_type FROM keywords WHERE name = ?').get(trimmedName);

    // Link to quote
    db.prepare('INSERT OR IGNORE INTO quote_keywords (quote_id, keyword_id) VALUES (?, ?)').run(quoteId, keyword.id);

    res.json({ success: true, keyword });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add keyword: ' + err.message });
  }
});

// DELETE /api/admin/quotes/:id/keywords/:keywordId — unlink keyword from quote
router.delete('/quotes/:id/keywords/:keywordId', (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);
    const keywordId = parseInt(req.params.keywordId);

    db.prepare('DELETE FROM quote_keywords WHERE quote_id = ? AND keyword_id = ?').run(quoteId, keywordId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove keyword: ' + err.message });
  }
});

// --- Quote-level Topic CRUD ---

// POST /api/admin/quotes/:id/topics — link (or create-and-link) a topic to a quote
router.post('/quotes/:id/topics', (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);
    const { topic_id, name } = req.body;

    // Validate quote exists
    const quote = db.prepare('SELECT id FROM quotes WHERE id = ?').get(quoteId);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    let topic;

    if (topic_id) {
      // Link existing topic
      topic = db.prepare('SELECT id, name, slug FROM topics WHERE id = ?').get(topic_id);
      if (!topic) {
        return res.status(404).json({ error: 'Topic not found' });
      }
    } else if (name && name.trim()) {
      // Create-and-link
      const trimmedName = name.trim();
      const slug = generateSlug(trimmedName);

      // Insert or find existing by slug
      db.prepare(
        'INSERT OR IGNORE INTO topics (name, slug) VALUES (?, ?)'
      ).run(trimmedName, slug);

      topic = db.prepare('SELECT id, name, slug FROM topics WHERE slug = ?').get(slug);
    } else {
      return res.status(400).json({ error: 'Either topic_id or name is required' });
    }

    // Link to quote
    db.prepare('INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (?, ?)').run(quoteId, topic.id);

    res.json({ success: true, topic });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add topic: ' + err.message });
  }
});

// DELETE /api/admin/quotes/:id/topics/:topicId — unlink topic from quote
router.delete('/quotes/:id/topics/:topicId', (req, res) => {
  try {
    const db = getDb();
    const quoteId = parseInt(req.params.id);
    const topicId = parseInt(req.params.topicId);

    db.prepare('DELETE FROM quote_topics WHERE quote_id = ? AND topic_id = ?').run(quoteId, topicId);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove topic: ' + err.message });
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

export default router;
