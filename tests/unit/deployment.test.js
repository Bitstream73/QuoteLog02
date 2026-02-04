import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Deployment Configuration', () => {
  it('should have valid Dockerfile', () => {
    const dockerfile = fs.readFileSync('Dockerfile', 'utf8');

    expect(dockerfile).toContain('FROM node:20-alpine');
    expect(dockerfile).toContain('HEALTHCHECK');
    expect(dockerfile).toContain('USER nodejs');
  });

  it('should have valid railway.json', () => {
    const config = JSON.parse(fs.readFileSync('railway.json', 'utf8'));

    expect(config.deploy).toHaveProperty('healthcheckPath');
    expect(config.deploy.healthcheckPath).toBe('/api/health');
  });

  it('should have all required env vars documented', () => {
    const envExample = fs.readFileSync('.env.example', 'utf8');

    const requiredVars = [
      'NODE_ENV',
      'PORT',
      'DATABASE_PATH',
      'GEMINI_API_KEY',
      'PINECONE_API_KEY',
      'PINECONE_INDEX_HOST'
    ];

    requiredVars.forEach(varName => {
      expect(envExample).toContain(varName);
    });
  });
});
