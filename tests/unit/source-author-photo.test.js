import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/source-author-photo-test.db';

describe('Source Author Photo Service', () => {
  let db;
  let sourceAuthorId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();

    db.prepare('INSERT OR IGNORE INTO source_authors (name, domain) VALUES (?, ?)').run('CNN', 'cnn.com');
    sourceAuthorId = db.prepare("SELECT id FROM source_authors WHERE domain = 'cnn.com'").get().id;
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/source-author-photo-test.db${suffix}`); } catch {}
    }
  });

  describe('fetchOrganizationImageUrl', () => {
    it('returns a string URL or null', async () => {
      const { fetchOrganizationImageUrl } = await import('../../src/services/sourceAuthorPhoto.js');
      // This makes a real Wikipedia API call — result may be URL or null
      const result = await fetchOrganizationImageUrl('CNN');
      expect(result === null || typeof result === 'string').toBe(true);
    }, 10000);

    it('returns null for nonsense name', async () => {
      const { fetchOrganizationImageUrl } = await import('../../src/services/sourceAuthorPhoto.js');
      const result = await fetchOrganizationImageUrl('xyznonexistent12345abcdef');
      expect(result).toBeNull();
    }, 10000);
  });

  describe('fetchAndStoreSourceAuthorImage', () => {
    it('skips if image already exists', async () => {
      const { fetchAndStoreSourceAuthorImage } = await import('../../src/services/sourceAuthorPhoto.js');
      db.prepare('UPDATE source_authors SET image_url = ? WHERE id = ?').run('https://existing.com/img.jpg', sourceAuthorId);

      const result = await fetchAndStoreSourceAuthorImage(sourceAuthorId, 'CNN');
      expect(result).toBe('https://existing.com/img.jpg');

      // Reset
      db.prepare('UPDATE source_authors SET image_url = NULL WHERE id = ?').run(sourceAuthorId);
    });
  });

  describe('backfillSourceAuthorImages', () => {
    it('returns processed and found counts', async () => {
      const { backfillSourceAuthorImages } = await import('../../src/services/sourceAuthorPhoto.js');
      // Limit to 0 to avoid network calls
      const result = await backfillSourceAuthorImages(0);
      expect(result).toHaveProperty('processed');
      expect(result).toHaveProperty('found');
      expect(result.processed).toBe(0);
      expect(result.found).toBe(0);
    });
  });
});
