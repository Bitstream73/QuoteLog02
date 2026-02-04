import { Router } from 'express';
import { getDb } from '../config/database.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const offset = (page - 1) * limit;
  let whereClause = '1=1';
  const params = [];
  if (req.query.level) { whereClause += ' AND level = ?'; params.push(req.query.level); }
  if (req.query.category) { whereClause += ' AND category = ?'; params.push(req.query.category); }
  if (req.query.action) { whereClause += ' AND action LIKE ?'; params.push(`%${req.query.action}%`); }
  if (req.query.startDate) { whereClause += ' AND timestamp >= ?'; params.push(req.query.startDate); }
  if (req.query.endDate) { whereClause += ' AND timestamp <= ?'; params.push(req.query.endDate); }
  if (req.query.search) { whereClause += ' AND (action LIKE ? OR details LIKE ?)'; params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  const countParams = [...params];
  const total = db.prepare(`SELECT COUNT(*) as count FROM application_logs WHERE ${whereClause}`).get(...countParams).count;
  const logs = db.prepare(`SELECT * FROM application_logs WHERE ${whereClause} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(...params, limit, offset);
  const maskedLogs = logs.map(log => ({ ...log, ip_address: log.ip_address ? log.ip_address.replace(/(\d+\.\d+)\.\d+\.\d+/, '$1.***.**') : null }));
  res.json({ logs: maskedLogs, total, page, totalPages: Math.ceil(total / limit) });
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const errorCount24h = db.prepare("SELECT COUNT(*) as count FROM application_logs WHERE level = 'error' AND timestamp >= ?").get(oneDayAgo).count;
  const warningCount24h = db.prepare("SELECT COUNT(*) as count FROM application_logs WHERE level = 'warn' AND timestamp >= ?").get(oneDayAgo).count;
  const requestsPerHour = db.prepare(`SELECT substr(timestamp, 1, 13) as hour, COUNT(*) as count FROM application_logs WHERE category = 'api' AND timestamp >= ? GROUP BY hour ORDER BY hour DESC LIMIT 24`).all(oneDayAgo);
  const topCategories = db.prepare(`SELECT category, COUNT(*) as count FROM application_logs WHERE timestamp >= ? GROUP BY category ORDER BY count DESC LIMIT 10`).all(oneDayAgo);
  res.json({ errorCount24h, warningCount24h, requestsPerHour, topCategories });
});

router.get('/export', (req, res) => {
  const db = getDb();
  let whereClause = '1=1';
  const params = [];
  if (req.query.startDate) { whereClause += ' AND timestamp >= ?'; params.push(req.query.startDate); }
  if (req.query.endDate) { whereClause += ' AND timestamp <= ?'; params.push(req.query.endDate); }
  if (req.query.level) { whereClause += ' AND level = ?'; params.push(req.query.level); }
  if (req.query.category) { whereClause += ' AND category = ?'; params.push(req.query.category); }
  const logs = db.prepare(`SELECT * FROM application_logs WHERE ${whereClause} ORDER BY timestamp DESC LIMIT 10000`).all(...params);
  const headers = ['timestamp', 'level', 'category', 'action', 'request_id', 'details', 'duration', 'error'];
  const csvRows = [headers.join(',')];
  for (const log of logs) {
    const row = headers.map(h => { const val = log[h] ?? ''; const str = String(val).replace(/"/g, '""'); return `"${str}"`; });
    csvRows.push(row.join(','));
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="logs-export.csv"');
  res.send(csvRows.join('\n'));
});

router.delete('/', (req, res) => {
  const db = getDb();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare('DELETE FROM application_logs WHERE timestamp < ?').run(sevenDaysAgo);
  res.json({ deleted: result.changes });
});

export default router;
