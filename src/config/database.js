import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcryptjs from 'bcryptjs';
import config from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let db;
let dbReady = false;
let dbInitPromise = null;

/**
 * Get the database connection. Returns the db if ready, throws if not yet initialized.
 */
export function getDb() {
  if (db) return db;

  // Synchronous attempt — works in dev or after volume is mounted
  const dbPath = config.databasePath;
  const dbDir = path.dirname(dbPath);

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables(db);
  dbReady = true;
  return db;
}

/** Check if database is initialized and ready */
export function isDbReady() {
  return dbReady;
}

/**
 * Initialize database with async retry logic for Railway volume mount race condition.
 * Railway mounts volumes asynchronously — the app can start before /app/data is ready.
 * This runs in the background so the server can start and pass healthcheck immediately.
 */
export async function initDbAsync() {
  if (db) return db;
  if (dbInitPromise) return dbInitPromise;

  dbInitPromise = (async () => {
    const dbPath = config.databasePath;
    const dbDir = path.dirname(dbPath);
    const maxRetries = 60;
    const retryDelayMs = 2000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      // Diagnostic logging every 5 attempts
      if (attempt === 1 || attempt % 5 === 0) {
        const dirExists = fs.existsSync(dbDir);
        let writable = false;
        let dirContents = [];
        let statInfo = null;
        try {
          fs.accessSync(dbDir, fs.constants.W_OK);
          writable = true;
        } catch { writable = false; }
        try { dirContents = fs.readdirSync(dbDir); } catch { dirContents = ['<unreadable>']; }
        try {
          const s = fs.statSync(dbDir);
          statInfo = { uid: s.uid, gid: s.gid, mode: s.mode.toString(8) };
        } catch { statInfo = null; }
        console.log(`[startup] DB diagnostics (attempt ${attempt}): path=${dbPath}, dir=${dbDir}, exists=${dirExists}, writable=${writable}, contents=[${dirContents.join(',')}], stat=${JSON.stringify(statInfo)}, pid_uid=${process.getuid?.() ?? 'N/A'}`);
      }

      try {
        if (!fs.existsSync(dbDir)) {
          fs.mkdirSync(dbDir, { recursive: true });
        }

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');

        initializeTables(db);
        dbReady = true;

        if (attempt > 1) {
          console.log(`[startup] Database opened successfully on attempt ${attempt}`);
        }
        return db;
      } catch (err) {
        if (err.code === 'SQLITE_CANTOPEN' && attempt < maxRetries) {
          if (attempt <= 3 || attempt % 10 === 0) {
            console.warn(`[startup] Database open failed (attempt ${attempt}/${maxRetries}): ${err.message}`);
          }
          await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          db = null;
        } else {
          throw err;
        }
      }
    }
  })();

  return dbInitPromise;
}

