import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Configuration', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should load configuration from environment variables', async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '3000';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    const { default: config } = await import('../../src/config/index.js');

    expect(config.env).toBe('test');
    expect(config.port).toBe(3000);
  });

  it('should throw error for missing required variables', async () => {
    delete process.env.GEMINI_API_KEY;

    const { validateEnv } = await import('../../src/utils/validateEnv.js');
    const result = validateEnv();

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('GEMINI_API_KEY');
  });

  it('should have default values for optional config', async () => {
    process.env.GEMINI_API_KEY = 'test-key';
    delete process.env.PORT;

    const { default: config } = await import('../../src/config/index.js');

    expect(config.port).toBe(3000);
  });
});
