import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/noteworthy-card-configs-schema-test.db';

describe('Noteworthy Card Configs Schema', () => {
  let db;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/noteworthy-card-configs-schema-test.db${suffix}`); } catch {}
    }
  });

  describe('noteworthy_collections table', () => {
    it('exists', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='noteworthy_collections'").all();
      expect(tables).toHaveLength(1);
    });

    it('has expected columns', () => {
      const cols = db.prepare('PRAGMA table_info(noteworthy_collections)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('name');
      expect(cols).toContain('display_order');
      expect(cols).toContain('enabled');
      expect(cols).toContain('created_at');
    });

    it('supports CRUD operations', () => {
      const result = db.prepare('INSERT INTO noteworthy_collections (name, display_order) VALUES (?, ?)').run('Test Collection', 1);
      expect(result.changes).toBe(1);
      const id = result.lastInsertRowid;

      const row = db.prepare('SELECT * FROM noteworthy_collections WHERE id = ?').get(id);
      expect(row.name).toBe('Test Collection');
      expect(row.display_order).toBe(1);
      expect(row.enabled).toBe(1); // default

      db.prepare('UPDATE noteworthy_collections SET name = ? WHERE id = ?').run('Updated Collection', id);
      const updated = db.prepare('SELECT name FROM noteworthy_collections WHERE id = ?').get(id);
      expect(updated.name).toBe('Updated Collection');

      db.prepare('DELETE FROM noteworthy_collections WHERE id = ?').run(id);
      const deleted = db.prepare('SELECT * FROM noteworthy_collections WHERE id = ?').get(id);
      expect(deleted).toBeUndefined();
    });
  });

  describe('noteworthy_card_configs table', () => {
    it('exists', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='noteworthy_card_configs'").all();
      expect(tables).toHaveLength(1);
    });

    it('has expected columns', () => {
      const cols = db.prepare('PRAGMA table_info(noteworthy_card_configs)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('card_type');
      expect(cols).toContain('enabled');
      expect(cols).toContain('display_order');
      expect(cols).toContain('custom_title');
      expect(cols).toContain('config');
      expect(cols).toContain('collection_id');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('enforces unique card_type constraint', () => {
      expect(() => {
        db.prepare('INSERT INTO noteworthy_card_configs (card_type, display_order) VALUES (?, ?)').run('quote_of_hour', 99);
      }).toThrow();
    });

    it('supports CRUD operations', () => {
      // Use a unique card_type for testing (not one of the 28 seeds)
      db.prepare('INSERT OR IGNORE INTO noteworthy_card_configs (card_type, display_order, custom_title) VALUES (?, ?, ?)').run('test_card_crud', 99, 'CRUD Test');
      const row = db.prepare("SELECT * FROM noteworthy_card_configs WHERE card_type = 'test_card_crud'").get();
      expect(row).toBeDefined();
      expect(row.custom_title).toBe('CRUD Test');
      expect(row.enabled).toBe(0); // default disabled

      db.prepare("UPDATE noteworthy_card_configs SET enabled = 1 WHERE card_type = 'test_card_crud'").run();
      const updated = db.prepare("SELECT enabled FROM noteworthy_card_configs WHERE card_type = 'test_card_crud'").get();
      expect(updated.enabled).toBe(1);

      db.prepare("DELETE FROM noteworthy_card_configs WHERE card_type = 'test_card_crud'").run();
      const deleted = db.prepare("SELECT * FROM noteworthy_card_configs WHERE card_type = 'test_card_crud'").get();
      expect(deleted).toBeUndefined();
    });

    it('stores and returns valid JSON in config column', () => {
      const configJson = JSON.stringify({ filter_type: 'author', filter_value: '42' });
      db.prepare("UPDATE noteworthy_card_configs SET config = ? WHERE card_type = 'quote_of_hour'").run(configJson);
      const row = db.prepare("SELECT config FROM noteworthy_card_configs WHERE card_type = 'quote_of_hour'").get();
      const parsed = JSON.parse(row.config);
      expect(parsed.filter_type).toBe('author');
      expect(parsed.filter_value).toBe('42');
      // Reset
      db.prepare("UPDATE noteworthy_card_configs SET config = '{}' WHERE card_type = 'quote_of_hour'").run();
    });

    it('collection FK sets null on collection delete', () => {
      // Create a collection
      const colResult = db.prepare('INSERT INTO noteworthy_collections (name, display_order) VALUES (?, ?)').run('FK Test Collection', 1);
      const colId = colResult.lastInsertRowid;

      // Assign a card config to the collection
      db.prepare('UPDATE noteworthy_card_configs SET collection_id = ? WHERE card_type = ?').run(colId, 'quote_of_day');

      // Verify assignment
      const before = db.prepare("SELECT collection_id FROM noteworthy_card_configs WHERE card_type = 'quote_of_day'").get();
      expect(before.collection_id).toBe(Number(colId));

      // Delete the collection
      db.prepare('DELETE FROM noteworthy_collections WHERE id = ?').run(colId);

      // Verify FK set to null
      const after = db.prepare("SELECT collection_id FROM noteworthy_card_configs WHERE card_type = 'quote_of_day'").get();
      expect(after.collection_id).toBeNull();
    });
  });

  describe('default card config seeds', () => {
    it('has 28 default card configs', () => {
      const count = db.prepare('SELECT COUNT(*) as count FROM noteworthy_card_configs').get().count;
      expect(count).toBe(28);
    });

    it('all default configs are disabled', () => {
      const enabledCount = db.prepare('SELECT COUNT(*) as count FROM noteworthy_card_configs WHERE enabled = 1').get().count;
      expect(enabledCount).toBe(0);
    });

    it('has all 20 time-based card types', () => {
      const timeBased = ['quote', 'author', 'source', 'topic', 'category'];
      const periods = ['hour', 'day', 'week', 'month'];
      for (const entity of timeBased) {
        for (const period of periods) {
          const cardType = `${entity}_of_${period}`;
          const row = db.prepare('SELECT * FROM noteworthy_card_configs WHERE card_type = ?').get(cardType);
          expect(row, `Missing card type: ${cardType}`).toBeDefined();
        }
      }
    });

    it('has all 4 search card types', () => {
      const searchTypes = ['search_topic', 'search_quote_text', 'search_source_author', 'search_source'];
      for (const cardType of searchTypes) {
        const row = db.prepare('SELECT * FROM noteworthy_card_configs WHERE card_type = ?').get(cardType);
        expect(row, `Missing card type: ${cardType}`).toBeDefined();
      }
    });

    it('has all 4 info card types', () => {
      const infoTypes = ['info_importance', 'info_fact_check', 'info_bug', 'info_donate'];
      for (const cardType of infoTypes) {
        const row = db.prepare('SELECT * FROM noteworthy_card_configs WHERE card_type = ?').get(cardType);
        expect(row, `Missing card type: ${cardType}`).toBeDefined();
      }
    });

    it('each config has a custom_title', () => {
      const noTitle = db.prepare('SELECT COUNT(*) as count FROM noteworthy_card_configs WHERE custom_title IS NULL').get().count;
      expect(noTitle).toBe(0);
    });
  });

  describe('pepper settings keys', () => {
    it('has noteworthy_pepper_frequency setting with default 5', () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'noteworthy_pepper_frequency'").get();
      expect(row).toBeDefined();
      expect(row.value).toBe('5');
    });

    it('has noteworthy_pepper_chance setting with default 50', () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'noteworthy_pepper_chance'").get();
      expect(row).toBeDefined();
      expect(row.value).toBe('50');
    });

    it('has noteworthy_pick_mode setting with default sequential', () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'noteworthy_pick_mode'").get();
      expect(row).toBeDefined();
      expect(row.value).toBe('sequential');
    });

    it('has noteworthy_reuse_cards setting with default 1', () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'noteworthy_reuse_cards'").get();
      expect(row).toBeDefined();
      expect(row.value).toBe('1');
    });
  });

  describe('indexes', () => {
    it('has idx_ncc_enabled index', () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ncc_enabled'").get();
      expect(idx).toBeDefined();
    });

    it('has idx_ncc_collection index', () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_ncc_collection'").get();
      expect(idx).toBeDefined();
    });

    it('has idx_nc_enabled index', () => {
      const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_nc_enabled'").get();
      expect(idx).toBeDefined();
    });
  });
});