function initializeTables(db) {
  // Sources - User-configured reputable news sources
  // domain is NOT unique — multiple feeds from the same domain are allowed (e.g. CNN Politics, CNN World)
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      name TEXT,
      rss_url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain)`);

  // Migration: remove UNIQUE constraint from domain column (allow multiple feeds per domain)
  const domainColInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='sources'").get();
  if (domainColInfo && domainColInfo.sql.includes('domain TEXT NOT NULL UNIQUE')) {
    db.exec(`
      ALTER TABLE sources RENAME TO sources_old;
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        name TEXT,
        rss_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO sources SELECT * FROM sources_old;
      DROP TABLE sources_old;
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_sources_domain ON sources(domain)`);
  }

  // Migration: normalize source domains to root domain (e.g., rss.cnn.com -> cnn.com)
  const sourcesWithSubdomains = db.prepare(
    "SELECT id, domain FROM sources WHERE domain LIKE '%.%.%'"
  ).all();
  for (const src of sourcesWithSubdomains) {
    const parts = src.domain.split('.');
    let rootDomain;
    const sld = parts[parts.length - 2];
    if (['co', 'com', 'org', 'net', 'gov', 'ac', 'edu'].includes(sld)) {
      rootDomain = parts.slice(-3).join('.');
    } else {
      rootDomain = parts.slice(-2).join('.');
    }
    if (rootDomain !== src.domain) {
      db.prepare('UPDATE sources SET domain = ? WHERE id = ?').run(rootDomain, src.id);
    }
  }

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

  // Migration: add is_visible column to quotes
  const quoteCols = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name);
  if (!quoteCols.includes('is_visible')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN is_visible INTEGER NOT NULL DEFAULT 1`);
  }
  if (!quoteCols.includes('rss_metadata')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN rss_metadata TEXT`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_visible ON quotes(is_visible)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_visible_created ON quotes(is_visible, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_person_visible_created ON quotes(person_id, is_visible, created_at)`);

  // Migration: add photo_url column to persons
  const personCols = db.prepare("PRAGMA table_info(persons)").all().map(c => c.name);
  if (!personCols.includes('photo_url')) {
    db.exec(`ALTER TABLE persons ADD COLUMN photo_url TEXT`);
  }
  if (!personCols.includes('category')) {
    db.exec(`ALTER TABLE persons ADD COLUMN category TEXT DEFAULT 'Other'`);
  }
  if (!personCols.includes('category_context')) {
    db.exec(`ALTER TABLE persons ADD COLUMN category_context TEXT`);
  }

  // Migration: add is_top_story column to sources
  const sourceCols = db.prepare("PRAGMA table_info(sources)").all().map(c => c.name);
  if (!sourceCols.includes('is_top_story')) {
    db.exec(`ALTER TABLE sources ADD COLUMN is_top_story INTEGER NOT NULL DEFAULT 0`);
  }

  // Migration: add is_top_story column to articles
  const articleCols = db.prepare("PRAGMA table_info(articles)").all().map(c => c.name);
  if (!articleCols.includes('is_top_story')) {
    db.exec(`ALTER TABLE articles ADD COLUMN is_top_story INTEGER NOT NULL DEFAULT 0`);
  }

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

  // --- Upvote System ---

  // Votes - Anonymous upvotes/downvotes on quotes
  db.exec(`
    CREATE TABLE IF NOT EXISTS votes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      voter_hash TEXT NOT NULL,
      vote_value INTEGER NOT NULL CHECK(vote_value IN (-1, 1)),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(quote_id, voter_hash)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_quote_id ON votes(quote_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_voter_hash ON votes(voter_hash)`);

  // Quote keywords - Extracted keywords for analytics aggregation
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      keyword TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_keyword ON quote_keywords(keyword)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_quote_id ON quote_keywords(quote_id)`);

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

  // Insert default settings (seed from file if available, else use hardcoded defaults)
  const settingsSeedPath = [
    path.join(__dirname, '../../data/settings-seed.json'),
    path.join(__dirname, '../../settings-seed.json'),
  ].find(p => fs.existsSync(p));

  const defaultSettings = {
    fetch_interval_minutes: '5',
    article_lookback_hours: '24',
    auto_merge_confidence_threshold: '0.9',
    review_confidence_threshold: '0.7',
    max_articles_per_source_per_cycle: '10',
    min_quote_words: '5',
    theme: 'light',
    log_level: 'info',
  };

  let seedSettings = defaultSettings;
  if (settingsSeedPath) {
    try {
      const seedData = JSON.parse(fs.readFileSync(settingsSeedPath, 'utf-8'));
      if (seedData.settings && typeof seedData.settings === 'object') {
        seedSettings = { ...defaultSettings, ...seedData.settings };
      }
    } catch (e) {
      // Fall back to hardcoded defaults
    }
  }

  const insertSetting = db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`);
  for (const [key, value] of Object.entries(seedSettings)) {
    insertSetting.run(key, value);
  }
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

/**
 * Verify database state at startup. Logs row counts and auto-seeds sources if empty.
 */
