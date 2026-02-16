import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/admin-routes-test.db';

describe('Admin Route Protection', () => {
  let app;
  let authCookie;

  beforeAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/admin-routes-test.db');
      fs.unlinkSync('./tests/admin-routes-test.db-wal');
      fs.unlinkSync('./tests/admin-routes-test.db-shm');
    } catch {}
  });

  describe('Protected admin routes (no auth)', () => {
    it('GET /api/settings returns 401', async () => {
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(401);
    });

    it('PUT /api/settings returns 401', async () => {
      const res = await request(app).put('/api/settings').send({ theme: 'dark' });
      expect(res.status).toBe(401);
    });

    it('PATCH /api/settings returns 401', async () => {
      const res = await request(app).patch('/api/settings').send({ theme: 'dark' });
      expect(res.status).toBe(401);
    });

    it('GET /api/review returns 401', async () => {
      const res = await request(app).get('/api/review');
      expect(res.status).toBe(401);
    });

    it('GET /api/review/stats returns 401', async () => {
      const res = await request(app).get('/api/review/stats');
      expect(res.status).toBe(401);
    });

    it('POST /api/review/1/merge returns 401', async () => {
      const res = await request(app).post('/api/review/1/merge');
      expect(res.status).toBe(401);
    });

    it('POST /api/review/1/reject returns 401', async () => {
      const res = await request(app).post('/api/review/1/reject');
      expect(res.status).toBe(401);
    });

    it('POST /api/review/1/skip returns 401', async () => {
      const res = await request(app).post('/api/review/1/skip');
      expect(res.status).toBe(401);
    });

    it('POST /api/review/batch returns 401', async () => {
      const res = await request(app).post('/api/review/batch').send({ action: 'merge', ids: [1] });
      expect(res.status).toBe(401);
    });

    it('GET /api/logs returns 401', async () => {
      const res = await request(app).get('/api/logs');
      expect(res.status).toBe(401);
    });

    it('GET /api/logs/stats returns 401', async () => {
      const res = await request(app).get('/api/logs/stats');
      expect(res.status).toBe(401);
    });

    it('GET /api/logs/export returns 401', async () => {
      const res = await request(app).get('/api/logs/export');
      expect(res.status).toBe(401);
    });

    it('DELETE /api/logs returns 401', async () => {
      const res = await request(app).delete('/api/logs');
      expect(res.status).toBe(401);
    });

    it('POST /api/sources returns 401', async () => {
      const res = await request(app).post('/api/sources').send({ domain: 'test.com' });
      expect(res.status).toBe(401);
    });

    it('PATCH /api/sources/1 returns 401', async () => {
      const res = await request(app).patch('/api/sources/1').send({ name: 'Test' });
      expect(res.status).toBe(401);
    });

    it('DELETE /api/sources/1 returns 401', async () => {
      const res = await request(app).delete('/api/sources/1');
      expect(res.status).toBe(401);
    });
  });

  describe('Protected admin routes (with auth)', () => {
    it('GET /api/settings returns 200', async () => {
      const res = await request(app)
        .get('/api/settings')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
    });

    it('GET /api/review returns 200', async () => {
      const res = await request(app)
        .get('/api/review')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
    });

    it('GET /api/review/stats returns 200', async () => {
      const res = await request(app)
        .get('/api/review/stats')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
    });

    it('GET /api/logs returns 200', async () => {
      const res = await request(app)
        .get('/api/logs')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
    });
  });

  describe('Public routes (no auth)', () => {
    it('GET /api/health returns 200', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
    });

    it('GET /api/quotes returns 200', async () => {
      const res = await request(app).get('/api/quotes');
      expect(res.status).toBe(200);
    });

    it('GET /api/authors returns 200', async () => {
      const res = await request(app).get('/api/authors');
      expect(res.status).toBe(200);
    });

    it('GET /api/sources returns 200', async () => {
      const res = await request(app).get('/api/sources');
      expect(res.status).toBe(200);
    });
  });
});
