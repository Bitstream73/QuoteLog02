import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';
import fs from 'fs';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/backup-admin-test.db';

describe('Admin Backup/Restore Routes', () => {
  let app;
  let authCookie;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    try { fs.unlinkSync('./tests/backup-admin-test.db'); } catch {}
    try { fs.unlinkSync('./tests/backup-admin-test.db-wal'); } catch {}
    try { fs.unlinkSync('./tests/backup-admin-test.db-shm'); } catch {}
    // Clean up shared data dir backups
    try {
      const backupDir = './data/backups';
      if (fs.existsSync(backupDir)) {
        for (const f of fs.readdirSync(backupDir)) fs.unlinkSync(`${backupDir}/${f}`);
        fs.rmdirSync(backupDir);
      }
    } catch {}
  });

  describe('Without auth', () => {
    it('GET /api/admin/backup returns 401', async () => {
      const res = await request(app).get('/api/admin/backup');
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/backup returns 401', async () => {
      const res = await request(app).post('/api/admin/backup');
      expect(res.status).toBe(401);
    });

    it('POST /api/admin/restore returns 401', async () => {
      const res = await request(app).post('/api/admin/restore').send({});
      expect(res.status).toBe(401);
    });

    it('GET /api/admin/backups returns 401', async () => {
      const res = await request(app).get('/api/admin/backups');
      expect(res.status).toBe(401);
    });
  });

  describe('With auth', () => {
    it('GET /api/admin/backup returns JSON export', async () => {
      const res = await request(app)
        .get('/api/admin/backup')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.version).toBe('1.0');
      expect(res.body.tables).toBeDefined();
      expect(res.body.tables.sources).toBeInstanceOf(Array);
      expect(res.body.tables.settings).toBeInstanceOf(Array);
    });

    it('POST /api/admin/backup creates disk backup', async () => {
      const res = await request(app)
        .post('/api/admin/backup')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Backup created');
      expect(res.body.size).toBeGreaterThan(0);
    });

    it('GET /api/admin/backups lists disk backups', async () => {
      const res = await request(app)
        .get('/api/admin/backups')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.backups).toBeInstanceOf(Array);
    });

    it('POST /api/admin/restore rejects invalid data', async () => {
      const res = await request(app)
        .post('/api/admin/restore')
        .set('Cookie', authCookie)
        .send({ invalid: true });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/restore accepts valid export', async () => {
      // First get an export
      const exportRes = await request(app)
        .get('/api/admin/backup')
        .set('Cookie', authCookie);

      // Then restore from it
      const res = await request(app)
        .post('/api/admin/restore')
        .set('Cookie', authCookie)
        .send(exportRes.body);
      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Restore complete');
      expect(res.body.imported).toBeDefined();
    });
  });
});
