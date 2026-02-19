import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  default: {
    env: 'test',
    port: 3000,
    databasePath: ':memory:',
    geminiApiKey: 'test-key',
    pineconeApiKey: 'test-key',
    pineconeIndexHost: 'https://test.pinecone.io',
    pineconeNamespace: 'test',
  }
}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}));

// Mock Gemini
const mockGenerateText = vi.fn();
vi.mock('../../src/services/ai/gemini.js', () => ({
  default: { generateText: mockGenerateText }
}));

// Mock vectorDb
const mockSearchQuotes = vi.fn().mockResolvedValue([]);
const mockQueryQuotes = vi.fn().mockResolvedValue([]);
vi.mock('../../src/services/vectorDb.js', () => ({
  searchQuotes: mockSearchQuotes,
  queryQuotes: mockQueryQuotes,
}));

// In-memory database setup
let testDb;

vi.mock('../../src/config/database.js', () => ({
  getDb: () => testDb,
}));

function setupTestDb() {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  testDb.exec(`
    CREATE TABLE persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL,
      disambiguation TEXT,
      photo_url TEXT,
      category_context TEXT,
      quote_count INTEGER NOT NULL DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  testDb.exec(`
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id),
      text TEXT NOT NULL,
      context TEXT,
      quote_type TEXT NOT NULL DEFAULT 'direct',
      is_visible INTEGER NOT NULL DEFAULT 1,
      canonical_quote_id INTEGER,
      source_urls TEXT NOT NULL DEFAULT '[]',
      quote_datetime TEXT,
      importants_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  testDb.exec(`
    CREATE TABLE quote_context_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL UNIQUE REFERENCES quotes(id) ON DELETE CASCADE,
      analysis TEXT NOT NULL,
      related_quote_ids TEXT NOT NULL DEFAULT '[]',
      model_version TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days'))
    )
  `);

  testDb.exec(`
    CREATE TABLE quote_smart_related (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      related_type TEXT NOT NULL CHECK(related_type IN ('contradiction', 'context', 'mention')),
      related_quote_id INTEGER NOT NULL REFERENCES quotes(id),
      confidence REAL NOT NULL DEFAULT 0.0,
      explanation TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL DEFAULT (datetime('now', '+7 days')),
      UNIQUE(quote_id, related_quote_id, related_type)
    )
  `);

  testDb.exec(`
    CREATE TABLE articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL UNIQUE,
      source_id INTEGER,
      title TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  testDb.exec(`
    CREATE TABLE sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      domain TEXT NOT NULL,
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  testDb.exec(`
    CREATE TABLE quote_articles (
      quote_id INTEGER NOT NULL,
      article_id INTEGER NOT NULL,
      PRIMARY KEY (quote_id, article_id)
    )
  `);

  // Seed test data
  testDb.prepare('INSERT INTO persons (id, canonical_name, disambiguation) VALUES (?, ?, ?)').run(1, 'John Doe', 'US Senator');
  testDb.prepare('INSERT INTO persons (id, canonical_name) VALUES (?, ?)').run(2, 'Jane Smith');
  testDb.prepare("INSERT INTO quotes (id, person_id, text, context) VALUES (?, ?, ?, ?)").run(1, 1, 'The economy is improving and GDP growth will reach 4% by next year.', 'Press conference on fiscal policy');
  testDb.prepare("INSERT INTO quotes (id, person_id, text) VALUES (?, ?, ?)").run(2, 1, 'We need to invest more in infrastructure.');
  testDb.prepare("INSERT INTO quotes (id, person_id, text) VALUES (?, ?, ?)").run(3, 2, 'John Doe said the economy is improving but the data tells a different story.');

  // Seed article/source data for quote 2
  testDb.prepare('INSERT INTO sources (id, domain, name) VALUES (?, ?, ?)').run(1, 'example.com', 'Example News');
  testDb.prepare('INSERT INTO articles (id, url, source_id, title) VALUES (?, ?, ?, ?)').run(1, 'https://example.com/article-1', 1, 'Infrastructure Investment Article');
  testDb.prepare('INSERT INTO quote_articles (quote_id, article_id) VALUES (?, ?)').run(2, 1);
}

describe('Quote Context Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupTestDb();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  describe('getSmartRelatedQuotes', () => {
    it('should return mentions by others', async () => {
      const { getSmartRelatedQuotes } = await import('../../src/services/quoteContext.js');

      // No Pinecone results for same-author
      mockQueryQuotes.mockResolvedValue([]);

      const result = await getSmartRelatedQuotes(1);

      expect(result).toHaveProperty('contradictions');
      expect(result).toHaveProperty('supportingContext');
      expect(result).toHaveProperty('mentionsByOthers');
      expect(Array.isArray(result.contradictions)).toBe(true);
      expect(Array.isArray(result.supportingContext)).toBe(true);
      expect(Array.isArray(result.mentionsByOthers)).toBe(true);
    });

    it('should find mentions by other authors', async () => {
      const { getSmartRelatedQuotes } = await import('../../src/services/quoteContext.js');
      mockQueryQuotes.mockResolvedValue([]);

      const result = await getSmartRelatedQuotes(1);

      // Quote 3 by Jane Smith mentions "John Doe"
      expect(result.mentionsByOthers.length).toBeGreaterThanOrEqual(1);
      const mention = result.mentionsByOthers.find(m => m.id === 3);
      expect(mention).toBeTruthy();
      expect(mention.authorName).toBe('Jane Smith');
    });

    it('should return cached results on second call', async () => {
      const { getSmartRelatedQuotes } = await import('../../src/services/quoteContext.js');
      mockQueryQuotes.mockResolvedValue([]);

      // First call
      await getSmartRelatedQuotes(1);
      vi.clearAllMocks();

      // Second call should use cache
      const result = await getSmartRelatedQuotes(1);
      expect(result.fromCache).toBe(true);
      expect(mockQueryQuotes).not.toHaveBeenCalled();
    });

    it('should classify same-author quotes via Gemini', async () => {
      const { getSmartRelatedQuotes } = await import('../../src/services/quoteContext.js');

      // Pinecone returns a same-author match
      mockQueryQuotes.mockResolvedValue([
        { id: 'quote_2', score: 0.9, metadata: { quote_id: 2, person_id: 1 } }
      ]);

      // Gemini classifies it as supporting context
      mockGenerateText.mockResolvedValueOnce(JSON.stringify([
        { id: 2, classification: 'supporting_context', confidence: 0.85, explanation: 'Both quotes discuss economic investment' }
      ]));

      const result = await getSmartRelatedQuotes(1);

      expect(result.supportingContext.length).toBe(1);
      expect(result.supportingContext[0].id).toBe(2);
      expect(result.supportingContext[0].explanation).toContain('economic investment');
    });

    it('should handle Gemini failure gracefully for same-author', async () => {
      const { getSmartRelatedQuotes } = await import('../../src/services/quoteContext.js');

      mockQueryQuotes.mockResolvedValue([
        { id: 'quote_2', score: 0.9, metadata: { quote_id: 2, person_id: 1 } }
      ]);

      // Gemini fails
      mockGenerateText.mockRejectedValueOnce(new Error('API error'));

      // Should still return results (fallback to raw Pinecone results)
      const result = await getSmartRelatedQuotes(1);
      expect(result.supportingContext.length).toBeGreaterThanOrEqual(1);
    });

    it('should throw for non-existent quote', async () => {
      const { getSmartRelatedQuotes } = await import('../../src/services/quoteContext.js');
      await expect(getSmartRelatedQuotes(999)).rejects.toThrow('Quote not found');
    });
  });
});
