import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Prompt Manager — Unit Tests', () => {
  let db;
  const testDbPath = path.join(__dirname, '../prompt-manager-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');

    // Create gemini_prompts table (same as database.js migration)
    db.exec(`
      CREATE TABLE IF NOT EXISTS gemini_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt_key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        template TEXT NOT NULL,
        category TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Seed test data
    db.prepare(`
      INSERT INTO gemini_prompts (prompt_key, name, description, template, category)
      VALUES (?, ?, ?, ?, ?)
    `).run('test_prompt', 'Test Prompt', 'A test prompt', 'Hello {{name}}, you are {{role}}.', 'test');

    db.prepare(`
      INSERT INTO gemini_prompts (prompt_key, name, description, template, category, is_active)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('inactive_prompt', 'Inactive', 'Disabled prompt', 'This is inactive.', 'test', 0);
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = testDbPath + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  });

  describe('gemini_prompts table', () => {
    it('table exists with correct columns', () => {
      const cols = db.prepare('PRAGMA table_info(gemini_prompts)').all().map(c => c.name);
      expect(cols).toContain('id');
      expect(cols).toContain('prompt_key');
      expect(cols).toContain('name');
      expect(cols).toContain('description');
      expect(cols).toContain('template');
      expect(cols).toContain('category');
      expect(cols).toContain('is_active');
      expect(cols).toContain('created_at');
      expect(cols).toContain('updated_at');
    });

    it('prompt_key is UNIQUE', () => {
      expect(() => {
        db.prepare(`
          INSERT INTO gemini_prompts (prompt_key, name, template) VALUES (?, ?, ?)
        `).run('test_prompt', 'Duplicate', 'dup');
      }).toThrow();
    });

    it('can retrieve a prompt by key', () => {
      const row = db.prepare('SELECT * FROM gemini_prompts WHERE prompt_key = ?').get('test_prompt');
      expect(row).toBeDefined();
      expect(row.name).toBe('Test Prompt');
      expect(row.template).toContain('Hello {{name}}');
    });

    it('can update a prompt template', () => {
      db.prepare("UPDATE gemini_prompts SET template = ?, updated_at = datetime('now') WHERE prompt_key = ?")
        .run('Updated template: {{name}}', 'test_prompt');
      const row = db.prepare('SELECT template FROM gemini_prompts WHERE prompt_key = ?').get('test_prompt');
      expect(row.template).toBe('Updated template: {{name}}');
    });

    it('is_active defaults to 1', () => {
      db.prepare("INSERT INTO gemini_prompts (prompt_key, name, template) VALUES (?, ?, ?)")
        .run('default_active', 'Default Active', 'active prompt');
      const row = db.prepare('SELECT is_active FROM gemini_prompts WHERE prompt_key = ?').get('default_active');
      expect(row.is_active).toBe(1);
    });

    it('inactive prompts are excluded when filtering by is_active', () => {
      const active = db.prepare('SELECT * FROM gemini_prompts WHERE is_active = 1').all();
      const inactive = db.prepare('SELECT * FROM gemini_prompts WHERE is_active = 0').all();
      expect(active.length).toBeGreaterThan(0);
      expect(inactive.length).toBe(1);
      expect(inactive[0].prompt_key).toBe('inactive_prompt');
    });

    it('list all prompts returns metadata without template text', () => {
      const rows = db.prepare(`
        SELECT prompt_key, name, description, category, is_active,
               LENGTH(template) as template_length
        FROM gemini_prompts ORDER BY category, name
      `).all();
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.template_length).toBeGreaterThan(0);
        expect(row).not.toHaveProperty('template');
      }
    });
  });
});
