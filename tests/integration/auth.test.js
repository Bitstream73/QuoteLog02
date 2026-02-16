import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Mock the email service before any app import
vi.mock('../../src/services/email.js', () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/auth-test.db';

describe('Auth API', () => {
  let app;
  let db;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();
    const dbModule = await import('../../src/config/database.js');
    db = dbModule.getDb();
  });

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/auth-test.db');
      fs.unlinkSync('./tests/auth-test.db-wal');
      fs.unlinkSync('./tests/auth-test.db-shm');
    } catch {}
  });

  describe('POST /api/auth/login', () => {
    it('returns 200 and sets auth_token cookie with correct credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'jakob@karlsmark.com', password: 'Ferret@00' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('email', 'jakob@karlsmark.com');

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = cookies.find(c => c.startsWith('auth_token='));
      expect(authCookie).toBeDefined();
      expect(authCookie).toContain('HttpOnly');
      expect(authCookie).toContain('Path=/');
    });

    it('returns 401 with wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'jakob@karlsmark.com', password: 'wrong' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid email or password');
    });

    it('returns 401 with unknown email', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'Ferret@00' });

      expect(res.status).toBe(401);
      expect(res.body).toHaveProperty('error', 'Invalid email or password');
    });

    it('returns 400 if email or password missing', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'jakob@karlsmark.com' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });
  });

  describe('GET /api/auth/me', () => {
    it('returns authenticated true with valid cookie', async () => {
      // Login first to get a cookie
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: 'jakob@karlsmark.com', password: 'Ferret@00' });

      const cookies = loginRes.headers['set-cookie'];
      const authCookie = cookies.find(c => c.startsWith('auth_token='));

      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', authCookie);

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authenticated', true);
      expect(res.body).toHaveProperty('email', 'jakob@karlsmark.com');
    });

    it('returns authenticated false without cookie', async () => {
      const res = await request(app).get('/api/auth/me');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authenticated', false);
    });

    it('returns authenticated false with invalid cookie', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', 'auth_token=invalidtoken');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('authenticated', false);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('clears the auth_token cookie', async () => {
      const res = await request(app).post('/api/auth/logout');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      const cookies = res.headers['set-cookie'];
      expect(cookies).toBeDefined();
      const authCookie = cookies.find(c => c.startsWith('auth_token='));
      expect(authCookie).toBeDefined();
      // The cookie should be cleared (expired)
      expect(authCookie).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });
  });

  describe('POST /api/auth/forgot-password', () => {
    it('returns 200 success message for registered email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'jakob@karlsmark.com' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('returns 200 success message for unregistered email', async () => {
      const res = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nobody@example.com' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
    });

    it('creates a token in password_reset_tokens table', async () => {
      await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'jakob@karlsmark.com' });

      // Wait a moment for async token creation
      await new Promise(r => setTimeout(r, 100));

      const token = db.prepare(
        "SELECT * FROM password_reset_tokens WHERE email = 'jakob@karlsmark.com' ORDER BY id DESC LIMIT 1"
      ).get();

      expect(token).toBeDefined();
      expect(token.used).toBe(0);
    });
  });

  describe('POST /api/auth/reset-password', () => {
    it('changes password with valid token', async () => {
      // Create a token directly
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare("INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))")
        .run('jakob@karlsmark.com', token);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'NewPassword123!' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);

      // Verify password was changed in DB (avoid login to prevent rate limit hit)
      const bcryptjs = await import('bcryptjs');
      const user = db.prepare("SELECT password_hash FROM admin_users WHERE email = 'jakob@karlsmark.com'").get();
      expect(bcryptjs.default.compareSync('NewPassword123!', user.password_hash)).toBe(true);

      // Verify password_changed_at was set
      const userFull = db.prepare("SELECT password_changed_at FROM admin_users WHERE email = 'jakob@karlsmark.com'").get();
      expect(userFull.password_changed_at).toBeDefined();

      // Reset the password back to original for other tests
      const hash = bcryptjs.default.hashSync('Ferret@00', 12);
      db.prepare("UPDATE admin_users SET password_hash = ?, password_changed_at = NULL WHERE email = 'jakob@karlsmark.com'").run(hash);
    });

    it('returns 400 with expired token', async () => {
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare("INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, datetime('now', '-1 hour'))")
        .run('jakob@karlsmark.com', token);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'NewPassword123!' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid or expired reset token');
    });

    it('returns 400 with already-used token', async () => {
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare("INSERT INTO password_reset_tokens (email, token, expires_at, used) VALUES (?, ?, datetime('now', '+1 hour'), 1)")
        .run('jakob@karlsmark.com', token);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'NewPassword123!' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid or expired reset token');
    });

    it('returns 400 with invalid token', async () => {
      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token: 'nonexistenttoken', password: 'NewPassword123!' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Invalid or expired reset token');
    });

    it('returns 400 if password is too short', async () => {
      const crypto = await import('crypto');
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare("INSERT INTO password_reset_tokens (email, token, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))")
        .run('jakob@karlsmark.com', token);

      const res = await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'short' });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error', 'Password must be at least 8 characters');
    });
  });
});
