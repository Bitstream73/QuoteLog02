import { Router } from 'express';
import { getDb } from '../config/database.js';
import { discoverRssFeed } from '../services/rssFeedDiscovery.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

// List all sources
router.get('/', (req, res) => {
  const db = getDb();
  const sources = db.prepare('SELECT * FROM sources ORDER BY name ASC, domain ASC').all();
  res.json({ sources });
});

// Add a new source
router.post('/', requireAdmin, async (req, res) => {
  const db = getDb();
  let { domain, name, rss_url } = req.body;

  if (!domain) {
    return res.status(400).json({ error: 'Domain is required' });
  }

  // Validate and normalize domain
  domain = domain.trim().toLowerCase();

  // Remove protocol if present
  domain = domain.replace(/^https?:\/\//, '');

  // Remove www. prefix
  domain = domain.replace(/^www\./, '');

  // Remove trailing slash and path
  domain = domain.split('/')[0];

  // Basic domain validation
  if (!/^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}$/.test(domain)) {
    return res.status(400).json({ error: 'Invalid domain format' });
  }

  // Auto-generate name if not provided
  if (!name) {
    // Capitalize first letter, remove TLD
    const parts = domain.split('.');
    name = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
  }

  // Check if domain already exists
  const existing = db.prepare('SELECT id FROM sources WHERE domain = ?').get(domain);
  if (existing) {
    return res.status(409).json({ error: 'Source with this domain already exists' });
  }

  try {
    // Try to auto-discover RSS feed if not provided
    if (!rss_url) {
      rss_url = await discoverRssFeed(domain);
    }

    const result = db.prepare(
      'INSERT INTO sources (domain, name, rss_url, enabled) VALUES (?, ?, ?, 1)'
    ).run(domain, name, rss_url);

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ source });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add source: ' + err.message });
  }
});

// Update a source
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { name, rss_url, enabled } = req.body;

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) {
    return res.status(404).json({ error: 'Source not found' });
  }

  const updates = [];
  const values = [];

  if (name !== undefined) {
    updates.push('name = ?');
    values.push(name);
  }
  if (rss_url !== undefined) {
    updates.push('rss_url = ?');
    values.push(rss_url);
  }
  if (enabled !== undefined) {
    updates.push('enabled = ?');
    values.push(enabled ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.json({ source });
  }

  updates.push("updated_at = datetime('now')");
  values.push(id);

  db.prepare(`UPDATE sources SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const updated = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  res.json({ source: updated });
});

// Delete a source
router.delete('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) {
    return res.status(404).json({ error: 'Source not found' });
  }

  db.prepare('DELETE FROM sources WHERE id = ?').run(id);
  res.json({ success: true });
});

export default router;
