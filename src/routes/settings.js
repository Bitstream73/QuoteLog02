import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) { settings[row.key] = row.value; }
  res.json(settings);
});

router.put('/', (req, res) => {
  const db = getDb();
  const update = db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, unixepoch()) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at');
  for (const [key, value] of Object.entries(req.body)) { update.run(key, String(value)); }
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) { settings[row.key] = row.value; }
  res.json(settings);
});

export default router;
