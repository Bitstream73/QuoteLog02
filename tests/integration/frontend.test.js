import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/integration-test.db';

describe('Frontend Routes', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    // Clean up test database
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/integration-test.db');
      fs.unlinkSync('./tests/integration-test.db-wal');
      fs.unlinkSync('./tests/integration-test.db-shm');
    } catch {}
  });

  describe('Static Files', () => {
    it('should serve index.html', async () => {
      const response = await request(app).get('/');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/html');
    });

    it('should serve manifest.json', async () => {
      const response = await request(app).get('/manifest.json');
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('name');
    });

    it('should serve service worker', async () => {
      const response = await request(app).get('/sw.js');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('javascript');
    });
  });

  describe('Quotes API', () => {
    it('should get paginated quotes', async () => {
      const response = await request(app).get('/api/quotes');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('quotes');
      expect(response.body).toHaveProperty('total');
      expect(Array.isArray(response.body.quotes)).toBe(true);
    });

    it('should return 404 for non-existent quote', async () => {
      const response = await request(app).get('/api/quotes/99999');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error');
    });
  });

  describe('Authors API', () => {
    it('should get all authors', async () => {
      const response = await request(app).get('/api/authors');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('authors');
      expect(Array.isArray(response.body.authors)).toBe(true);
    });
  });

  describe('Settings API', () => {
    it('should get app settings', async () => {
      const response = await request(app).get('/api/settings');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('theme');
    });

    it('should update settings', async () => {
      const response = await request(app)
        .put('/api/settings')
        .send({ theme: 'dark' });

      expect(response.status).toBe(200);
      expect(response.body.theme).toBe('dark');
    });
  });

  describe('Logs API', () => {
    it('should return paginated logs', async () => {
      const response = await request(app)
        .get('/api/logs?page=1&limit=20');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('logs');
      expect(response.body).toHaveProperty('total');
      expect(response.body).toHaveProperty('page');
      expect(response.body).toHaveProperty('totalPages');
      expect(Array.isArray(response.body.logs)).toBe(true);
    });

    it('should filter logs by level', async () => {
      const response = await request(app)
        .get('/api/logs?level=error');

      expect(response.status).toBe(200);
      response.body.logs.forEach(log => {
        expect(log.level).toBe('error');
      });
    });

    it('should filter logs by category', async () => {
      const response = await request(app)
        .get('/api/logs?category=api');

      expect(response.status).toBe(200);
      response.body.logs.forEach(log => {
        expect(log.category).toBe('api');
      });
    });

    it('should return log statistics', async () => {
      const response = await request(app)
        .get('/api/logs/stats');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('errorCount24h');
      expect(response.body).toHaveProperty('warningCount24h');
      expect(response.body).toHaveProperty('requestsPerHour');
      expect(response.body).toHaveProperty('topCategories');
    });

    it('should export logs as CSV', async () => {
      const response = await request(app)
        .get('/api/logs/export');

      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment');
    });
  });
});
