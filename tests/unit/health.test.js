import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';

process.env.GEMINI_API_KEY = 'test-key';
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/health-test.db';

describe('Health Check', () => {
  let app;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/health-test.db');
      fs.unlinkSync('./tests/health-test.db-wal');
      fs.unlinkSync('./tests/health-test.db-shm');
    } catch {}
  });

  it('should return healthy status', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'healthy');
    expect(response.body).toHaveProperty('timestamp');
  });

  it('should include service statuses', async () => {
    const response = await request(app).get('/api/health');

    expect(response.body).toHaveProperty('services');
    expect(response.body.services).toHaveProperty('database');
  });

  it('should include version information', async () => {
    const response = await request(app).get('/api/health');

    expect(response.body).toHaveProperty('version');
  });
});
