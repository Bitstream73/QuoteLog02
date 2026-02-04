import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the database module before importing logger
vi.mock('../../src/config/database.js', () => ({
  getDb: vi.fn().mockReturnValue({
    prepare: vi.fn().mockReturnValue({
      run: vi.fn()
    })
  }),
  default: {
    getDb: vi.fn().mockReturnValue({
      prepare: vi.fn().mockReturnValue({
        run: vi.fn()
      })
    })
  }
}));

// Mock the config
vi.mock('../../src/config/index.js', () => ({
  default: {
    env: 'test',
    port: 3000,
    databasePath: ':memory:',
    geminiApiKey: '',
    pineconeApiKey: '',
    pineconeIndexHost: '',
  }
}));

describe('Logger Service', () => {
  let logger;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Re-mock after reset
    vi.doMock('../../src/config/database.js', () => ({
      getDb: vi.fn().mockReturnValue({
        prepare: vi.fn().mockReturnValue({
          run: vi.fn()
        })
      }),
      default: {
        getDb: vi.fn().mockReturnValue({
          prepare: vi.fn().mockReturnValue({
            run: vi.fn()
          })
        })
      }
    }));

    vi.doMock('../../src/config/index.js', () => ({
      default: {
        env: 'test',
        port: 3000,
        databasePath: ':memory:',
        geminiApiKey: '',
        pineconeApiKey: '',
        pineconeIndexHost: '',
      }
    }));

    const module = await import('../../src/services/logger.js');
    logger = module.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Log Levels', () => {
    it('should log error level messages', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      logger.error('ai', 'gemini_failed', { model: 'gemini-pro' }, 'API Error');
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log warn level messages', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logger.warn('api', 'rate_limit_near', { remaining: 5 });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log info level messages', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('system', 'startup', { version: '1.0.0' });
      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should only log debug in development', async () => {
      const consoleSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
      // In test env, debug should not log
      logger.debug('db', 'query', { sql: 'SELECT...' });
      expect(consoleSpy).not.toHaveBeenCalled();
    });
  });

  describe('Data Sanitization', () => {
    it('should mask API keys in log details', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('ai', 'request', {
        apiKey: 'AIzaSyAbc123xyz',
        model: 'gemini-pro'
      });
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(loggedData.details.apiKey).toBe('[REDACTED]');
    });

    it('should mask tokens in log details', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('system', 'config', {
        pineconeKey: 'pcsk_abc123',
        railwayToken: 'railway_xyz'
      });
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(loggedData.details.pineconeKey).toBe('[REDACTED]');
      expect(loggedData.details.railwayToken).toBe('[REDACTED]');
    });
  });

  describe('Log Structure', () => {
    it('should include timestamp in ISO8601 format', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('system', 'startup', {});
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(loggedData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include all required fields', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('api', 'request', { path: '/test' });
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(loggedData).toHaveProperty('timestamp');
      expect(loggedData).toHaveProperty('level', 'info');
      expect(loggedData).toHaveProperty('category', 'api');
      expect(loggedData).toHaveProperty('action', 'request');
      expect(loggedData).toHaveProperty('details');
    });

    it('should include duration for timed operations', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      logger.info('ai', 'request_complete', { model: 'gemini-pro' }, null, 1523);
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(loggedData.duration).toBe(1523);
    });
  });

  describe('Child Logger', () => {
    it('should create child logger with preset context', () => {
      const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const childLogger = logger.child({ requestId: 'req-123' });
      childLogger.info('api', 'handler', { path: '/test' });
      const loggedData = JSON.parse(consoleSpy.mock.calls[0][1]);
      expect(loggedData.requestId).toBe('req-123');
    });
  });

  describe('Database Storage', () => {
    it('should handle database errors gracefully', () => {
      expect(() => {
        logger.info('test', 'action', {});
      }).not.toThrow();
    });
  });
});
