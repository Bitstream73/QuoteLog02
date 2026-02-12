import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAdmin } from '../middleware/auth.js';
import { createBackup, listBackups, exportDatabaseJson, importDatabaseJson } from '../services/backup.js';
import { backfillHeadshots } from '../services/personPhoto.js';
import { storeTopicsAndKeywords } from '../services/quoteDeduplicator.js';
import { embedQuote } from '../services/vectorDb.js';
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

    const genAI = new GoogleGenerativeAI(config.geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    let processed = 0;
    let errors = 0;

    for (const quote of quotesWithout) {
      try {
        const prompt = `Analyze this news quote and extract topics and keywords.

Quote: "${quote.text}"
Speaker: ${quote.canonical_name}
${quote.context ? `Context: ${quote.context}` : ''}

Return a JSON object with:
- topics: Array of 1-3 broad subject categories. Use consistent names like "U.S. Politics", "Foreign Policy", "Criminal Justice", "Healthcare", "Economy", "Technology", "Entertainment", "Sports", "Climate & Environment", "Education", "Immigration", "Civil Rights", "National Security", "Business", "Science", "Media", "Religion", "Housing", "Labor", "Trade".
- keywords: Array of 2-5 specific named entities, events, or concepts. Use full proper names ("Donald Trump" not "Trump"). Do NOT include generic verbs, adjectives, or the speaker's own name. Each keyword should be a proper noun or recognized named concept.

Return: { "topics": [...], "keywords": [...] }`;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const parsed = JSON.parse(response.text());

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
    const { name, description, context, keywords } = req.body;

    const existing = db.prepare('SELECT * FROM topics WHERE id = ?').get(topicId);
    if (!existing) {
      return res.status(404).json({ error: 'Topic not found' });
    }

    // Update topic fields
    const newName = name ? name.trim() : existing.name;
    const newSlug = name ? generateSlug(name.trim()) : existing.slug;
    const newDesc = description !== undefined ? description : existing.description;
    const newCtx = context !== undefined ? context : existing.context;

    db.prepare(
      'UPDATE topics SET name = ?, slug = ?, description = ?, context = ? WHERE id = ?'
    ).run(newName, newSlug, newDesc, newCtx, topicId);

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

// PATCH /api/admin/keywords/:id — update keyword name/type
router.patch('/keywords/:id', (req, res) => {
  try {
    const db = getDb();
    const keywordId = parseInt(req.params.id);
    const { name, keyword_type } = req.body;

    const existing = db.prepare('SELECT * FROM keywords WHERE id = ?').get(keywordId);
    if (!existing) {
      return res.status(404).json({ error: 'Keyword not found' });
    }

    if (!name && !keyword_type) {
      return res.status(400).json({ error: 'At least one of name or keyword_type is required' });
    }

    const newName = name ? name.trim() : existing.name;
    const newNormalized = name ? name.trim().toLowerCase() : existing.name_normalized;
    const newType = keyword_type && VALID_KEYWORD_TYPES.includes(keyword_type) ? keyword_type : existing.keyword_type;

    db.prepare('UPDATE keywords SET name = ?, name_normalized = ?, keyword_type = ? WHERE id = ?')
      .run(newName, newNormalized, newType, keywordId);

    const keyword = db.prepare('SELECT id, name, keyword_type FROM keywords WHERE id = ?').get(keywordId);

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

export default router;
