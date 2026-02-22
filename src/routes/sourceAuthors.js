import { Router } from 'express';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import gemini from '../services/ai/gemini.js';
import { fetchOrganizationImageUrl } from '../services/sourceAuthorPhoto.js';
import logger from '../services/logger.js';

const router = Router();

// List all source authors
router.get('/', (req, res) => {
  const db = getDb();
  const sourceAuthors = db.prepare(`
    SELECT sa.*, COUNT(s.id) as source_count
    FROM source_authors sa
    LEFT JOIN sources s ON s.source_author_id = sa.id
    GROUP BY sa.id
    ORDER BY sa.name ASC
  `).all();
  res.json({ sourceAuthors });
});

// Get single source author with linked sources
router.get('/:id', (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const sourceAuthor = db.prepare('SELECT * FROM source_authors WHERE id = ?').get(id);
  if (!sourceAuthor) {
    return res.status(404).json({ error: 'Source author not found' });
  }

  const sources = db.prepare('SELECT id, domain, name, rss_url, enabled FROM sources WHERE source_author_id = ?').all(id);

  res.json({ sourceAuthor, sources });
});

// Update source author (admin only)
router.patch('/:id', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;
  const { name, imageUrl, description } = req.body;

  const sourceAuthor = db.prepare('SELECT id FROM source_authors WHERE id = ?').get(id);
  if (!sourceAuthor) {
    return res.status(404).json({ error: 'Source author not found' });
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Name cannot be empty' });
    }
    db.prepare("UPDATE source_authors SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), id);
  }
  if (imageUrl !== undefined) {
    db.prepare("UPDATE source_authors SET image_url = ?, updated_at = datetime('now') WHERE id = ?").run(imageUrl || null, id);
  }
  if (description !== undefined) {
    db.prepare("UPDATE source_authors SET description = ?, updated_at = datetime('now') WHERE id = ?").run(description || null, id);
  }

  const updated = db.prepare('SELECT * FROM source_authors WHERE id = ?').get(id);
  res.json({ success: true, sourceAuthor: updated });
});

// Get cached image suggestions (admin only)
router.get('/:id/image-suggestions', requireAdmin, (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const sa = db.prepare('SELECT image_suggestions FROM source_authors WHERE id = ?').get(id);
  if (!sa) {
    return res.status(404).json({ error: 'Source author not found' });
  }

  let suggestions = [];
  if (sa.image_suggestions) {
    try {
      suggestions = JSON.parse(sa.image_suggestions);
    } catch { /* invalid JSON, return empty */ }
  }

  res.json({ suggestions });
});

// AI-powered image search (admin only)
router.post('/:id/image-search', requireAdmin, async (req, res) => {
  const db = getDb();
  const { id } = req.params;

  const sa = db.prepare('SELECT name, domain, description FROM source_authors WHERE id = ?').get(id);
  if (!sa) {
    return res.status(404).json({ error: 'Source author not found' });
  }

  const name = sa.name;
  const desc = sa.description || '';

  try {
    // Try Wikipedia first
    const wikiUrl = await fetchOrganizationImageUrl(name);

    // Call Gemini with grounded search
    const prompt = `Find 3 high-quality logo or brand image URLs of the news organization "${name}" (${sa.domain})${desc ? ` — ${desc}` : ''}.
Return direct image file URLs (jpg, png, webp) from reliable sources like Wikipedia, official websites, or news industry sites.
Return a JSON array of objects: [{ "url": "direct image URL", "description": "brief description", "source": "website name" }]
Only return URLs that point directly to image files. Prefer official logos and recognizable brand images.`;

    let aiResults = [];
    try {
      const raw = await gemini.generateGroundedJSON(prompt, { temperature: 0.2 });
      aiResults = Array.isArray(raw) ? raw : (raw._groundingMetadata ? [] : [raw]);
      aiResults = aiResults.filter(r => r && r.url);
    } catch (aiErr) {
      logger.warn('sourceAuthors', 'image_search_ai_failed', { sourceAuthorId: id, error: aiErr.message });
    }

    // Validate each URL with HEAD request
    const validated = [];
    for (const item of aiResults) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const headRes = await fetch(item.url, {
          method: 'HEAD',
          signal: controller.signal,
          redirect: 'follow',
        });
        clearTimeout(timeout);
        if (headRes.ok && (headRes.headers.get('content-type') || '').startsWith('image/')) {
          validated.push({
            url: item.url,
            description: item.description || '',
            source: item.source || '',
          });
        }
      } catch { /* skip invalid URLs */ }
    }

    // Add Wikipedia result as first suggestion if valid and not already present
    if (wikiUrl && !validated.some(v => v.url === wikiUrl)) {
      validated.unshift({
        url: wikiUrl,
        description: 'Wikipedia image',
        source: 'Wikipedia',
      });
    }

    const suggestions = validated.slice(0, 3);

    // Cache in database
    db.prepare("UPDATE source_authors SET image_suggestions = ?, updated_at = datetime('now') WHERE id = ?")
      .run(JSON.stringify(suggestions), id);

    res.json({ suggestions });
  } catch (err) {
    logger.error('sourceAuthors', 'image_search_failed', { sourceAuthorId: id }, err);
    res.status(500).json({ error: 'Image search failed' });
  }
});

export default router;
