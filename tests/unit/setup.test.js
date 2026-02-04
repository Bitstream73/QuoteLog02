import { describe, it, expect } from 'vitest';
import fs from 'fs';

describe('Project Setup', () => {
  it('should have package.json with required dependencies', () => {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.dependencies).toHaveProperty('express');
    expect(pkg.dependencies).toHaveProperty('better-sqlite3');
    expect(pkg.dependencies).toHaveProperty('@pinecone-database/pinecone');
    expect(pkg.dependencies).toHaveProperty('socket.io');
    expect(pkg.dependencies).toHaveProperty('@google/generative-ai');
  });

  it('should have required directory structure', () => {
    const requiredDirs = ['src', 'src/routes', 'src/services', 'src/middleware', 'public', 'tests'];
    requiredDirs.forEach(dir => {
      expect(fs.existsSync(dir)).toBe(true);
    });
  });

  it('should have .env.example file', () => {
    expect(fs.existsSync('.env.example')).toBe(true);
  });

  it('should have .gitignore that excludes .env', () => {
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('.env');
    expect(gitignore).toContain('node_modules');
  });
});
