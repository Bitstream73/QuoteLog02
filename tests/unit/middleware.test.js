import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock logger for all middleware tests
vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
    }),
  }
}));

describe('Middleware', () => {
  describe('Error Handler', () => {
    it('should return 500 for unhandled errors', async () => {
      const app = express();
      const { errorHandler } = await import('../../src/middleware/errorHandler.js');

      app.get('/error', () => {
        throw new Error('Test error');
      });
      app.use(errorHandler);

      const response = await request(app).get('/error');
      expect(response.status).toBe(500);
    });

    it('should return custom status codes', async () => {
      const app = express();
      const { errorHandler, AppError } = await import('../../src/middleware/errorHandler.js');

      app.get('/not-found', () => {
        throw new AppError('Not found', 404);
      });
      app.use(errorHandler);

      const response = await request(app).get('/not-found');
      expect(response.status).toBe(404);
    });

    it('should not leak stack traces in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const app = express();
      vi.resetModules();

      vi.doMock('../../src/services/logger.js', () => ({
        default: {
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
          child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
          }),
        }
      }));

      const { errorHandler } = await import('../../src/middleware/errorHandler.js');

      app.get('/error', () => {
        throw new Error('Secret error');
      });
      app.use(errorHandler);

      const response = await request(app).get('/error');
      expect(response.body).not.toHaveProperty('stack');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Rate Limiter', () => {
    it('should allow requests under limit', async () => {
      const app = express();
      const { createRateLimiter } = await import('../../src/middleware/rateLimiter.js');

      app.use(createRateLimiter({ windowMs: 60000, max: 10 }));
      app.get('/test', (req, res) => res.json({ ok: true }));

      const response = await request(app).get('/test');
      expect(response.status).toBe(200);
    });

    it('should block requests over limit', async () => {
      const app = express();
      const { createRateLimiter } = await import('../../src/middleware/rateLimiter.js');

      app.use(createRateLimiter({ windowMs: 60000, max: 2 }));
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');
      await request(app).get('/test');
      const response = await request(app).get('/test');

      expect(response.status).toBe(429);
    });

    it('should skip rate limiting for authenticated admins', async () => {
      vi.resetModules();
      const jwt = await import('jsonwebtoken');
      const config = (await import('../../src/config/index.js')).default;
      const token = jwt.default.sign({ admin: true }, config.jwtSecret, { expiresIn: '1h' });

      const app = express();
      const cookieParser = (await import('cookie-parser')).default;
      app.use(cookieParser());
      const { createRateLimiter } = await import('../../src/middleware/rateLimiter.js');

      app.use(createRateLimiter({ windowMs: 60000, max: 2 }));
      app.get('/test', (req, res) => res.json({ ok: true }));

      // Make 3 requests (over the limit of 2) with a valid auth cookie
      for (let i = 0; i < 3; i++) {
        const response = await request(app).get('/test').set('Cookie', `auth_token=${token}`);
        expect(response.status).toBe(200);
      }
    });

    it('should skip paths specified in skipPaths option', async () => {
      vi.resetModules();
      const app = express();
      const { createRateLimiter } = await import('../../src/middleware/rateLimiter.js');

      app.use(createRateLimiter({ windowMs: 60000, max: 2, skipPaths: ['/auth/'] }));
      app.get('/auth/login', (req, res) => res.json({ ok: true }));
      app.get('/test', (req, res) => res.json({ ok: true }));

      // Exhaust the limit on /test
      await request(app).get('/test');
      await request(app).get('/test');
      const blockedResponse = await request(app).get('/test');
      expect(blockedResponse.status).toBe(429);

      // /auth/login should still work (skipped)
      const authResponse = await request(app).get('/auth/login');
      expect(authResponse.status).toBe(200);
    });

    it('should skip login rate limiter for authenticated admins', async () => {
      vi.resetModules();
      const jwt = await import('jsonwebtoken');
      const config = (await import('../../src/config/index.js')).default;
      const token = jwt.default.sign({ admin: true }, config.jwtSecret, { expiresIn: '1h' });

      const app = express();
      const cookieParser = (await import('cookie-parser')).default;
      app.use(cookieParser());
      const { createLoginRateLimiter } = await import('../../src/middleware/rateLimiter.js');

      app.use(createLoginRateLimiter());
      app.post('/login', (req, res) => res.json({ ok: true }));

      // Make 6 requests (over the login limit of 5) with a valid auth cookie
      for (let i = 0; i < 6; i++) {
        const response = await request(app).post('/login').set('Cookie', `auth_token=${token}`);
        expect(response.status).toBe(200);
      }
    });
  });

  describe('Request Logger', () => {
    it('should attach requestId to each request', async () => {
      const app = express();
      vi.resetModules();

      vi.doMock('../../src/services/logger.js', () => ({
        default: {
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
          child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
          }),
        }
      }));

      const { requestLogger } = await import('../../src/middleware/requestLogger.js');

      app.use(requestLogger);
      app.get('/test', (req, res) => {
        res.json({ requestId: req.requestId });
      });

      const response = await request(app).get('/test');
      expect(response.body.requestId).toMatch(/^[a-f0-9-]{36}$/);
    });

    it('should log request completion with duration', async () => {
      vi.resetModules();

      const mockLogger = {
        info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        child: vi.fn().mockReturnValue({
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
        }),
      };

      vi.doMock('../../src/services/logger.js', () => ({ default: mockLogger }));

      const app = express();
      const { requestLogger } = await import('../../src/middleware/requestLogger.js');

      app.use(requestLogger);
      app.get('/test', (req, res) => res.json({ ok: true }));

      await request(app).get('/test');

      expect(mockLogger.info).toHaveBeenCalledWith(
        'api',
        'request_complete',
        expect.objectContaining({
          method: 'GET',
          path: '/test',
          statusCode: 200,
          duration: expect.any(Number)
        })
      );
    });

    it('should skip logging for health check endpoints', async () => {
      vi.resetModules();

      const mockLogger = {
        info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        child: vi.fn().mockReturnValue({
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
        }),
      };

      vi.doMock('../../src/services/logger.js', () => ({ default: mockLogger }));

      const app = express();
      const { requestLogger } = await import('../../src/middleware/requestLogger.js');

      app.use(requestLogger);
      app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

      await request(app).get('/api/health');

      const healthLogs = mockLogger.info.mock.calls.filter(
        call => call[2]?.path === '/api/health'
      );
      expect(healthLogs.length).toBe(0);
    });
  });

  describe('Log Context Middleware', () => {
    it('should attach logger to request object', async () => {
      vi.resetModules();

      vi.doMock('../../src/services/logger.js', () => ({
        default: {
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
          child: vi.fn().mockReturnValue({
            info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
          }),
        }
      }));

      const app = express();
      const { logContext } = await import('../../src/middleware/logContext.js');

      app.use(logContext);
      app.get('/test', (req, res) => {
        expect(req.logger).toBeDefined();
        expect(typeof req.logger.info).toBe('function');
        res.json({ ok: true });
      });

      await request(app).get('/test');
    });
  });
});
