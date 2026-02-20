import { Router } from 'express';
import { getDb, getSettingValue, setSettingValue, exportSettingsSeed } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { listPrompts, getPromptFull, updatePrompt, resetPrompt } from '../services/promptManager.js';

const router = Router();

// Get all settings
router.get('/', requireAdmin, (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

// Update settings (PUT - replace all)
router.put('/', requireAdmin, (req, res) => {
  const db = getDb();
  const update = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  for (const [key, value] of Object.entries(req.body)) {
    update.run(key, String(value));
  }

  // Return current settings
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

// Update settings (PATCH - partial update)
router.patch('/', requireAdmin, (req, res) => {
  const db = getDb();
  const update = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  // Validate numeric settings
  const numericSettings = {
    fetch_interval_minutes: { min: 5, max: 1440 },
    article_lookback_hours: { min: 1, max: 168 },
    max_articles_per_source_per_cycle: { min: 1, max: 1000 },
    min_quote_words: { min: 1, max: 50 },
    historical_articles_per_source_per_cycle: { min: 1, max: 100 },
  };

  const floatSettings = {
    auto_merge_confidence_threshold: { min: 0, max: 1 },
    review_confidence_threshold: { min: 0, max: 1 },
  };

  for (const [key, value] of Object.entries(req.body)) {
    let validatedValue = value;

    // Validate ingest filter excluded categories
    if (key === 'ingest_filter_excluded_categories') {
      try {
        const arr = JSON.parse(value);
        if (!Array.isArray(arr) || !arr.every(v => typeof v === 'string')) {
          return res.status(400).json({ error: 'ingest_filter_excluded_categories must be a JSON array of strings' });
        }
      } catch {
        return res.status(400).json({ error: 'ingest_filter_excluded_categories must be valid JSON' });
      }
    }

    if (key in numericSettings) {
      const num = parseInt(value, 10);
      const constraints = numericSettings[key];
      if (isNaN(num) || num < constraints.min || num > constraints.max) {
        return res.status(400).json({
          error: `${key} must be between ${constraints.min} and ${constraints.max}`,
        });
      }
      validatedValue = String(num);
    }

    if (key in floatSettings) {
      const num = parseFloat(value);
      const constraints = floatSettings[key];
      if (isNaN(num) || num < constraints.min || num > constraints.max) {
        return res.status(400).json({
          error: `${key} must be between ${constraints.min} and ${constraints.max}`,
        });
      }
      validatedValue = String(num);
    }

    update.run(key, String(validatedValue));
  }

  // Persist settings to seed file for deploy resilience
  try { exportSettingsSeed(); } catch (e) { /* non-critical */ }

  // Restart scheduler if fetch_interval_minutes changed
  if (req.body.fetch_interval_minutes !== undefined) {
    // Lazy import to avoid loading the entire pipeline at startup
    import('../services/scheduler.js').then(({ restartFetchScheduler }) => {
      restartFetchScheduler(req.app);
    }).catch(() => {});
    const io = req.app.get('io');
    if (io) {
      io.emit('settings_changed', { fetch_interval_minutes: req.body.fetch_interval_minutes });
    }
  }

  // Return current settings
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

// Get scheduler status (for countdown timer)
router.get('/scheduler', requireAdmin, async (req, res) => {
  const { getSchedulerStatus } = await import('../services/scheduler.js');
  res.json(getSchedulerStatus());
});

// Trigger immediate fetch
router.post('/fetch-now', requireAdmin, async (req, res) => {
  const { triggerFetchNow } = await import('../services/scheduler.js');
  const result = triggerFetchNow();
  if (result.started) {
    res.json({ message: 'Fetch cycle started' });
  } else {
    res.status(409).json({ error: 'A fetch cycle is already running' });
  }
});

// --- Prompt management routes ---

// GET /api/settings/prompts — list all prompt templates
router.get('/prompts', requireAdmin, (req, res) => {
  try {
    const prompts = listPrompts();
    res.json({ prompts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list prompts' });
  }
});

// GET /api/settings/prompts/:key — get a single prompt (includes template text)
router.get('/prompts/:key', requireAdmin, (req, res) => {
  try {
    const prompt = getPromptFull(req.params.key);
    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
    res.json({ prompt });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get prompt' });
  }
});

// PUT /api/settings/prompts/:key — update a prompt template
router.put('/prompts/:key', requireAdmin, (req, res) => {
  try {
    const { template } = req.body;
    if (!template || typeof template !== 'string') {
      return res.status(400).json({ error: 'template (string) is required' });
    }
    const result = updatePrompt(req.params.key, template);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update prompt' });
  }
});

// POST /api/settings/prompts/:key/reset — reset a prompt to hardcoded default
router.post('/prompts/:key/reset', requireAdmin, (req, res) => {
  try {
    const result = resetPrompt(req.params.key);
    if (!result.success) {
      return res.status(404).json({ error: result.error });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reset prompt' });
  }
});

export default router;
