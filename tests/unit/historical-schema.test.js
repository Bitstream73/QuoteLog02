import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Historical Quote Backfill — Schema', () => {
  let db;
  const testDbPath = path.join(__dirname, '../historical-schema-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create prerequisite tables that already exist in production
    db.exec(`
      CREATE TABLE sources (
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

    db.exec(`
      CREATE TABLE articles (
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

    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  // === historical_sources table ===

  describe('historical_sources table', () => {
    beforeAll(() => {
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
    });

    it('table exists', () => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='historical_sources'").get();
      expect(table).toBeDefined();
      expect(table.name).toBe('historical_sources');
    });

    it('has all expected columns', () => {
      const cols = db.prepare('PRAGMA table_info(historical_sources)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('provider_key');
      expect(cols).toContain('name');
      expect(cols).toContain('description');
      expect(cols).toContain('enabled');
      expect(cols).toContain('status');
      expect(cols).toContain('consecutive_failures');
      expect(cols).toContain('total_articles_fetched');
      expect(cols).toContain('last_fetch_at');
      expect(cols).toContain('last_success_at');
      expect(cols).toContain('last_error');
      expect(cols).toContain('config');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('provider_key is UNIQUE', () => {
      db.prepare('INSERT INTO historical_sources (provider_key, name) VALUES (?, ?)').run('test_provider', 'Test');
      expect(() => {
        db.prepare('INSERT INTO historical_sources (provider_key, name) VALUES (?, ?)').run('test_provider', 'Test 2');
      }).toThrow();
      db.prepare('DELETE FROM historical_sources WHERE provider_key = ?').run('test_provider');
    });

    it('status CHECK constraint rejects invalid values', () => {
      expect(() => {
        db.prepare('INSERT INTO historical_sources (provider_key, name, status) VALUES (?, ?, ?)').run('bad_status', 'Bad', 'invalid');
      }).toThrow();
    });

    it('defaults are correct', () => {
      db.prepare('INSERT INTO historical_sources (provider_key, name) VALUES (?, ?)').run('defaults_test', 'Defaults');
      const row = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get('defaults_test');
      expect(row.enabled).toBe(1);
      expect(row.status).toBe('unknown');
      expect(row.consecutive_failures).toBe(0);
      expect(row.total_articles_fetched).toBe(0);
      expect(row.last_fetch_at).toBeNull();
      expect(row.last_success_at).toBeNull();
      expect(row.last_error).toBeNull();
      expect(row.config).toBe('{}');
      expect(row.created_at).toBeDefined();
      expect(row.updated_at).toBeDefined();
      db.prepare('DELETE FROM historical_sources WHERE provider_key = ?').run('defaults_test');
    });

    it('indexes exist', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
      expect(indexes).toContain('idx_historical_sources_key');
      expect(indexes).toContain('idx_historical_sources_enabled');
    });
  });

  // === Seed data ===

  describe('historical_sources seed data', () => {
    beforeAll(() => {
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
    });

    it('5 default providers exist', () => {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM historical_sources').get().cnt;
      expect(count).toBe(5);
    });

    it('wikiquote provider exists', () => {
      const row = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get('wikiquote');
      expect(row).toBeDefined();
      expect(row.name).toBe('Wikiquote');
    });

    it('chronicling_america provider exists', () => {
      const row = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get('chronicling_america');
      expect(row).toBeDefined();
      expect(row.name).toBe('Chronicling America');
    });

    it('wayback provider exists', () => {
      const row = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get('wayback');
      expect(row).toBeDefined();
      expect(row.name).toBe('Wayback Machine');
    });

    it('govinfo provider exists', () => {
      const row = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get('govinfo');
      expect(row).toBeDefined();
      expect(row.name).toBe('Congressional Record');
    });

    it('presidency_project provider exists', () => {
      const row = db.prepare('SELECT * FROM historical_sources WHERE provider_key = ?').get('presidency_project');
      expect(row).toBeDefined();
      expect(row.name).toBe('American Presidency Project');
    });

    it('INSERT OR IGNORE does not duplicate on re-run', () => {
      const insertProvider = db.prepare(
        'INSERT OR IGNORE INTO historical_sources (provider_key, name, description) VALUES (?, ?, ?)'
      );
      insertProvider.run('wikiquote', 'Wikiquote', 'Quotes from Wikiquote via MediaWiki API');
      const count = db.prepare("SELECT COUNT(*) as cnt FROM historical_sources WHERE provider_key = 'wikiquote'").get().cnt;
      expect(count).toBe(1);
    });
  });

  // === articles table new columns ===

  describe('articles.historical_source_id column', () => {
    beforeAll(() => {
      const cols = db.prepare('PRAGMA table_info(articles)').all().map(c => c.name);
      if (!cols.includes('historical_source_id')) {
        db.exec(`ALTER TABLE articles ADD COLUMN historical_source_id INTEGER REFERENCES historical_sources(id)`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_historical ON articles(historical_source_id)`);
    });

    it('column exists and is nullable', () => {
      const cols = db.prepare('PRAGMA table_info(articles)').all();
      const col = cols.find(c => c.name === 'historical_source_id');
      expect(col).toBeDefined();
      expect(col.notnull).toBe(0);
    });

    it('NULL for RSS-sourced articles', () => {
      db.prepare('INSERT INTO articles (url, title) VALUES (?, ?)').run('https://example.com/rss-article', 'RSS Article');
      const row = db.prepare('SELECT historical_source_id FROM articles WHERE url = ?').get('https://example.com/rss-article');
      expect(row.historical_source_id).toBeNull();
    });

    it('can reference historical_sources', () => {
      const hsId = db.prepare('SELECT id FROM historical_sources WHERE provider_key = ?').get('wikiquote').id;
      db.prepare('INSERT INTO articles (url, title, historical_source_id) VALUES (?, ?, ?)').run(
        'https://en.wikiquote.org/wiki/TestPerson', 'Wikiquote: TestPerson', hsId
      );
      const row = db.prepare('SELECT historical_source_id FROM articles WHERE url = ?').get('https://en.wikiquote.org/wiki/TestPerson');
      expect(row.historical_source_id).toBe(hsId);
    });

    it('index exists', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
      expect(indexes).toContain('idx_articles_historical');
    });
  });

  describe('articles.prefetched_text column', () => {
    beforeAll(() => {
      const cols = db.prepare('PRAGMA table_info(articles)').all().map(c => c.name);
      if (!cols.includes('prefetched_text')) {
        db.exec(`ALTER TABLE articles ADD COLUMN prefetched_text TEXT`);
      }
    });

    it('column exists and is nullable', () => {
      const cols = db.prepare('PRAGMA table_info(articles)').all();
      const col = cols.find(c => c.name === 'prefetched_text');
      expect(col).toBeDefined();
      expect(col.notnull).toBe(0);
    });

    it('NULL for RSS articles', () => {
      const row = db.prepare('SELECT prefetched_text FROM articles WHERE url = ?').get('https://example.com/rss-article');
      expect(row.prefetched_text).toBeNull();
    });

    it('can store prefetched text for historical articles', () => {
      db.prepare('UPDATE articles SET prefetched_text = ? WHERE url = ?').run(
        'The following are quotes attributed to TestPerson...',
        'https://en.wikiquote.org/wiki/TestPerson'
      );
      const row = db.prepare('SELECT prefetched_text FROM articles WHERE url = ?').get('https://en.wikiquote.org/wiki/TestPerson');
      expect(row.prefetched_text).toBe('The following are quotes attributed to TestPerson...');
    });
  });

  // === Settings ===

  describe('historical settings', () => {
    beforeAll(() => {
      const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
      insertSetting.run('historical_fetch_enabled', '1');
      insertSetting.run('historical_articles_per_source_per_cycle', '5');
    });

    it('historical_fetch_enabled setting exists with default 1', () => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('historical_fetch_enabled');
      expect(row).toBeDefined();
      expect(row.value).toBe('1');
    });

    it('historical_articles_per_source_per_cycle setting exists with default 5', () => {
      const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('historical_articles_per_source_per_cycle');
      expect(row).toBeDefined();
      expect(row.value).toBe('5');
    });
  });
});
