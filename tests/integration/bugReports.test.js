import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { getAuthCookie } from '../helpers/auth.js';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/bug-reports-test.db';

describe('Bug Reports API', () => {
  let app;
  let authCookie;
  let createdReportId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    authCookie = getAuthCookie();
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/bug-reports-test.db${suffix}`); } catch {}
    }
  });

  describe('POST /api/bug-reports', () => {
    it('creates a bug report with valid data', async () => {
      const res = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'Something is broken', page_url: 'https://example.com/quote/1' })
        .set('User-Agent', 'TestAgent');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBeGreaterThan(0);
      createdReportId = res.body.id;
    });

    it('rejects empty message', async () => {
      const res = await request(app)
        .post('/api/bug-reports')
        .send({ message: '', page_url: 'https://example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Message is required/);
    });

    it('rejects message over 280 characters', async () => {
      const res = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'x'.repeat(281), page_url: 'https://example.com' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/280/);
    });

    it('rejects missing page_url', async () => {
      const res = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'Bug description' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Page URL/);
    });

    it('accepts report with quote_id', async () => {
      const res = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'Quote display bug', page_url: 'https://example.com/quote/42', quote_id: 42 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('GET /api/bug-reports', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).get('/api/bug-reports');
      expect(res.status).toBe(401);
    });

    it('returns reports for admin', async () => {
      const res = await request(app)
        .get('/api/bug-reports')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.reports)).toBe(true);
      expect(res.body.total).toBeGreaterThanOrEqual(2);
    });
  });

  describe('PATCH /api/bug-reports/:id/star', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).patch(`/api/bug-reports/${createdReportId}/star`);
      expect(res.status).toBe(401);
    });

    it('toggles star on a report', async () => {
      const res = await request(app)
        .patch(`/api/bug-reports/${createdReportId}/star`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.starred).toBe(1);

      // Toggle back
      const res2 = await request(app)
        .patch(`/api/bug-reports/${createdReportId}/star`)
        .set('Cookie', authCookie);

      expect(res2.body.starred).toBe(0);
    });

    it('returns 404 for non-existent report', async () => {
      const res = await request(app)
        .patch('/api/bug-reports/99999/star')
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/bug-reports/:id', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app).delete(`/api/bug-reports/${createdReportId}`);
      expect(res.status).toBe(401);
    });

    it('deletes a report', async () => {
      // Create a report to delete
      const createRes = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'To be deleted', page_url: 'https://example.com/test' });

      const id = createRes.body.id;

      const res = await request(app)
        .delete(`/api/bug-reports/${id}`)
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-existent report', async () => {
      const res = await request(app)
        .delete('/api/bug-reports/99999')
        .set('Cookie', authCookie);

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/bug-reports/batch-delete', () => {
    it('returns 401 without auth', async () => {
      const res = await request(app)
        .post('/api/bug-reports/batch-delete')
        .send({ ids: [1] });

      expect(res.status).toBe(401);
    });

    it('deletes multiple reports', async () => {
      // Create two reports
      const r1 = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'Batch 1', page_url: 'https://example.com' });
      const r2 = await request(app)
        .post('/api/bug-reports')
        .send({ message: 'Batch 2', page_url: 'https://example.com' });

      const res = await request(app)
        .post('/api/bug-reports/batch-delete')
        .send({ ids: [r1.body.id, r2.body.id] })
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.deleted).toBe(2);
    });

    it('rejects empty ids array', async () => {
      const res = await request(app)
        .post('/api/bug-reports/batch-delete')
        .send({ ids: [] })
        .set('Cookie', authCookie);

      expect(res.status).toBe(400);
    });
  });
});
