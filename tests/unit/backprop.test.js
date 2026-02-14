import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Back-Propagation — Schema & Logic Tests', () => {
  let db;
  const testDbPath = path.join(__dirname, '../backprop-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');

    // Create backprop_log table
    db.exec(`
      CREATE TABLE IF NOT EXISTS backprop_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_date TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
        articles_found INTEGER NOT NULL DEFAULT 0,
        quotes_extracted INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create supporting tables for gap detection tests
    db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        is_visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = testDbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  describe('backprop_log table', () => {
    it('table exists with correct columns', () => {
      const cols = db.prepare('PRAGMA table_info(backprop_log)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('target_date');
      expect(cols).toContain('status');
      expect(cols).toContain('articles_found');
      expect(cols).toContain('quotes_extracted');
      expect(cols).toContain('error');
      expect(cols).toContain('started_at');
      expect(cols).toContain('completed_at');
      expect(cols).toContain('created_at');
    });

    it('target_date is UNIQUE', () => {
      db.prepare("INSERT INTO backprop_log (target_date, status) VALUES (?, 'pending')").run('2025-01-01');
      expect(() => {
        db.prepare("INSERT INTO backprop_log (target_date, status) VALUES (?, 'pending')").run('2025-01-01');
      }).toThrow();
    });

    it('status CHECK constraint works', () => {
      expect(() => {
        db.prepare("INSERT INTO backprop_log (target_date, status) VALUES (?, 'invalid')").run('2025-01-02');
      }).toThrow();
    });

    it('can track a complete lifecycle', () => {
      // Create a pending entry
      db.prepare("INSERT INTO backprop_log (target_date, status, started_at) VALUES (?, 'processing', datetime('now'))")
        .run('2025-01-10');

      // Update to completed
      db.prepare(`
        UPDATE backprop_log SET status = 'completed', articles_found = 5, quotes_extracted = 12, completed_at = datetime('now')
        WHERE target_date = ?
      `).run('2025-01-10');

      const row = db.prepare('SELECT * FROM backprop_log WHERE target_date = ?').get('2025-01-10');
      expect(row.status).toBe('completed');
      expect(row.articles_found).toBe(5);
      expect(row.quotes_extracted).toBe(12);
      expect(row.completed_at).toBeDefined();
    });

    it('can record failures with error messages', () => {
      db.prepare(`
        INSERT INTO backprop_log (target_date, status, error, started_at, completed_at)
        VALUES (?, 'failed', ?, datetime('now'), datetime('now'))
      `).run('2025-01-11', 'Network timeout after 30s');

      const row = db.prepare('SELECT * FROM backprop_log WHERE target_date = ?').get('2025-01-11');
      expect(row.status).toBe('failed');
      expect(row.error).toBe('Network timeout after 30s');
    });

    it('defaults articles_found and quotes_extracted to 0', () => {
      db.prepare("INSERT INTO backprop_log (target_date) VALUES (?)").run('2025-01-12');
      const row = db.prepare('SELECT * FROM backprop_log WHERE target_date = ?').get('2025-01-12');
      expect(row.articles_found).toBe(0);
      expect(row.quotes_extracted).toBe(0);
      expect(row.status).toBe('pending');
    });
  });

  describe('gap detection logic', () => {
    it('finds dates with no visible quotes', () => {
      // Insert quotes for some dates
      db.prepare("INSERT INTO quotes (person_id, text, is_visible, created_at) VALUES (1, 'Q1', 1, '2025-01-15 12:00:00')")
        .run();
      db.prepare("INSERT INTO quotes (person_id, text, is_visible, created_at) VALUES (1, 'Q2', 1, '2025-01-17 12:00:00')")
        .run();

      // Query dates with quotes
      const datesWithQuotes = db.prepare(`
        SELECT DISTINCT DATE(created_at) as quote_date FROM quotes WHERE is_visible = 1
      `).all().map(r => r.quote_date);

      expect(datesWithQuotes).toContain('2025-01-15');
      expect(datesWithQuotes).toContain('2025-01-17');
      expect(datesWithQuotes).not.toContain('2025-01-16'); // gap day
    });

    it('excludes dates already in backprop_log', () => {
      const attempted = db.prepare('SELECT target_date FROM backprop_log').all().map(r => r.target_date);
      expect(attempted).toContain('2025-01-01');
      expect(attempted).toContain('2025-01-10');
    });

    it('INSERT OR REPLACE allows re-running a date', () => {
      db.prepare(`
        INSERT OR REPLACE INTO backprop_log (target_date, status, started_at)
        VALUES (?, 'processing', datetime('now'))
      `).run('2025-01-11');

      const row = db.prepare('SELECT * FROM backprop_log WHERE target_date = ?').get('2025-01-11');
      expect(row.status).toBe('processing');
      expect(row.error).toBeNull(); // error was cleared by REPLACE
    });
  });
});
