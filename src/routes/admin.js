import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAdmin } from '../middleware/auth.js';
import { createBackup, listBackups, exportDatabaseJson, importDatabaseJson } from '../services/backup.js';
import { backfillHeadshots } from '../services/personPhoto.js';
import { storeTopicsAndKeywords } from '../services/quoteDeduplicator.js';
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

export default router;
