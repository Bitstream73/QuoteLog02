import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcryptjs from 'bcryptjs';
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
  // Sources - User-configured reputable news sources
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL UNIQUE,
      name TEXT,
      rss_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Articles - Tracked articles (prevents re-processing)
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      source_id INTEGER REFERENCES sources(id),
      title TEXT,
      published_at TEXT,
      processed_at TEXT,
      quote_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'no_quotes')),
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_url ON articles(url)`);

  // Persons - Canonical persons (one row per real-world person)
  db.exec(`
    CREATE TABLE IF NOT EXISTS persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      disambiguation TEXT,
      wikidata_id TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      quote_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT DEFAULT '{}'
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_persons_canonical ON persons(canonical_name)`);

  // Person aliases - Name variants (many-to-one with persons)
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      alias_type TEXT NOT NULL DEFAULT 'variant'
        CHECK(alias_type IN ('variant', 'abbreviation', 'nickname', 'title_form', 'full_name')),
      confidence REAL NOT NULL DEFAULT 1.0,
      source TEXT NOT NULL DEFAULT 'extraction'
        CHECK(source IN ('extraction', 'llm', 'fuzzy_match', 'user', 'knowledge_graph')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_aliases_normalized ON person_aliases(alias_normalized)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_aliases_person ON person_aliases(person_id)`);

  // Phonetic codes for sound-based lookup
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_phonetics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
      name_part TEXT NOT NULL,
      metaphone_code TEXT NOT NULL,
      part_type TEXT NOT NULL DEFAULT 'last'
        CHECK(part_type IN ('first', 'last', 'middle'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_phonetics_code ON person_phonetics(metaphone_code, part_type)`);

  // Quotes
  db.exec(`
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id),
      text TEXT NOT NULL,
      quote_type TEXT NOT NULL DEFAULT 'direct'
        CHECK(quote_type IN ('direct', 'indirect')),
      context TEXT,
      canonical_quote_id INTEGER REFERENCES quotes(id),
      source_urls TEXT NOT NULL DEFAULT '[]',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_person ON quotes(person_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_canonical ON quotes(canonical_quote_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_created ON quotes(created_at DESC)`);

  // Quote-to-article link (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_articles (
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      PRIMARY KEY (quote_id, article_id)
    )
  `);

  // Quote relationships (dedup tracking)
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id_a INTEGER NOT NULL REFERENCES quotes(id),
      quote_id_b INTEGER NOT NULL REFERENCES quotes(id),
      relationship TEXT NOT NULL
        CHECK(relationship IN ('identical', 'subset', 'paraphrase', 'same_topic')),
      confidence REAL NOT NULL,
      canonical_quote_id INTEGER REFERENCES quotes(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(quote_id_a, quote_id_b)
    )
  `);

  // Person merge audit trail
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_merges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      surviving_person_id INTEGER NOT NULL REFERENCES persons(id),
      merged_person_id INTEGER NOT NULL,
      merged_at TEXT NOT NULL DEFAULT (datetime('now')),
      merged_by TEXT NOT NULL CHECK(merged_by IN ('auto', 'user', 'llm')),
      confidence REAL,
      reason TEXT
    )
  `);

  // Disambiguation review queue
  db.exec(`
    CREATE TABLE IF NOT EXISTS disambiguation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      new_name TEXT NOT NULL,
      new_name_normalized TEXT NOT NULL,
      new_context TEXT,
      candidate_person_id INTEGER REFERENCES persons(id),
      candidate_name TEXT,
      similarity_score REAL,
      match_signals TEXT,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'merged', 'rejected', 'new_person')),
      resolved_by TEXT,
      resolved_at TEXT,
      quote_id INTEGER REFERENCES quotes(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_disam_status ON disambiguation_queue(status)`);

  // App settings (key-value)
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Application logs
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

  // Admin users
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Password reset tokens
  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed admin user (upsert to ensure password hash is always current)
  const adminHash = bcryptjs.hashSync('Ferret@00', 12);
  db.prepare(`INSERT INTO admin_users (email, password_hash) VALUES (?, ?)
    ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash, updated_at = datetime('now')`)
    .run('jakob@karlsmark.com', adminHash);

  // Insert default settings
  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  insertSetting.run('fetch_interval_minutes', '15');
  insertSetting.run('article_lookback_hours', '24');
  insertSetting.run('auto_merge_confidence_threshold', '0.9');
  insertSetting.run('review_confidence_threshold', '0.7');
  insertSetting.run('max_articles_per_cycle', '100');
  insertSetting.run('min_quote_words', '5');
  insertSetting.run('theme', 'light');
  insertSetting.run('log_level', 'info');
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

// Helper function to get a setting value
export function getSettingValue(key, defaultValue = null) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : defaultValue;
}

// Helper function to set a setting value
export function setSettingValue(key, value) {
  const db = getDb();
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, String(value));
}

export default { getDb, closeDb, getSettingValue, setSettingValue };
