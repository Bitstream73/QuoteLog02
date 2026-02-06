import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set test environment before importing
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(__dirname, '../backup-test.db');

// Must import after setting env vars
const { createBackup, listBackups, pruneOldBackups, exportDatabaseJson, importDatabaseJson } = await import('../../src/services/backup.js');
const { getDb, closeDb, verifyDatabaseState, seedSources } = await import('../../src/config/database.js');

describe('Backup Service', () => {
  const backupDir = path.join(__dirname, '../backups');

  beforeAll(() => {
    // Initialize database
    getDb();
  });

  afterAll(() => {
    closeDb();
    // Clean up test files
    const dbPath = process.env.DATABASE_PATH;
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    // Clean up backup directory
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir)) {
        fs.unlinkSync(path.join(backupDir, f));
      }
      fs.rmdirSync(backupDir);
    }
  });

  beforeEach(() => {
    // Clean up any existing backup files
    if (fs.existsSync(backupDir)) {
      for (const f of fs.readdirSync(backupDir)) {
        fs.unlinkSync(path.join(backupDir, f));
      }
    }
  });

  describe('createBackup', () => {
    it('should create a backup file', async () => {
      const result = await createBackup();
      expect(result.path).toContain('backup-');
      expect(result.path).toContain('.sqlite');
      expect(result.size).toBeGreaterThan(0);
      expect(fs.existsSync(result.path)).toBe(true);
    });
  });

  describe('listBackups', () => {
    it('should list backup files sorted by date (newest first)', async () => {
      await createBackup();
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 50));
      await createBackup();

      const backups = listBackups();
      expect(backups.length).toBeGreaterThanOrEqual(2);
      expect(backups[0].filename).toContain('backup-');

      // Verify newest first
      if (backups.length >= 2) {
        expect(backups[0].created >= backups[1].created).toBe(true);
      }
    });

    it('should return empty array when no backups exist', () => {
      const backups = listBackups();
      expect(backups).toEqual([]);
    });
  });

  describe('pruneOldBackups', () => {
    it('should keep only the specified number of backups', async () => {
      for (let i = 0; i < 4; i++) {
        await createBackup();
        await new Promise(r => setTimeout(r, 50));
      }

      const deleted = pruneOldBackups(2);
      expect(deleted).toBe(2);

      const remaining = listBackups();
      expect(remaining.length).toBe(2);
    });

    it('should not delete anything if under the limit', async () => {
      await createBackup();
      const deleted = pruneOldBackups(5);
      expect(deleted).toBe(0);
    });
  });

  describe('exportDatabaseJson / importDatabaseJson', () => {
    it('should export and import database roundtrip', () => {
      const db = getDb();

      // Insert test data
      db.prepare('INSERT OR IGNORE INTO sources (domain, name, rss_url, enabled) VALUES (?, ?, ?, 1)')
        .run('test-export.com', 'Test Export', 'https://test-export.com/rss');

      // Export
      const exported = exportDatabaseJson();
      expect(exported.version).toBe('1.0');
      expect(exported.tables).toBeDefined();
      expect(exported.tables.sources.length).toBeGreaterThan(0);
      expect(exported.tables.settings.length).toBeGreaterThan(0);

      const sourceCount = exported.tables.sources.length;

      // Clear and re-import
      const result = importDatabaseJson(exported);
      expect(result.imported.sources).toBe(sourceCount);
      expect(result.imported.settings).toBeGreaterThan(0);

      // Verify data survived roundtrip
      const sources = db.prepare('SELECT * FROM sources').all();
      expect(sources.length).toBe(sourceCount);
    });

    it('should reject invalid import data', () => {
      expect(() => importDatabaseJson(null)).toThrow('Invalid import data');
      expect(() => importDatabaseJson({})).toThrow('Invalid import data');
      expect(() => importDatabaseJson({ tables: null })).toThrow('Invalid import data');
    });
  });
});

describe('Database Startup Verification', () => {
  beforeAll(() => {
    getDb();
  });

  afterAll(() => {
    closeDb();
    const dbPath = process.env.DATABASE_PATH;
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
  });

  it('verifyDatabaseState should return row counts', () => {
    const counts = verifyDatabaseState();
    expect(counts).toHaveProperty('sources');
    expect(counts).toHaveProperty('persons');
    expect(counts).toHaveProperty('quotes');
    expect(counts).toHaveProperty('articles');
    expect(typeof counts.sources).toBe('number');
  });

  it('seedSources should seed from sources-seed.json', () => {
    const db = getDb();
    // Clear sources to test seeding
    db.exec('DELETE FROM sources');

    const seeded = seedSources();
    expect(seeded).toBeGreaterThan(0);

    const sources = db.prepare('SELECT * FROM sources').all();
    expect(sources.length).toBe(seeded);
  });
});