export function verifyDatabaseState() {
  const db = getDb();

  const counts = {
    sources: db.prepare('SELECT COUNT(*) as count FROM sources').get().count,
    persons: db.prepare('SELECT COUNT(*) as count FROM persons').get().count,
    quotes: db.prepare('SELECT COUNT(*) as count FROM quotes').get().count,
    articles: db.prepare('SELECT COUNT(*) as count FROM articles').get().count,
  };

  const resolvedPath = path.resolve(config.databasePath);
  console.log(`[startup] Database state: ${counts.sources} sources, ${counts.persons} persons, ${counts.quotes} quotes, ${counts.articles} articles`);
  console.log(`[startup] Database path: ${resolvedPath}`);

  // Warn if database is not on the expected volume mount in production
  const isProduction = config.env === 'production';
  const volumeMount = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  if (isProduction && volumeMount && !resolvedPath.startsWith(volumeMount)) {
    console.error(`[CRITICAL] Database path "${resolvedPath}" is NOT on the volume mount "${volumeMount}"!`);
    console.error('[CRITICAL] Data will be LOST on next deploy. Fix DATABASE_PATH env var.');
  }
  if (isProduction && /^[A-Z]:/i.test(resolvedPath)) {
    console.error(`[CRITICAL] Database path "${resolvedPath}" is a Windows path on a Linux container!`);
  }

  if (counts.sources === 0) {
    console.warn('[startup] WARNING: 0 sources detected \u2014 auto-seeding from sources-seed.json');
    const seeded = seedSources();
    if (seeded > 0) {
      console.log(`[startup] Seeded ${seeded} sources from sources-seed.json`);
    }
  }

  return counts;
}

/**
 * Seed sources from data/sources-seed.json
 * @returns {number} Number of sources seeded
 */
export function seedSources() {
  // Check multiple locations: data/ dir (dev), project root (Docker volume shadows data/)
  const candidates = [
    path.join(__dirname, '../../data/sources-seed.json'),
    path.join(__dirname, '../../sources-seed.json'),
  ];
  const seedPath = candidates.find(p => fs.existsSync(p));
  if (!seedPath) {
    console.warn('[startup] sources-seed.json not found at:', candidates.join(', '));
    return 0;
  }

  const seedData = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
  if (!seedData.sources || !Array.isArray(seedData.sources)) {
    console.warn('[startup] Invalid sources-seed.json format');
    return 0;
  }

  const db = getDb();
  const insert = db.prepare(
    'INSERT OR IGNORE INTO sources (domain, name, rss_url, enabled) VALUES (?, ?, ?, 1)'
  );

  let count = 0;
  for (const source of seedData.sources) {
    const result = insert.run(source.domain, source.name, source.rss_url);
    if (result.changes > 0) count++;
  }

  return count;
}

/**
 * Export current sources to data/sources-seed.json
 * @returns {number} Number of sources exported
 */
export function exportSourcesSeed() {
  const db = getDb();
  const sources = db.prepare('SELECT domain, name, rss_url FROM sources ORDER BY name ASC').all();

  const seedPath = path.join(__dirname, '../../data/sources-seed.json');
  const seedData = {
    description: 'Default news sources for QuoteLog. Auto-seeded when database has 0 sources.',
    sources,
  };

  fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2) + '\n');
  return sources.length;
}

/**
 * Export current settings to data/settings-seed.json for persistence across deploys
 * @returns {number} Number of settings exported
 */
export function exportSettingsSeed() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }

  const seedPath = path.join(__dirname, '../../data/settings-seed.json');
  const seedData = {
    description: 'Persisted settings for QuoteLog. Auto-seeded on fresh database.',
    settings,
  };

  try {
    fs.writeFileSync(seedPath, JSON.stringify(seedData, null, 2) + '\n');
  } catch (e) {
    // Non-critical - may fail in Docker if data/ is read-only
  }
  return rows.length;
}

export default { getDb, closeDb, getSettingValue, setSettingValue, verifyDatabaseState, seedSources, exportSourcesSeed, exportSettingsSeed };
