import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import config from './index.js';

let db;

export function getDb() {
  if (db) return db;

  const dbPath = config.databasePath;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables(db);

  return db;
}

function initializeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      bio TEXT,
      image_url TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      author TEXT NOT NULL,
      source_url TEXT,
      source_name TEXT,
      published_date INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL,
      source_url TEXT,
      source_name TEXT,
      published_date INTEGER,
      FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE NOT NULL,
      value TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS application_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('error', 'warn', 'info', 'debug')),
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      request_id TEXT,
      ip_address TEXT,
      details TEXT,
      duration INTEGER,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    )
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON application_logs(timestamp)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_level ON application_logs(level)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_logs_category ON application_logs(category)`);

  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  insertSetting.run('theme', 'light');
  insertSetting.run('log_level', 'info');
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

export default { getDb, closeDb };
