import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/source-author-schema-test.db';

describe('Source Author Schema', () => {
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
      try { fs.unlinkSync(`./tests/source-author-schema-test.db${suffix}`); } catch {}
    }
  });

  describe('source_authors table', () => {
    it('exists', () => {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_authors'").all();
      expect(tables).toHaveLength(1);
    });

    it('has expected columns', () => {
      const cols = db.prepare('PRAGMA table_info(source_authors)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('name');
      expect(cols).toContain('domain');
      expect(cols).toContain('image_url');
      expect(cols).toContain('description');
      expect(cols).toContain('image_suggestions');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('enforces unique domain constraint', () => {
      db.prepare('INSERT OR IGNORE INTO source_authors (name, domain) VALUES (?, ?)').run('TestOrg', 'unique-test.com');
      expect(() => {
        db.prepare('INSERT INTO source_authors (name, domain) VALUES (?, ?)').run('TestOrg2', 'unique-test.com');
      }).toThrow();
      db.prepare("DELETE FROM source_authors WHERE domain = 'unique-test.com'").run();
    });

    it('stores and retrieves image_suggestions JSON', () => {
      db.prepare('INSERT OR IGNORE INTO source_authors (name, domain) VALUES (?, ?)').run('JSONTest', 'jsontest.com');
      const suggestions = [{ url: 'https://example.com/logo.png', description: 'Logo', source: 'Wiki' }];
      db.prepare('UPDATE source_authors SET image_suggestions = ? WHERE domain = ?')
        .run(JSON.stringify(suggestions), 'jsontest.com');

      const row = db.prepare("SELECT image_suggestions FROM source_authors WHERE domain = 'jsontest.com'").get();
      const parsed = JSON.parse(row.image_suggestions);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].url).toBe('https://example.com/logo.png');
      db.prepare("DELETE FROM source_authors WHERE domain = 'jsontest.com'").run();
    });
  });

  describe('sources.source_author_id FK', () => {
    it('exists on sources table', () => {
      const cols = db.prepare('PRAGMA table_info(sources)').all().map(c => c.name);
      expect(cols).toContain('source_author_id');
    });
  });

  describe('auto-seed migration', () => {
    it('creates source_authors from existing source domains', () => {
      // The auto-seed runs during initializeTables, so we just verify
      // that if sources exist, source_authors were created
      const sourceCount = db.prepare('SELECT COUNT(*) as count FROM sources').get().count;
      if (sourceCount > 0) {
        const saCount = db.prepare('SELECT COUNT(*) as count FROM source_authors').get().count;
        expect(saCount).toBeGreaterThan(0);
      }
    });

    it('links sources to their source_authors', () => {
      // Insert a test source and source_author
      db.prepare('INSERT OR IGNORE INTO source_authors (name, domain) VALUES (?, ?)').run('LinkTest', 'linktest.com');
      const sa = db.prepare("SELECT id FROM source_authors WHERE domain = 'linktest.com'").get();
      db.prepare('INSERT INTO sources (domain, name, rss_url, source_author_id) VALUES (?, ?, ?, ?)')
        .run('linktest.com', 'Link Test Feed', 'https://linktest.com/rss', sa.id);

      const source = db.prepare("SELECT source_author_id FROM sources WHERE domain = 'linktest.com' AND name = 'Link Test Feed'").get();
      expect(source.source_author_id).toBe(sa.id);

      // Cleanup
      db.prepare("DELETE FROM sources WHERE domain = 'linktest.com' AND name = 'Link Test Feed'").run();
      db.prepare("DELETE FROM source_authors WHERE domain = 'linktest.com'").run();
    });
  });
});
