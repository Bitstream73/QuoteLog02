import { Router } from 'express';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { getProviderByKey } from '../services/historical/index.js';
import logger from '../services/logger.js';

const router = Router();

// List all historical source providers
router.get('/', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const sources = db.prepare('SELECT * FROM historical_sources ORDER BY name').all();
    res.json({
      sources: sources.map(s => ({
        ...s,
        enabled: !!s.enabled,
      })),
    });
  } catch (err) {
    logger.error('api', 'historical_sources_list_error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch historical sources' });
  }
});

// Toggle a provider on/off
router.patch('/:key', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { key } = req.params;
    const { enabled } = req.body;

    const existing = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get(key);
    if (!existing) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    if (enabled) {
      db.prepare(
        "UPDATE historical_sources SET enabled = 1, status = 'unknown', updated_at = datetime('now') WHERE provider_key = ?"
      ).run(key);
    } else {
      db.prepare(
        "UPDATE historical_sources SET enabled = 0, status = 'disabled', updated_at = datetime('now') WHERE provider_key = ?"
      ).run(key);
    }

    const updated = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get(key);
    res.json({ ...updated, enabled: !!updated.enabled });
  } catch (err) {
    logger.error('api', 'historical_sources_toggle_error', { error: err.message });
    res.status(500).json({ error: 'Failed to update historical source' });
  }
});

// Test a provider's connection
router.post('/:key/test', requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    const { key } = req.params;

    const existing = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get(key);
    if (!existing) {
      return res.status(404).json({ error: 'Provider not found' });
    }

    const provider = getProviderByKey(key);
    if (!provider) {
      return res.status(404).json({ error: 'Provider implementation not found' });
    }

    const result = await provider.testConnection();

    if (result.success) {
      db.prepare(
        "UPDATE historical_sources SET status = 'working', last_success_at = datetime('now'), last_error = NULL, updated_at = datetime('now') WHERE provider_key = ?"
      ).run(key);
    } else {
      db.prepare(
        "UPDATE historical_sources SET status = 'failed', last_error = ?, updated_at = datetime('now') WHERE provider_key = ?"
      ).run(result.message, key);
    }

    res.json(result);
  } catch (err) {
    logger.error('api', 'historical_sources_test_error', { error: err.message });
    res.status(500).json({ error: 'Failed to test historical source' });
  }
});

// Aggregate statistics
router.get('/stats', requireAdmin, (req, res) => {
  try {
    const db = getDb();

    const totalArticles = db.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE historical_source_id IS NOT NULL'
    ).get().count;

    const totalQuotes = db.prepare(`
      SELECT COUNT(*) as count FROM quotes q
      JOIN quote_articles qa ON q.id = qa.quote_id
      JOIN articles a ON qa.article_id = a.id
      WHERE a.historical_source_id IS NOT NULL
    `).get().count;

    const providers = db.prepare(
      'SELECT provider_key, total_articles_fetched, last_fetch_at, status FROM historical_sources ORDER BY name'
    ).all();

    res.json({
      total_historical_articles: totalArticles,
      total_historical_quotes: totalQuotes,
      providers,
    });
  } catch (err) {
    logger.error('api', 'historical_sources_stats_error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

export default router;
