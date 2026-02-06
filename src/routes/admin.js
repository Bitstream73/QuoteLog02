import { Router } from 'express';
import { requireAdmin } from '../middleware/auth.js';
import { createBackup, listBackups, exportDatabaseJson, importDatabaseJson } from '../services/backup.js';
import { backfillHeadshots } from '../services/personPhoto.js';

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

export default router;
