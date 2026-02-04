import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const total = db.prepare('SELECT COUNT(*) as count FROM quotes').get().count;
  const quotes = db.prepare('SELECT * FROM quotes ORDER BY published_date DESC, created_at DESC LIMIT ? OFFSET ?').all(limit, offset);
  res.json({ quotes, total, page, totalPages: Math.ceil(total / limit) });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const quote = db.prepare('SELECT * FROM quotes WHERE id = ?').get(req.params.id);
  if (!quote) return res.json({ quote: null, sources: [], relatedQuotes: [] });
  const sources = db.prepare('SELECT * FROM quote_sources WHERE quote_id = ?').all(quote.id);
  const relatedQuotes = db.prepare('SELECT * FROM quotes WHERE author = ? AND id != ? ORDER BY created_at DESC LIMIT 10').all(quote.author, quote.id);
  res.json({ quote, sources, relatedQuotes });
});

export default router;
