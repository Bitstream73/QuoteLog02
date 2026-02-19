import { Router } from 'express';
import { getDb } from '../config/database.js';
import { requireAdmin } from '../middleware/auth.js';
import { createHash } from 'crypto';
import { createRateLimiter } from '../middleware/rateLimiter.js';

const router = Router();

function getIpHash(req) {
  const ip = req.ip || req.connection.remoteAddress;
  return createHash('sha256').update(ip).digest('hex');
}

const bugReportRateLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5,
});

// POST /api/bug-reports — submit a bug report (public, rate-limited)
router.post('/', bugReportRateLimiter, (req, res) => {
  try {
    const db = getDb();
    const { message, page_url, quote_id } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }
    if (message.length > 280) {
      return res.status(400).json({ error: 'Message must be 280 characters or less' });
    }
    if (!page_url || typeof page_url !== 'string') {
      return res.status(400).json({ error: 'Page URL is required' });
    }

    const ipHash = getIpHash(req);
    const userAgent = req.get('User-Agent') || null;
    const quoteId = quote_id ? parseInt(quote_id) : null;

    const result = db.prepare(`
      INSERT INTO bug_reports (message, page_url, quote_id, user_agent, ip_hash)
      VALUES (?, ?, ?, ?, ?)
    `).run(message.trim(), page_url, quoteId, userAgent, ipHash);

    res.json({ success: true, id: Number(result.lastInsertRowid) });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/bug-reports — list reports (admin, paginated, starred first)
router.get('/', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    const total = db.prepare('SELECT COUNT(*) as count FROM bug_reports').get().count;
    const reports = db.prepare(`
      SELECT * FROM bug_reports
      ORDER BY starred DESC, created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    res.json({
      reports,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/bug-reports/:id/star — toggle star
router.patch('/:id/star', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const report = db.prepare('SELECT id, starred FROM bug_reports WHERE id = ?').get(id);
    if (!report) {
      return res.status(404).json({ error: 'Bug report not found' });
    }
    const newStarred = report.starred ? 0 : 1;
    db.prepare('UPDATE bug_reports SET starred = ? WHERE id = ?').run(newStarred, id);
    res.json({ success: true, starred: newStarred });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/bug-reports/:id — delete single report
router.delete('/:id', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id);
    const result = db.prepare('DELETE FROM bug_reports WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Bug report not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/bug-reports/batch-delete — mass delete by IDs
router.post('/batch-delete', requireAdmin, (req, res) => {
  try {
    const db = getDb();
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'ids array is required' });
    }
    const placeholders = ids.map(() => '?').join(',');
    const result = db.prepare(`DELETE FROM bug_reports WHERE id IN (${placeholders})`).run(...ids);
    res.json({ success: true, deleted: result.changes });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
