import { Router } from 'express';
import { getDb } from '../config/database.js';
import { discoverRssFeed } from '../services/rssFeedDiscovery.js';
import { requireAdmin } from '../middleware/auth.js';
import { fetchArticlesFromSource } from '../services/articleFetcher.js';
import logger from '../services/logger.js';

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

  // Extract root domain (e.g., "rss.cnn.com" -> "cnn.com", "feeds.bbci.co.uk" -> "bbci.co.uk")
  // Keep last 2 parts, or last 3 if second-to-last is short (co, com, org, etc. for ccTLDs)
  const domainParts = domain.split('.');
  if (domainParts.length > 2) {
    const sld = domainParts[domainParts.length - 2];
    if (['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(sld)) {
      // ccTLD like .co.uk, .com.au — keep last 3 parts
      domain = domainParts.slice(-3).join('.');
    } else {
      // Regular subdomain — keep last 2 parts
      domain = domainParts.slice(-2).join('.');
    }
  }

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

  try {
    // Try to auto-discover RSS feed if not provided
    if (!rss_url) {
      rss_url = await discoverRssFeed(domain);
    }

    // Check for duplicate by rss_url (same feed URL = true duplicate)
    if (rss_url) {
      const existing = db.prepare('SELECT id FROM sources WHERE rss_url = ?').get(rss_url);
      if (existing) {
        return res.status(409).json({ error: 'A source with this RSS feed URL already exists' });
      }
    }

    const result = db.prepare(
      'INSERT INTO sources (domain, name, rss_url, enabled) VALUES (?, ?, ?, 1)'
    ).run(domain, name, rss_url);

    // Find or create source_author for this domain and link
    let sa = db.prepare('SELECT id FROM source_authors WHERE domain = ?').get(domain);
    if (!sa) {
      const derivedName = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
      db.prepare('INSERT INTO source_authors (name, domain) VALUES (?, ?)').run(derivedName, domain);
      sa = db.prepare('SELECT id FROM source_authors WHERE domain = ?').get(domain);
    }
    if (sa) {
      db.prepare('UPDATE sources SET source_author_id = ? WHERE id = ?').run(sa.id, result.lastInsertRowid);
    }

    const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(result.lastInsertRowid);

    // Verify RSS feed works by doing a test fetch (non-blocking)
    if (source.rss_url) {
      fetchArticlesFromSource(source, 24).then(articles => {
        logger.info('sources', 'source_verified', {
          domain: source.domain,
          name: source.name,
          articleCount: articles.length,
        });
      }).catch(err => {
        logger.warn('sources', 'source_verify_failed', {
          domain: source.domain,
          name: source.name,
          error: err.message,
        });
        db.prepare('UPDATE sources SET consecutive_failures = consecutive_failures + 1 WHERE id = ?')
          .run(source.id);
      });
    }

    res.status(201).json({ source });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add source: ' + err.message });
  }
});

// Update a source
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { domain, name, rss_url, enabled, is_top_story } = req.body;

  const source = db.prepare('SELECT * FROM sources WHERE id = ?').get(id);
  if (!source) {
    return res.status(404).json({ error: 'Source not found' });
  }

  const updates = [];
  const values = [];

  if (domain !== undefined) {
    updates.push('domain = ?');
    values.push(domain.trim().toLowerCase());
  }
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
  if (is_top_story !== undefined) {
    updates.push('is_top_story = ?');
    values.push(is_top_story ? 1 : 0);
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
