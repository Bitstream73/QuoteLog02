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

  // Re-read DATABASE_PATH from env to support test-file isolation (ESM caches config at first import)
  const dbPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : config.databasePath;
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
    const dbPath = process.env.DATABASE_PATH ? path.resolve(process.env.DATABASE_PATH) : config.databasePath;
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

  // Historical Sources — Provider registry for historical quote backfill
  db.exec(`
    CREATE TABLE IF NOT EXISTS historical_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'unknown'
        CHECK(status IN ('working', 'failed', 'disabled', 'unknown')),
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      total_articles_fetched INTEGER NOT NULL DEFAULT 0,
      last_fetch_at TEXT,
      last_success_at TEXT,
      last_error TEXT,
      config TEXT DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_historical_sources_key ON historical_sources(provider_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_historical_sources_enabled ON historical_sources(enabled)`);

  // Seed default historical providers
  const defaultProviders = [
    { provider_key: 'wikiquote', name: 'Wikiquote', description: 'Quotes from Wikiquote via MediaWiki API' },
    { provider_key: 'chronicling_america', name: 'Chronicling America', description: 'Historical US newspapers via Library of Congress API (1836-1963)' },
    { provider_key: 'wayback', name: 'Wayback Machine', description: 'Historical news article snapshots via Internet Archive CDX API' },
    { provider_key: 'govinfo', name: 'Congressional Record', description: 'Congressional speeches via GovInfo API (1995-present)' },
    { provider_key: 'presidency_project', name: 'American Presidency Project', description: 'Presidential speeches and press conferences from UCSB archive (1789-present)' },
  ];

  const insertProvider = db.prepare(
    'INSERT OR IGNORE INTO historical_sources (provider_key, name, description) VALUES (?, ?, ?)'
  );
  for (const p of defaultProviders) {
    insertProvider.run(p.provider_key, p.name, p.description);
  }

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
  if (!personCols.includes('image_suggestions')) {
    db.exec(`ALTER TABLE persons ADD COLUMN image_suggestions TEXT`);
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

  // Migration: add historical_source_id column to articles (NULL for RSS articles)
  if (!articleCols.includes('historical_source_id')) {
    db.exec(`ALTER TABLE articles ADD COLUMN historical_source_id INTEGER REFERENCES historical_sources(id)`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_historical ON articles(historical_source_id)`);

  // Migration: add prefetched_text column to articles (for providers returning full text)
  if (!articleCols.includes('prefetched_text')) {
    db.exec(`ALTER TABLE articles ADD COLUMN prefetched_text TEXT`);
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

  // --- Important? System (replaces upvote/downvote) ---

  // Importants — Polymorphic "Important?" marks (quote, article, person, topic)
  db.exec(`
    CREATE TABLE IF NOT EXISTS importants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('quote', 'article', 'person', 'topic')),
      entity_id INTEGER NOT NULL,
      voter_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(entity_type, entity_id, voter_hash)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_importants_entity ON importants(entity_type, entity_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_importants_voter ON importants(voter_hash)`);

  // --- Legacy table cleanup: drop old topic/keyword tables that had different schemas ---
  // The old taxonomy tables (topics, keywords, quote_keywords, quote_topics, topic_keywords)
  // have incompatible schemas. DROP them so CREATE TABLE IF NOT EXISTS creates the new versions.
  // Check if old schema exists by looking for missing columns before dropping.
  const oldTopicCols = db.prepare("PRAGMA table_info(topics)").all().map(c => c.name);
  if (oldTopicCols.length > 0 && !oldTopicCols.includes('status')) {
    // Old topics table exists without 'status' column — drop all old taxonomy tables
    db.exec(`DROP TABLE IF EXISTS quote_topics`);
    db.exec(`DROP TABLE IF EXISTS quote_keywords`);
    db.exec(`DROP TABLE IF EXISTS topic_keywords`);
    db.exec(`DROP TABLE IF EXISTS category_topics`);
    db.exec(`DROP TABLE IF EXISTS topic_aliases`);
    db.exec(`DROP TABLE IF EXISTS keyword_aliases`);
    db.exec(`DROP TABLE IF EXISTS taxonomy_suggestions`);
    db.exec(`DROP TABLE IF EXISTS categories`);
    db.exec(`DROP TABLE IF EXISTS topics`);
    db.exec(`DROP TABLE IF EXISTS keywords`);
  }
  db.exec(`DROP TABLE IF EXISTS topic_keyword_review`);

  // --- New Taxonomy Schema ---

  // Keywords — canonical keyword entities
  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_normalized TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Keyword aliases — alternate names for a keyword
  db.exec(`
    CREATE TABLE IF NOT EXISTS keyword_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(keyword_id, alias)
    )
  `);

  // Topics — curated topic entities with lifecycle
  db.exec(`
    CREATE TABLE IF NOT EXISTS topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','draft')),
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Topic aliases — alternate names for a topic
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(topic_id, alias)
    )
  `);

  // Categories — top-level groupings for topics
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Topic-keyword association (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS topic_keywords (
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      PRIMARY KEY (topic_id, keyword_id)
    )
  `);

  // Category-topic association (many-to-many)
  db.exec(`
    CREATE TABLE IF NOT EXISTS category_topics (
      category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (category_id, topic_id)
    )
  `);

  // Quote-keyword association with confidence
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      confidence TEXT NOT NULL DEFAULT 'high' CHECK(confidence IN ('high','medium','low')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(quote_id, keyword_id)
    )
  `);

  // Quote-topic association (materialized from quote_keywords + topic_keywords)
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_topics (
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (quote_id, topic_id)
    )
  `);

  // Taxonomy suggestions — review queue for AI-suggested taxonomy changes
  db.exec(`
    CREATE TABLE IF NOT EXISTS taxonomy_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_type TEXT NOT NULL CHECK(suggestion_type IN ('new_keyword','new_topic','keyword_alias','topic_keyword','topic_alias')),
      suggested_data TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('ai_extraction','batch_evolution','confidence_review')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','edited')),
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // --- Taxonomy indexes ---
  db.exec(`CREATE INDEX IF NOT EXISTS idx_keyword_aliases_keyword_id ON keyword_aliases(keyword_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_keyword_aliases_normalized ON keyword_aliases(alias_normalized)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_aliases_topic_id ON topic_aliases(topic_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_topic_aliases_normalized ON topic_aliases(alias_normalized)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_topics_slug ON topics(slug)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_slug ON categories(slug)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_categories_sort ON categories(sort_order)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_quote ON quote_keywords(quote_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_keyword ON quote_keywords(keyword_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_confidence ON quote_keywords(confidence)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_topics_quote ON quote_topics(quote_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_topics_topic ON quote_topics(topic_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_taxonomy_suggestions_status ON taxonomy_suggestions(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_taxonomy_suggestions_type ON taxonomy_suggestions(suggestion_type)`);

  // --- Site Topic Focus migrations: new columns for importants/share/view/trending ---

  // quotes: quote_datetime, importants_count, share_count, trending_score
  const quoteCols2 = db.prepare("PRAGMA table_info(quotes)").all().map(c => c.name);
  if (!quoteCols2.includes('quote_datetime')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN quote_datetime TEXT`);
  }
  if (!quoteCols2.includes('importants_count')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!quoteCols2.includes('share_count')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!quoteCols2.includes('trending_score')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0`);
  }
  if (!quoteCols2.includes('fact_check_category')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_category TEXT CHECK(fact_check_category IN ('A', 'B', 'C'))`);
  }
  if (!quoteCols2.includes('fact_check_confidence')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_confidence REAL`);
  }
  if (!quoteCols2.includes('reviewed_at')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN reviewed_at TEXT`);
  }
  if (!quoteCols2.includes('fact_check_verdict')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_verdict TEXT`);
  }
  if (!quoteCols2.includes('fact_check_claim')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_claim TEXT`);
  }
  if (!quoteCols2.includes('fact_check_explanation')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_explanation TEXT`);
  }
  if (!quoteCols2.includes('extracted_keywords')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN extracted_keywords TEXT`);
  }
  if (!quoteCols2.includes('extracted_topics')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN extracted_topics TEXT`);
  }
  if (!quoteCols2.includes('fact_check_html')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_html TEXT`);
  }
  if (!quoteCols2.includes('fact_check_references_json')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_references_json TEXT`);
  }
  if (!quoteCols2.includes('fact_check_agree_count')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_agree_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!quoteCols2.includes('fact_check_disagree_count')) {
    db.exec(`ALTER TABLE quotes ADD COLUMN fact_check_disagree_count INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_fact_check ON quotes(fact_check_category) WHERE fact_check_category IS NOT NULL`);

  // articles: importants_count, share_count, view_count, trending_score
  const articleCols2 = db.prepare("PRAGMA table_info(articles)").all().map(c => c.name);
  if (!articleCols2.includes('importants_count')) {
    db.exec(`ALTER TABLE articles ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!articleCols2.includes('share_count')) {
    db.exec(`ALTER TABLE articles ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!articleCols2.includes('view_count')) {
    db.exec(`ALTER TABLE articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!articleCols2.includes('trending_score')) {
    db.exec(`ALTER TABLE articles ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0`);
  }

  // persons: importants_count, share_count, view_count, trending_score
  const personCols2 = db.prepare("PRAGMA table_info(persons)").all().map(c => c.name);
  if (!personCols2.includes('importants_count')) {
    db.exec(`ALTER TABLE persons ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!personCols2.includes('share_count')) {
    db.exec(`ALTER TABLE persons ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!personCols2.includes('view_count')) {
    db.exec(`ALTER TABLE persons ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!personCols2.includes('trending_score')) {
    db.exec(`ALTER TABLE persons ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0`);
  }


  // --- Trending / importants indexes ---
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_trending ON quotes(trending_score DESC) WHERE is_visible = 1`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(trending_score DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_persons_trending ON persons(trending_score DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_importants ON quotes(importants_count DESC) WHERE is_visible = 1`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_datetime ON quotes(quote_datetime DESC) WHERE is_visible = 1`);

  // Quote context analysis cache (AI "Get More Context" results)
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_context_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
      analysis TEXT NOT NULL,
      related_quote_ids TEXT NOT NULL DEFAULT '[]',
      model_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_context_cache_quote ON quote_context_cache(quote_id)`);

  // Smart related quote classifications (contradictions, context, mentions)
  db.exec(`
    CREATE TABLE IF NOT EXISTS quote_smart_related (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      related_type TEXT NOT NULL CHECK(related_type IN ('contradiction', 'context', 'mention', '_none')),
      related_quote_id INTEGER NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.0,
      explanation TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days')),
      UNIQUE(quote_id, related_quote_id, related_type)
    )
  `);

  // Migration: update quote_smart_related CHECK constraint to allow '_none' sentinel
  const qsrSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='quote_smart_related'").get();
  if (qsrSchema && !qsrSchema.sql.includes('_none')) {
    db.exec(`
      ALTER TABLE quote_smart_related RENAME TO quote_smart_related_old;
      CREATE TABLE quote_smart_related (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        related_type TEXT NOT NULL CHECK(related_type IN ('contradiction', 'context', 'mention', '_none')),
        related_quote_id INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.0,
        explanation TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days')),
        UNIQUE(quote_id, related_quote_id, related_type)
      );
      INSERT INTO quote_smart_related SELECT * FROM quote_smart_related_old;
      DROP TABLE quote_smart_related_old;
    `);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_smart_related_quote ON quote_smart_related(quote_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_smart_related_type ON quote_smart_related(quote_id, related_type)`);

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

  // Bug reports
  db.exec(`
    CREATE TABLE IF NOT EXISTS bug_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL CHECK(length(message) <= 280),
      page_url TEXT NOT NULL,
      quote_id INTEGER REFERENCES quotes(id) ON DELETE SET NULL,
      user_agent TEXT,
      ip_hash TEXT NOT NULL,
      starred INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bug_reports_created ON bug_reports(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bug_reports_starred ON bug_reports(starred DESC, created_at DESC)`);

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

  // Migration: add password_changed_at column for session invalidation
  const adminCols = db.prepare("PRAGMA table_info(admin_users)").all().map(c => c.name);
  if (!adminCols.includes('password_changed_at')) {
    db.exec(`ALTER TABLE admin_users ADD COLUMN password_changed_at TEXT`);
  }

  // Seed admin user only if no admin users exist yet
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM admin_users').get().count;
  if (adminCount === 0) {
    const adminEmail = config.adminEmail;
    const adminPassword = config.initialAdminPassword;
    if (adminEmail && adminPassword) {
      const adminHash = bcryptjs.hashSync(adminPassword, 12);
      db.prepare('INSERT INTO admin_users (email, password_hash) VALUES (?, ?)')
        .run(adminEmail, adminHash);
    } else {
      console.warn('[WARN] No admin users exist and INITIAL_ADMIN_EMAIL/INITIAL_ADMIN_PASSWORD env vars not set. No admin user seeded.');
    }
  }

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
    historical_fetch_enabled: '1',
    historical_articles_per_source_per_cycle: '5',
    min_significance_score: '5',
    backprop_enabled: '1',
    backprop_max_articles_per_cycle: '5',
    fact_check_filter_mode: 'off',
    fact_check_min_score: '0.5',
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


  // --- Phase 2 migrations: enabled columns, new tables, prompt seeds ---


  // Gemini prompts table — stores editable AI prompt templates
  db.exec(`
    CREATE TABLE IF NOT EXISTS gemini_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_key TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      template TEXT NOT NULL,
      category TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Noteworthy items — curated homepage highlights
  db.exec(`
    CREATE TABLE IF NOT EXISTS noteworthy_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('quote', 'article', 'topic', 'category')),
      entity_id INTEGER NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(entity_type, entity_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_noteworthy_active ON noteworthy_items(active, display_order)`);

  // Migration: add 'category' to noteworthy_items entity_type CHECK constraint
  const nwSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='noteworthy_items'").get();
  if (nwSchema && !nwSchema.sql.includes("'category'")) {
    db.exec(`
      ALTER TABLE noteworthy_items RENAME TO noteworthy_items_old;
      CREATE TABLE noteworthy_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL CHECK(entity_type IN ('quote', 'article', 'topic', 'category')),
        entity_id INTEGER NOT NULL,
        display_order INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(entity_type, entity_id)
      );
      INSERT INTO noteworthy_items SELECT * FROM noteworthy_items_old;
      DROP TABLE noteworthy_items_old;
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_noteworthy_active ON noteworthy_items(active, display_order)');
  }

  // Back-propagation log — tracks historical quote extraction runs
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_backprop_status ON backprop_log(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_backprop_date ON backprop_log(target_date)`);

  // Index on quote_articles.article_id for faster article-based lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qa_article ON quote_articles(article_id)`);

  // Seed gemini_prompts with hardcoded defaults (INSERT OR IGNORE — won't overwrite edits)
  const insertPrompt = db.prepare(`
    INSERT OR IGNORE INTO gemini_prompts (prompt_key, name, description, template, category)
    VALUES (?, ?, ?, ?, ?)
  `);

  insertPrompt.run(
    'quote_extraction',
    'Quote Extraction',
    'Main prompt for extracting quotes from news articles via Gemini',
    `You are a precise news quote extraction system. Extract ONLY direct, verbatim quotes from this news article.

Article published: {{published_at}}
Article title: {{title}}

For each quote, return:
- quote_text: The exact quoted text as it appears in quotation marks. Use the verbatim words only.
- speaker: The full name of the person being quoted. Never use pronouns — resolve "he", "she", "they" to the actual name.
- speaker_title: Their role, title, or affiliation as mentioned in the article (e.g., "CEO of Apple", "U.S. Senator"). Null if not mentioned.
- speaker_category: One of: "Politician", "Government Official", "Business Leader", "Entertainer", "Athlete", "Pundit", "Journalist", "Scientist/Academic", "Legal/Judicial", "Military/Defense", "Activist/Advocate", "Religious Leader", "Other". Choose based on the speaker's primary public role.
- speaker_category_context: Brief context for the category. For Politicians: party and office (e.g. "Republican, U.S. Senator from Texas"). For Athletes: team and sport (e.g. "Los Angeles Lakers, NBA"). For Business Leaders: company and title. For Entertainers: medium and notable works. For Pundits/Journalists: outlet. For others: relevant affiliation. Null if unknown.
- quote_type: Always "direct".
- context: One sentence describing what the quote is about and why it was said.
- quote_date: The date when this quote was actually spoken/written, in ISO format (YYYY-MM-DD).
  * For current news quotes: use the article's publication date provided above.
  * For historical quotes (quoting someone from the past, reprinting old statements): use the original date if mentioned in the article, otherwise "unknown".
  * For "yesterday"/"last week" references: compute the actual date relative to the article publication date.
  * If the speaker is deceased or the quote clearly predates the article, do NOT use the article date.
- topics: Array of 1-3 SPECIFIC subject categories. Use the most specific applicable name:

  Politics: "U.S. Presidential Politics", "U.S. Congressional Politics", "UK Politics", "EU Politics", "State/Local Politics", "Voting Rights"
  Government: "U.S. Foreign Policy", "Diplomacy", "Intelligence & Espionage", "Military & Defense", "Governance"
  Law: "Supreme Court", "Criminal Justice", "Constitutional Law", "Civil Rights & Liberties", "Law Enforcement"
  Economy: "U.S. Finance", "Global Economy", "Federal Reserve", "Trade & Tariffs", "Labor & Employment", "Cryptocurrency"
  Business: "Big Tech", "Startups", "Corporate Governance", "Energy Industry"
  Social: "Healthcare", "Education", "Immigration", "Housing", "Gun Control", "Reproductive Rights"
  Science: "Climate & Environment", "Space Exploration", "Artificial Intelligence", "Public Health"
  Culture: "Film & Television", "Music", "Olympic Sports", "NFL", "NBA", "MLB", "Soccer", "Social Media"
  World: "Middle East Conflict", "Ukraine War", "China-Taiwan Relations", "African Affairs", "Latin American Affairs"
  Media: "Journalism", "Misinformation", "Media Industry"
  Philosophy: "Philosophy", "Ethics", "Religion"

  IMPORTANT: Use specific names, NOT broad ones. "U.S. Finance" not "Business". "UK Politics" not "Politics". "Olympic Sports" not "Sports". "Supreme Court" not "Law".

- keywords: Array of 2-5 specific named entities relevant to this quote. Follow these rules STRICTLY:

  GOOD keywords (use as models):
  "Donald Trump", "Supreme Court", "January 6th Committee", "Affordable Care Act",
  "European Union", "Silicon Valley", "Paris Climate Agreement", "Federal Reserve",
  "2026 Winter Olympics", "Senate Judiciary Committee"

  BAD keywords (NEVER produce these):
  "Trump" (incomplete — use "Donald Trump"), "critical" (adjective), "emphasizes" (verb),
  "policy" (too vague), "Donald" (first name only), "innovation" (generic noun),
  "business" (generic), "groups" (generic), "competition" (generic), "strength" (generic)

  Rules:
  1. ALWAYS use FULL proper names: "Donald Trump" not "Trump", "Federal Reserve" not "Fed"
  2. Multi-word entities are ONE keyword: "January 6th Committee" is one keyword
  3. Every keyword MUST be a proper noun, named event, specific organization, legislation, or geographic location
  4. NEVER include: verbs, adjectives, generic nouns, common words, the speaker's own name
  5. Single-word keywords are ONLY allowed for proper nouns (e.g., "NATO", "OPEC", "Brexit", "Hamas")
  6. If no specific named entities exist in the quote, return an EMPTY array — never fill with generic words

- significance: Integer 1-10 rating of how noteworthy this quote is:
  9-10: Historic or landmark statement (declaring war, resignation, major policy)
  7-8: Strong claim, bold prediction, headline-worthy, reveals new information
  5-6: Substantive opinion, meaningful analysis, newsworthy reaction
  3-4: Routine statement, standard commentary, generic encouragement
  1-2: Vague platitude, meaningless fragment, purely descriptive, no substance

  HIGH (5+): makes a specific, checkable claim; sets a measurable goal; predicts a concrete outcome; reveals new information; makes a direct accusation; provides genuine analytical insight
  LOW (1-4): "We need to do better" (platitude), "It was a nice event" (descriptive), "The meeting begins at noon" (procedural), fragments without assertion, pure rhetoric without a specific claim ("For 47 years, they've been talking and talking"), descriptions of routine actions ("Investigative actions are being carried out"), vague motivational statements

- fact_check_category: Classify this quote's verifiability:
  "A" - Contains SPECIFIC, VERIFIABLE factual claims (statistics, dates, quantities, named events, measurable outcomes)
  "B" - Expresses opinion, value judgment, policy position, or prediction — substantive but not verifiable by data lookup
  "C" - Vague platitude, procedural statement, meaningless fragment, or purely rhetorical with no substance
  Examples: "Unemployment is at 3.5%" = A, "This policy is a disaster for working families" = B, "We need to do better" = C
- fact_check_score: Float 0.0-1.0 confidence in the fact_check_category assignment (1.0 = certain, 0.5 = borderline)

Rules:
- Do NOT extract quotes that are purely rhetorical, procedural, or vague. A quote must contain at least one specific claim, assertion, opinion, accusation, or prediction to be worth extracting.
- ONLY extract verbatim quotes that appear inside quotation marks.
- Do NOT extract indirect/reported speech, paraphrases, or descriptions of what someone said.
- Only extract quotes attributed to a specific named person. Skip unattributed quotes.
- If a quote spans multiple paragraphs, combine into one entry.
- If a person is quoted multiple times, create separate entries for each distinct statement.
- Do NOT fabricate or embellish quotes. Only extract what is in the article.
- For speaker names, use the most complete version that appears in the article.

Return a JSON object: { "quotes": [...] }
If there are no attributable direct quotes, return: { "quotes": [] }

Article text:
{{article_text}}`,
    'extraction'
  );

  insertPrompt.run(
    'classify_and_verify',
    'Classify and Verify',
    'Fact-check prompt: classifies quotes (A/B/C) and verifies Category A claims via Google Search grounding',
    `You are a fact-check engine for a news quote aggregator. You will classify a quote and, if it contains verifiable claims, use Google Search to find evidence and produce a verdict.

## The Quote
"{{quote_text}}"

## Metadata
- **Speaker**: {{author_name}}{{author_description}}
- **Source**: {{source_name}}
- **Date**: {{source_date}}
- **Context**: {{context}}
- **Topic Tags**: {{tags}}

## Step 1: Classify

Classify this quote into exactly ONE category:

### Category A — VERIFIABLE
The quote contains one or more **specific factual claims** that can be checked against real-world data. Examples:
- Statistical claims ("unemployment is at 3.5%", "the Dow has never been higher")
- Historical claims ("this hasn't happened since 1929")
- Comparative claims ("we have the largest economy in Europe")
- Attribution claims ("the study found that...")
- Quantitative claims ("we've created 10 million jobs")
- Status claims ("this law is still in effect", "they are the largest employer")

### Category B — SUBJECTIVE/OPINION
The quote expresses opinions, feelings, value judgments, predictions, or policy positions that **cannot be reduced to a data lookup**. The quote IS meaningful and coherent, it just isn't checkable. Examples:
- "This policy is a disaster for working families"
- "We need to invest more in education"

### Category C — UNVERIFIABLE FRAGMENT
The quote, even WITH its provided context, is too fragmentary, vague, or rhetorical to contain any checkable claim OR meaningful opinion. Examples:
- "was really surprising to me. It always is."
- "and that's what we're going to do"

## Step 2: If Category A, Verify

If the quote is Category A, you MUST use Google Search to find evidence for the primary claim. Then evaluate the evidence and produce a verdict.

Verdicts:
- **TRUE** — The claim is accurate according to reliable sources
- **MOSTLY_TRUE** — The claim is substantially accurate but may have minor inaccuracies
- **FALSE** — The claim is inaccurate according to reliable sources
- **MOSTLY_FALSE** — The claim is substantially inaccurate
- **MISLEADING** — The claim is technically true but presented in a way that creates a false impression
- **LACKS_CONTEXT** — The claim is true but omits important qualifying information
- **UNVERIFIABLE** — Insufficient evidence found to verify or refute the claim

## Response Format (JSON only, no markdown fences)

For Category A (verifiable):
{
  "category": "A",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why this is verifiable.",
  "claims": [
    {
      "claim_text": "The specific factual assertion",
      "data_type": "statistic | historical_record | comparative | status | attribution",
      "verification_approach": "Brief description of how this was verified"
    }
  ],
  "summary_label": "Short label, e.g. 'Statistical claim about employment'",
  "verdict": "TRUE | FALSE | MOSTLY_TRUE | MOSTLY_FALSE | MISLEADING | LACKS_CONTEXT | UNVERIFIABLE",
  "verdict_explanation": "2-3 sentence plain-language explanation of the verdict based on evidence found.",
  "key_data_points": [
    {
      "label": "What this data point represents",
      "value": "The actual value/fact found",
      "source_name": "Name of the source",
      "source_url": "URL of the source",
      "date": "Date of the data point if applicable"
    }
  ],
  "display_type": "text | single_stat | comparison | timeline | excerpt",
  "display_rationale": "Why this display type best illustrates the evidence.",
  "timeline_data": [],
  "comparison_data": null,
  "citation": {
    "text": "Formatted citation text",
    "url": "Primary source URL"
  }
}

For Category B (opinion):
{
  "category": "B",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why this is opinion/subjective.",
  "claims": [],
  "summary_label": "Short label, e.g. 'Opinion on trade policy'"
}

For Category C (fragment):
{
  "category": "C",
  "confidence": 0.0-1.0,
  "reasoning": "One sentence explaining why this is an unverifiable fragment.",
  "claims": [],
  "summary_label": "Short label, e.g. 'Rhetorical fragment'"
}

## RULES
- "claims" array should ONLY be populated for Category A. Empty array for B and C.
- Be conservative: if a claim MIGHT be verifiable but would require highly specialized non-public data, classify as B.
- If the quote contains BOTH verifiable claims AND opinions, classify as A and extract only the verifiable parts.
- For Category A: always include at least one key_data_point with a source_url. If you cannot find evidence, set verdict to UNVERIFIABLE.
- Be precise about dates. If the claim was made on {{source_date}}, evaluate data AS OF that date.
- "MISLEADING" means technically true but presented in a way that creates a false impression.
- "LACKS_CONTEXT" means the claim is true but omits important qualifying information.
- "timeline_data" only populated when display_type is "timeline".
- "comparison_data" only populated when display_type is "comparison".`,
    'fact_check'
  );

  insertPrompt.run(
    'extract_and_enrich_references',
    'Extract and Enrich References',
    'Identifies references in quotes and uses Google Search to find URLs, summaries, and media embeds',
    `You are a reference extraction and enrichment engine for a news quote aggregator. Your job is to identify concepts, entities, and references in a quote, then use Google Search to find authoritative links and summaries for each.

## The Quote
"{{quote_text}}"

## Metadata
- **Speaker**: {{author_name}}{{author_description}}
- **Source**: {{source_name}}
- **Date**: {{source_date}}
- **Context**: {{context}}
- **Topic Tags**: {{tags}}

## Step 1: Identify References

Identify every referenceable item in the quote — anything a reader might not immediately understand, want to learn more about, or want to see primary source material for.

### Reference Types

**policy** — Named policies, executive orders, legislative acts, agreements
**organization** — Companies, agencies, international bodies, NGOs
**person** — People referenced in the quote (NOT the speaker themselves)
**event** — Named events, hearings, summits, incidents, historical events
**concept** — Economic concepts, legal terms, technical jargon
**location** — Specific places, regions, jurisdictions referenced
**statistic** — Referenced data points, studies, reports, indices
**media_clip** — If the speaker is a media personality and the quote is from a broadcast
**legal_document** — Court rulings, legal filings, constitutional provisions

## Step 2: Enrich Each Reference

For EACH reference you identify, use Google Search to find:
- The most authoritative URL (official sites > major news > Wikipedia)
- A concise 2-3 sentence factual summary
- Optional additional links (0-2 max)
- If it's a media_clip type, look for the actual video (YouTube preferred)

## Response Format (JSON only, no markdown fences)

{
  "references": [
    {
      "text_span": "Exact text from the quote",
      "type": "policy | organization | person | event | concept | location | statistic | media_clip | legal_document",
      "display_name": "Human-readable name",
      "why_relevant": "One sentence on why a reader would want this link",
      "priority": "high | medium | low",
      "enrichment": {
        "found": true,
        "title": "The reference title",
        "summary": "2-3 sentence factual explanation (under 60 words)",
        "primary_url": "Best URL for more information",
        "primary_source_name": "Source name (e.g., 'Wikipedia', 'Congress.gov')",
        "additional_links": [
          {
            "url": "Secondary useful link",
            "label": "Short label",
            "source_name": "Source name"
          }
        ],
        "media_embed": {
          "type": "youtube | none",
          "url": "Embeddable URL if video found, null otherwise",
          "title": "Video title",
          "timestamp_seconds": null
        },
        "date_context": "Relevant date if applicable (e.g., 'Signed January 20, 2025')",
        "category_tag": "Short tag (e.g., 'Executive Order', 'TV Clip', 'Federal Agency')"
      }
    }
  ],
  "media_clip": null
}

If the speaker is a media personality (TV host, comedian, podcaster) AND the quote sounds like it's from a broadcast, include a "media_clip" object.

## RULES

1. **Be selective, not exhaustive.** Don't flag common words or universally understood concepts. "the economy" doesn't need a link. "the Smoot-Hawley Tariff Act" does.
2. **Context matters.** If the context already explains something, it's lower priority.
3. **The speaker themselves are NOT a reference.**
4. **Priority guide**:
   - **high**: Named policies, specific legislation, technical terms most readers wouldn't know
   - **medium**: Well-known organizations, widely reported events
   - **low**: Very well-known entities (e.g., "Congress"), general locations
5. **text_span must be an EXACT substring** of the quote text.
6. **Prefer 2-5 references per quote.** Only exceed for very dense quotes. Never more than 8.
7. **For quotes with no meaningful references**, return an empty references array and null media_clip.
8. For YouTube URLs, convert to embed format: "https://www.youtube.com/embed/VIDEO_ID"
9. If enrichment search finds nothing relevant for a reference, set enrichment.found to false.
10. "summary" should be in your OWN words, factual and neutral, under 60 words.`,
    'fact_check'
  );

  insertPrompt.run(
    'html_rendering',
    'HTML Rendering',
    'Generates custom HTML for complex fact-check display types (timeline, comparison)',
    `You are an HTML renderer for a fact-check widget on WhatTheySaid.News. Generate clean, semantic HTML that uses the site's existing CSS variables.

## Site Design System
The site uses these CSS custom properties:
- --bg-primary, --bg-secondary, --bg-card (backgrounds)
- --text-primary, --text-secondary, --text-muted (text colors)
- --accent: #c41e3a (primary red accent)
- --success: #16a34a (green - for TRUE verdicts)
- --warning: #d4880f (amber - for MISLEADING/LACKS_CONTEXT)
- --error: #c41e3a (red - for FALSE verdicts)
- --info: #2563eb (blue - for UNVERIFIABLE)
- --border, --border-dark (borders)
- --radius: 2px
- --font-headline: 'Playfair Display', serif
- --font-body: 'Source Serif 4', serif
- --font-ui: 'Inter', sans-serif
- --font-mono: 'Fira Code', monospace

The site supports dark mode via a .dark-mode class on <body>.

## Data to Render
{{verdict_json}}

## Display Type: {{display_type}}

## Generate HTML

Produce a single HTML fragment (no <html>, <head>, or <body> tags) that can be inserted into a <div class="fact-check-result"> container.

Requirements:
1. Use the fact-check-widget CSS classes defined below. Do NOT use inline styles except for dynamic values (like chart widths).
2. Include the verdict badge, explanation, key data points with citations, and the appropriate visualization.
3. For "timeline" display_type: render a simple CSS bar chart or sparkline using div elements (no JS charting libraries needed).
4. For "comparison" display_type: render a side-by-side comparison (claimed vs actual).
5. For "single_stat" display_type: render a large highlighted number with context.
6. For "text" display_type: render the explanation with cited excerpts.
7. For "excerpt" display_type: render a blockquote-style excerpt from the source.
8. All source links should open in new tabs.
9. Keep it compact — this sits inside an existing quote detail page.

The output should be ONLY the HTML fragment, no explanation.`,
    'fact_check'
  );

  // --- Migration: normalize non-ISO quote_datetime values ---
  const badDates = db.prepare(
    `SELECT id, quote_datetime FROM quotes
     WHERE quote_datetime IS NOT NULL
       AND quote_datetime NOT GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'`
  ).all();
  if (badDates.length > 0) {
    const update = db.prepare('UPDATE quotes SET quote_datetime = ? WHERE id = ?');
    const fixBatch = db.transaction(() => {
      for (const row of badDates) {
        const d = new Date(row.quote_datetime);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          update.run(`${yyyy}-${mm}-${dd}`, row.id);
        } else {
          update.run(null, row.id);
        }
      }
    });
    fixBatch();
    console.log(`[migration] Normalized ${badDates.length} non-ISO quote_datetime values`);
  }

}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
  dbReady = false;
  dbInitPromise = null;
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
