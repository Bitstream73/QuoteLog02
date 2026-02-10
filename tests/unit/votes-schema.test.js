import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Votes & Keywords Schema', () => {
  let db;
  const testDbPath = path.join(__dirname, '../votes-schema-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Create prerequisite tables (quotes depends on persons)
    db.exec(`
      CREATE TABLE IF NOT EXISTS persons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        canonical_name TEXT NOT NULL,
        photo_url TEXT,
        category TEXT DEFAULT 'Other'
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id INTEGER NOT NULL REFERENCES persons(id),
        text TEXT NOT NULL,
        quote_type TEXT NOT NULL DEFAULT 'direct',
        context TEXT,
        is_visible INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create the votes and quote_keywords tables (matches database.js schema)
    db.exec(`
      CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        voter_hash TEXT NOT NULL,
        vote_value INTEGER NOT NULL CHECK(vote_value IN (-1, 1)),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(quote_id, voter_hash)
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS quote_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
        keyword TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Create indexes
    db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_quote_id ON votes(quote_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_voter_hash ON votes(voter_hash)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_keyword ON quote_keywords(keyword)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_quote_keywords_quote_id ON quote_keywords(quote_id)`);

    // Seed test data
    db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Test Author');
    db.prepare('INSERT INTO quotes (person_id, text, context) VALUES (?, ?, ?)').run(1, 'Test quote text', 'economy policy discussion');
    db.prepare('INSERT INTO quotes (person_id, text, context) VALUES (?, ?, ?)').run(1, 'Another quote', 'climate change debate');
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  // --- votes table ---

  it('votes table exists', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='votes'").get();
    expect(table).toBeDefined();
    expect(table.name).toBe('votes');
  });

  it('votes table has correct columns', () => {
    const cols = db.prepare('PRAGMA table_info(votes)').all().map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('quote_id');
    expect(cols).toContain('voter_hash');
    expect(cols).toContain('vote_value');
    expect(cols).toContain('created_at');
    expect(cols).toContain('updated_at');
  });

  it('can insert a vote and retrieve it', () => {
    db.prepare('INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_abc123', 1);
    const vote = db.prepare('SELECT * FROM votes WHERE quote_id = 1 AND voter_hash = ?').get('hash_abc123');
    expect(vote.vote_value).toBe(1);
    expect(vote.quote_id).toBe(1);
  });

  it('UNIQUE(quote_id, voter_hash) rejects duplicate votes', () => {
    expect(() => {
      db.prepare('INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_abc123', -1);
    }).toThrow();
  });

  it('vote_value CHECK constraint rejects invalid values', () => {
    expect(() => {
      db.prepare('INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_invalid', 2);
    }).toThrow();

    expect(() => {
      db.prepare('INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_invalid2', 0);
    }).toThrow();
  });

  it('deleting a quote cascades to delete its votes', () => {
    // Insert a new quote and vote
    db.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Temp quote');
    const quoteId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    db.prepare('INSERT INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(quoteId, 'hash_cascade', 1);

    // Verify vote exists
    const before = db.prepare('SELECT COUNT(*) as count FROM votes WHERE quote_id = ?').get(quoteId);
    expect(before.count).toBe(1);

    // Delete the quote
    db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);

    // Votes should be cascade deleted
    const after = db.prepare('SELECT COUNT(*) as count FROM votes WHERE quote_id = ?').get(quoteId);
    expect(after.count).toBe(0);
  });

  // --- quote_keywords table ---

  it('quote_keywords table exists', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quote_keywords'").get();
    expect(table).toBeDefined();
    expect(table.name).toBe('quote_keywords');
  });

  it('quote_keywords table has correct columns', () => {
    const cols = db.prepare('PRAGMA table_info(quote_keywords)').all().map(c => c.name);
    expect(cols).toContain('id');
    expect(cols).toContain('quote_id');
    expect(cols).toContain('keyword');
    expect(cols).toContain('created_at');
  });

  it('can insert keywords and retrieve them', () => {
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(1, 'economy');
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(1, 'policy');

    const keywords = db.prepare('SELECT keyword FROM quote_keywords WHERE quote_id = ?').all(1);
    expect(keywords.map(k => k.keyword)).toContain('economy');
    expect(keywords.map(k => k.keyword)).toContain('policy');
  });

  it('deleting a quote cascades to delete its keywords', () => {
    // Insert a new quote and keywords
    db.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Keyword cascade test');
    const quoteId = db.prepare('SELECT last_insert_rowid() as id').get().id;
    db.prepare('INSERT INTO quote_keywords (quote_id, keyword) VALUES (?, ?)').run(quoteId, 'test');

    // Delete the quote
    db.prepare('DELETE FROM quotes WHERE id = ?').run(quoteId);

    // Keywords should be cascade deleted
    const after = db.prepare('SELECT COUNT(*) as count FROM quote_keywords WHERE quote_id = ?').get(quoteId);
    expect(after.count).toBe(0);
  });

  // --- Indexes ---

  it('all required indexes exist', () => {
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(i => i.name);

    expect(indexes).toContain('idx_votes_quote_id');
    expect(indexes).toContain('idx_votes_voter_hash');
    expect(indexes).toContain('idx_quote_keywords_keyword');
    expect(indexes).toContain('idx_quote_keywords_quote_id');
  });

  // --- Aggregate query patterns ---

  it('vote aggregation query works correctly', () => {
    // Add more votes on quote 1
    db.prepare('INSERT OR IGNORE INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_up1', 1);
    db.prepare('INSERT OR IGNORE INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_up2', 1);
    db.prepare('INSERT OR IGNORE INTO votes (quote_id, voter_hash, vote_value) VALUES (?, ?, ?)').run(1, 'hash_down1', -1);

    const result = db.prepare(`
      SELECT COALESCE(SUM(vote_value), 0) as vote_score,
             COUNT(CASE WHEN vote_value = 1 THEN 1 END) as upvotes,
             COUNT(CASE WHEN vote_value = -1 THEN 1 END) as downvotes
      FROM votes WHERE quote_id = ?
    `).get(1);

    // hash_abc123 (+1), hash_up1 (+1), hash_up2 (+1), hash_down1 (-1) = 2
    expect(result.vote_score).toBe(2);
    expect(result.upvotes).toBe(3);
    expect(result.downvotes).toBe(1);
  });

  it('vote score returns 0 for unvoted quotes', () => {
    const result = db.prepare(`
      SELECT COALESCE(SUM(vote_value), 0) as vote_score
      FROM votes WHERE quote_id = ?
    `).get(2);

    expect(result.vote_score).toBe(0);
  });
});
