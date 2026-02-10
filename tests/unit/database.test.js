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

  it('should support is_visible column on quotes table', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS persons_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_name TEXT NOT NULL,
        photo_url TEXT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS quotes_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL,
        text TEXT NOT NULL,
        quote_type TEXT NOT NULL DEFAULT 'direct',
        is_visible INTEGER NOT NULL DEFAULT 1
      )
    `);

    // Insert test data
    db.prepare('INSERT INTO persons_test (canonical_name) VALUES (?)').run('Test Person');
    db.prepare('INSERT INTO quotes_test (person_id, text) VALUES (1, ?)').run('Test quote');

    const quote = db.prepare('SELECT is_visible FROM quotes_test WHERE id = 1').get();
    expect(quote.is_visible).toBe(1);

    // Toggle visibility
    db.prepare('UPDATE quotes_test SET is_visible = 0 WHERE id = 1').run();
    const hidden = db.prepare('SELECT is_visible FROM quotes_test WHERE id = 1').get();
    expect(hidden.is_visible).toBe(0);
  });

  it('should support photo_url column on persons table', () => {
    const person = db.prepare('SELECT photo_url FROM persons_test WHERE id = 1').get();
    expect(person.photo_url).toBeNull();

    db.prepare('UPDATE persons_test SET photo_url = ? WHERE id = 1').run('https://example.com/photo.jpg');
    const updated = db.prepare('SELECT photo_url FROM persons_test WHERE id = 1').get();
    expect(updated.photo_url).toBe('https://example.com/photo.jpg');
  });

  it('should support is_top_story column on sources table', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sources_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        name TEXT,
        rss_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        is_top_story INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.prepare('INSERT INTO sources_test (domain, name) VALUES (?, ?)').run('example.com', 'Example');
    const source = db.prepare('SELECT is_top_story FROM sources_test WHERE id = 1').get();
    expect(source.is_top_story).toBe(0);

    db.prepare('UPDATE sources_test SET is_top_story = 1 WHERE id = 1').run();
    const updated = db.prepare('SELECT is_top_story FROM sources_test WHERE id = 1').get();
    expect(updated.is_top_story).toBe(1);
  });

  it('should support is_top_story column on articles table', () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS articles_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        title TEXT,
        is_top_story INTEGER NOT NULL DEFAULT 0
      )
    `);

    db.prepare('INSERT INTO articles_test (url, title) VALUES (?, ?)').run('https://example.com/article', 'Test Article');
    const article = db.prepare('SELECT is_top_story FROM articles_test WHERE id = 1').get();
    expect(article.is_top_story).toBe(0);

    db.prepare('UPDATE articles_test SET is_top_story = 1 WHERE id = 1').run();
    const updated = db.prepare('SELECT is_top_story FROM articles_test WHERE id = 1').get();
    expect(updated.is_top_story).toBe(1);
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
