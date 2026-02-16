import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/historical-sources-test.db';

describe('Historical Sources API', () => {
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
      fs.unlinkSync('./tests/historical-sources-test.db');
      fs.unlinkSync('./tests/historical-sources-test.db-wal');
      fs.unlinkSync('./tests/historical-sources-test.db-shm');
    } catch {}
  });

  describe('GET /api/historical-sources', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/historical-sources');
      expect(res.status).toBe(401);
    });

    it('returns all 5 providers with auth', async () => {
      const res = await request(app)
        .get('/api/historical-sources')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(res.body.sources).toBeDefined();
      expect(res.body.sources.length).toBe(5);

      const keys = res.body.sources.map(s => s.provider_key);
      expect(keys).toContain('wikiquote');
      expect(keys).toContain('chronicling_america');
      expect(keys).toContain('wayback');
      expect(keys).toContain('govinfo');
      expect(keys).toContain('presidency_project');
    });

    it('returns enabled as boolean', async () => {
      const res = await request(app)
        .get('/api/historical-sources')
        .set('Cookie', authCookie);
      const source = res.body.sources[0];
      expect(typeof source.enabled).toBe('boolean');
    });
  });

  describe('PATCH /api/historical-sources/:key', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .patch('/api/historical-sources/wikiquote')
        .send({ enabled: false });
      expect(res.status).toBe(401);
    });

    it('disables a provider', async () => {
      const res = await request(app)
        .patch('/api/historical-sources/wikiquote')
        .set('Cookie', authCookie)
        .send({ enabled: false });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(false);
      expect(res.body.status).toBe('disabled');
    });

    it('enables a provider', async () => {
      const res = await request(app)
        .patch('/api/historical-sources/wikiquote')
        .set('Cookie', authCookie)
        .send({ enabled: true });
      expect(res.status).toBe(200);
      expect(res.body.enabled).toBe(true);
      expect(res.body.status).toBe('unknown');
    });

    it('returns 404 for invalid key', async () => {
      const res = await request(app)
        .patch('/api/historical-sources/nonexistent')
        .set('Cookie', authCookie)
        .send({ enabled: false });
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/historical-sources/:key/test', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/historical-sources/wikiquote/test');
      expect(res.status).toBe(401);
    });

    it('returns 404 for invalid key in DB', async () => {
      const res = await request(app)
        .post('/api/historical-sources/nonexistent/test')
        .set('Cookie', authCookie);
      expect(res.status).toBe(404);
    });

    // Note: testing actual provider connection would require mocking fetch
    // which is complex in integration tests. The unit tests cover this.
  });

  describe('GET /api/historical-sources/stats', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/historical-sources/stats');
      expect(res.status).toBe(401);
    });

    it('returns stats with auth', async () => {
      const res = await request(app)
        .get('/api/historical-sources/stats')
        .set('Cookie', authCookie);
      expect(res.status).toBe(200);
      expect(typeof res.body.total_historical_articles).toBe('number');
      expect(typeof res.body.total_historical_quotes).toBe('number');
      expect(Array.isArray(res.body.providers)).toBe(true);
      expect(res.body.providers.length).toBe(5);
    });
  });
});
