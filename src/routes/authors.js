import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const authors = db.prepare('SELECT * FROM authors ORDER BY name').all();
  res.json({ authors });
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const author = db.prepare('SELECT * FROM authors WHERE id = ?').get(req.params.id);
  if (!author) return res.json({ author: null, quotes: [] });
  const quotes = db.prepare('SELECT * FROM quotes WHERE author = ? ORDER BY published_date DESC, created_at DESC').all(author.name);
  res.json({ author, quotes });
});

export default router;
