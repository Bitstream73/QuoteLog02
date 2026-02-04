import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Database Setup', () => {
  let db;
  const testDbPath = path.join(__dirname, '../test.db');

  beforeAll(() => {
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterAll(() => {
    db.close();
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    // Clean up WAL files
    if (fs.existsSync(testDbPath + '-wal')) fs.unlinkSync(testDbPath + '-wal');
    if (fs.existsSync(testDbPath + '-shm')) fs.unlinkSync(testDbPath + '-shm');
  });

  it('should create quotes table with correct schema', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        author TEXT NOT NULL,
        source_url TEXT,
        source_name TEXT,
        published_date INTEGER,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    const tableInfo = db.prepare("PRAGMA table_info(quotes)").all();
    const columns = tableInfo.map(col => col.name);

    expect(columns).toContain('id');
    expect(columns).toContain('text');
    expect(columns).toContain('author');
    expect(columns).toContain('source_url');
  });

  it('should create authors table with correct schema', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS authors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        bio TEXT,
        image_url TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    const tableInfo = db.prepare("PRAGMA table_info(authors)").all();
    const columns = tableInfo.map(col => col.name);

    expect(columns).toContain('id');
    expect(columns).toContain('name');
    expect(columns).toContain('bio');
  });

  it('should support WAL mode', () => {
    const result = db.pragma('journal_mode');
    expect(result[0].journal_mode).toBe('wal');
  });

  it('should create application_logs table with correct schema', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS application_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        level TEXT NOT NULL CHECK(level IN ('error', 'warn', 'info', 'debug')),
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        request_id TEXT,
        ip_address TEXT,
        details TEXT,
        duration INTEGER,
        error TEXT,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `);

    const tableInfo = db.prepare("PRAGMA table_info(application_logs)").all();
    const columns = tableInfo.map(col => col.name);

    expect(columns).toContain('timestamp');
    expect(columns).toContain('level');
    expect(columns).toContain('category');
    expect(columns).toContain('action');
    expect(columns).toContain('request_id');
  });
});
