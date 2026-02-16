import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Schema Migrations — Phase 1 (Site Topic Focus)', () => {
  let db;
  const testDbPath = path.join(__dirname, '../schema-migrations-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create prerequisite tables that already exist in production
    db.exec(`
      CREATE TABLE persons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_name TEXT NOT NULL,
        quote_count INTEGER NOT NULL DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      )
    `);

    db.exec(`
      CREATE TABLE quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL REFERENCES persons(id),
        text TEXT NOT NULL,
        quote_type TEXT NOT NULL DEFAULT 'direct',
        context TEXT,
        is_visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Seed test data
    db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Test Person');
    db.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Test quote');
    db.prepare('INSERT INTO articles (url, title) VALUES (?, ?)').run('https://example.com/a1', 'Test Article');
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  // === importants table ===

  describe('importants table', () => {
    beforeAll(() => {
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
    });

    it('table exists', () => {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='importants'").get();
      expect(table).toBeDefined();
      expect(table.name).toBe('importants');
    });

    it('has correct columns', () => {
      const cols = db.prepare('PRAGMA table_info(importants)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('entity_type');
      expect(cols).toContain('entity_id');
      expect(cols).toContain('voter_hash');
      expect(cols).toContain('created_at');
    });

    it('can insert and retrieve an important mark', () => {
      db.prepare('INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)').run('quote', 1, 'hash_user1');
      const row = db.prepare('SELECT * FROM importants WHERE entity_type = ? AND entity_id = ?').get('quote', 1);
      expect(row.voter_hash).toBe('hash_user1');
      expect(row.created_at).toBeDefined();
    });

    it('UNIQUE constraint prevents duplicate important marks', () => {
      expect(() => {
        db.prepare('INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)').run('quote', 1, 'hash_user1');
      }).toThrow();
    });

    it('same voter can mark different entity types', () => {
      db.prepare('INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)').run('article', 1, 'hash_user1');
      db.prepare('INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)').run('person', 1, 'hash_user1');

      const count = db.prepare('SELECT COUNT(*) as count FROM importants WHERE voter_hash = ?').get('hash_user1');
      expect(count.count).toBe(3); // quote + article + person
    });

    it('CHECK constraint rejects invalid entity_type', () => {
      expect(() => {
        db.prepare('INSERT INTO importants (entity_type, entity_id, voter_hash) VALUES (?, ?, ?)').run('invalid', 1, 'hash_check');
      }).toThrow();
    });

    it('indexes exist for entity and voter lookups', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
      expect(indexes).toContain('idx_importants_entity');
      expect(indexes).toContain('idx_importants_voter');
    });
  });

  // === New columns on existing tables ===

  describe('quotes table new columns', () => {
    beforeAll(() => {
      const cols = db.prepare('PRAGMA table_info(quotes)').all().map(c => c.name);
      if (!cols.includes('quote_datetime')) {
        db.exec(`ALTER TABLE quotes ADD COLUMN quote_datetime TEXT`);
      }
      if (!cols.includes('importants_count')) {
        db.exec(`ALTER TABLE quotes ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('share_count')) {
        db.exec(`ALTER TABLE quotes ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('trending_score')) {
        db.exec(`ALTER TABLE quotes ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0`);
      }
    });

    it('has quote_datetime column (nullable TEXT)', () => {
      const cols = db.prepare('PRAGMA table_info(quotes)').all();
      const col = cols.find(c => c.name === 'quote_datetime');
      expect(col).toBeDefined();
      expect(col.type).toBe('TEXT');
      expect(col.notnull).toBe(0); // nullable
    });

    it('has importants_count column (INTEGER DEFAULT 0)', () => {
      const cols = db.prepare('PRAGMA table_info(quotes)').all();
      const col = cols.find(c => c.name === 'importants_count');
      expect(col).toBeDefined();
      expect(col.dflt_value).toBe('0');
    });

    it('has share_count column (INTEGER DEFAULT 0)', () => {
      const cols = db.prepare('PRAGMA table_info(quotes)').all();
      const col = cols.find(c => c.name === 'share_count');
      expect(col).toBeDefined();
      expect(col.dflt_value).toBe('0');
    });

    it('has trending_score column (REAL DEFAULT 0.0)', () => {
      const cols = db.prepare('PRAGMA table_info(quotes)').all();
      const col = cols.find(c => c.name === 'trending_score');
      expect(col).toBeDefined();
      expect(col.type).toBe('REAL');
    });

    it('defaults are applied correctly for new row', () => {
      db.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'New quote with defaults');
      const q = db.prepare('SELECT importants_count, share_count, trending_score, quote_datetime FROM quotes WHERE text = ?').get('New quote with defaults');
      expect(q.importants_count).toBe(0);
      expect(q.share_count).toBe(0);
      expect(q.trending_score).toBe(0.0);
      expect(q.quote_datetime).toBeNull();
    });
  });

  describe('articles table new columns', () => {
    beforeAll(() => {
      const cols = db.prepare('PRAGMA table_info(articles)').all().map(c => c.name);
      if (!cols.includes('importants_count')) {
        db.exec(`ALTER TABLE articles ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('share_count')) {
        db.exec(`ALTER TABLE articles ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('view_count')) {
        db.exec(`ALTER TABLE articles ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('trending_score')) {
        db.exec(`ALTER TABLE articles ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0`);
      }
    });

    it('has importants_count, share_count, view_count, trending_score columns', () => {
      const cols = db.prepare('PRAGMA table_info(articles)').all().map(c => c.name);
      expect(cols).toContain('importants_count');
      expect(cols).toContain('share_count');
      expect(cols).toContain('view_count');
      expect(cols).toContain('trending_score');
    });

    it('defaults are applied for new article row', () => {
      db.prepare('INSERT INTO articles (url, title) VALUES (?, ?)').run('https://example.com/a2', 'Article 2');
      const a = db.prepare('SELECT importants_count, share_count, view_count, trending_score FROM articles WHERE url = ?').get('https://example.com/a2');
      expect(a.importants_count).toBe(0);
      expect(a.share_count).toBe(0);
      expect(a.view_count).toBe(0);
      expect(a.trending_score).toBe(0.0);
    });
  });

  describe('persons table new columns', () => {
    beforeAll(() => {
      const cols = db.prepare('PRAGMA table_info(persons)').all().map(c => c.name);
      if (!cols.includes('importants_count')) {
        db.exec(`ALTER TABLE persons ADD COLUMN importants_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('share_count')) {
        db.exec(`ALTER TABLE persons ADD COLUMN share_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('view_count')) {
        db.exec(`ALTER TABLE persons ADD COLUMN view_count INTEGER NOT NULL DEFAULT 0`);
      }
      if (!cols.includes('trending_score')) {
        db.exec(`ALTER TABLE persons ADD COLUMN trending_score REAL NOT NULL DEFAULT 0.0`);
      }
    });

    it('has importants_count, share_count, view_count, trending_score columns', () => {
      const cols = db.prepare('PRAGMA table_info(persons)').all().map(c => c.name);
      expect(cols).toContain('importants_count');
      expect(cols).toContain('share_count');
      expect(cols).toContain('view_count');
      expect(cols).toContain('trending_score');
    });

    it('defaults are applied for new person row', () => {
      db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('New Person');
      const p = db.prepare('SELECT importants_count, share_count, view_count, trending_score FROM persons WHERE canonical_name = ?').get('New Person');
      expect(p.importants_count).toBe(0);
      expect(p.share_count).toBe(0);
      expect(p.view_count).toBe(0);
      expect(p.trending_score).toBe(0.0);
    });
  });

  // === Indexes ===

  describe('new indexes', () => {
    beforeAll(() => {
      db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_trending ON quotes(trending_score DESC) WHERE is_visible = 1`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_articles_trending ON articles(trending_score DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_persons_trending ON persons(trending_score DESC)`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_importants ON quotes(importants_count DESC) WHERE is_visible = 1`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_quotes_datetime ON quotes(quote_datetime DESC) WHERE is_visible = 1`);
    });

    it('trending indexes exist for all entity tables', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
      expect(indexes).toContain('idx_quotes_trending');
      expect(indexes).toContain('idx_articles_trending');
      expect(indexes).toContain('idx_persons_trending');
    });

    it('importants and datetime indexes exist for quotes', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
      expect(indexes).toContain('idx_quotes_importants');
      expect(indexes).toContain('idx_quotes_datetime');
    });
  });

  // === Phase 2: gemini_prompts table ===

  describe('gemini_prompts table', () => {
    beforeAll(() => {
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
    });

    it('table exists with correct columns', () => {
      const cols = db.prepare('PRAGMA table_info(gemini_prompts)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('prompt_key');
      expect(cols).toContain('name');
      expect(cols).toContain('description');
      expect(cols).toContain('template');
      expect(cols).toContain('category');
      expect(cols).toContain('is_active');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('prompt_key is UNIQUE', () => {
      db.prepare("INSERT INTO gemini_prompts (prompt_key, name, template) VALUES (?, ?, ?)").run('test_key', 'Test', 'template');
      expect(() => {
        db.prepare("INSERT INTO gemini_prompts (prompt_key, name, template) VALUES (?, ?, ?)").run('test_key', 'Dup', 'dup');
      }).toThrow();
    });

    it('is_active defaults to 1', () => {
      db.prepare("INSERT INTO gemini_prompts (prompt_key, name, template) VALUES (?, ?, ?)").run('active_default', 'Active', 'tmpl');
      const row = db.prepare('SELECT is_active FROM gemini_prompts WHERE prompt_key = ?').get('active_default');
      expect(row.is_active).toBe(1);
    });

    it('timestamps are auto-set', () => {
      const row = db.prepare('SELECT created_at, updated_at FROM gemini_prompts WHERE prompt_key = ?').get('test_key');
      expect(row.created_at).toBeDefined();
      expect(row.updated_at).toBeDefined();
    });
  });

  // === Phase 2: noteworthy_items table ===

  describe('noteworthy_items table', () => {
    beforeAll(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS noteworthy_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          entity_type TEXT NOT NULL CHECK(entity_type IN ('quote', 'article', 'topic')),
          entity_id INTEGER NOT NULL,
          display_order INTEGER NOT NULL DEFAULT 0,
          active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(entity_type, entity_id)
        )
      `);
    });

    it('table exists with correct columns', () => {
      const cols = db.prepare('PRAGMA table_info(noteworthy_items)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('entity_type');
      expect(cols).toContain('entity_id');
      expect(cols).toContain('display_order');
      expect(cols).toContain('active');
      expect(cols).toContain('created_at');
    });

    it('UNIQUE constraint on (entity_type, entity_id)', () => {
      db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('quote', 1, 1)").run();
      expect(() => {
        db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id, display_order) VALUES ('quote', 1, 2)").run();
      }).toThrow();
    });

    it('CHECK constraint on entity_type', () => {
      expect(() => {
        db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id) VALUES ('invalid', 1)").run();
      }).toThrow();
    });

    it('defaults: display_order=0, active=1', () => {
      db.prepare("INSERT INTO noteworthy_items (entity_type, entity_id) VALUES ('article', 1)").run();
      const row = db.prepare("SELECT display_order, active FROM noteworthy_items WHERE entity_type = 'article' AND entity_id = 1").get();
      expect(row.display_order).toBe(0);
      expect(row.active).toBe(1);
    });
  });

  // === Phase 2: backprop_log table ===

  describe('backprop_log table', () => {
    beforeAll(() => {
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
    });

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
    });

    it('target_date is UNIQUE', () => {
      db.prepare("INSERT INTO backprop_log (target_date) VALUES (?)").run('2025-06-01');
      expect(() => {
        db.prepare("INSERT INTO backprop_log (target_date) VALUES (?)").run('2025-06-01');
      }).toThrow();
    });

    it('CHECK constraint on status', () => {
      expect(() => {
        db.prepare("INSERT INTO backprop_log (target_date, status) VALUES (?, 'badstatus')").run('2025-06-02');
      }).toThrow();
    });

    it('defaults: status=pending, articles_found=0, quotes_extracted=0', () => {
      db.prepare("INSERT INTO backprop_log (target_date) VALUES (?)").run('2025-06-03');
      const row = db.prepare('SELECT status, articles_found, quotes_extracted FROM backprop_log WHERE target_date = ?').get('2025-06-03');
      expect(row.status).toBe('pending');
      expect(row.articles_found).toBe(0);
      expect(row.quotes_extracted).toBe(0);
    });
  });

  // === Phase 2: idx_qa_article index ===

  describe('quote_articles index', () => {
    beforeAll(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS quote_articles (
          quote_id INTEGER NOT NULL,
          article_id INTEGER NOT NULL,
          PRIMARY KEY (quote_id, article_id)
        )
      `);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_qa_article ON quote_articles(article_id)`);
    });

    it('idx_qa_article index exists', () => {
      const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);
      expect(indexes).toContain('idx_qa_article');
    });

    it('index is on article_id column', () => {
      const info = db.prepare('PRAGMA index_info(idx_qa_article)').all();
      expect(info.length).toBe(1);
      expect(info[0].name).toBe('article_id');
    });
  });
});
