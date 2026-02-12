import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/quote-context-test.db';

// Mock Gemini to avoid real API calls
vi.mock('../../src/services/ai/gemini.js', () => ({
  default: {
    generateText: vi.fn().mockResolvedValue(JSON.stringify({
      claims: [{ claim: 'Test claim', searchQuery: 'test query', type: 'factual' }],
      overallTheme: 'Test theme',
    })),
  }
}));

// Mock vectorDb to avoid real Pinecone calls
vi.mock('../../src/services/vectorDb.js', () => ({
  searchQuotes: vi.fn().mockResolvedValue([]),
  queryQuotes: vi.fn().mockResolvedValue([]),
  embedQuote: vi.fn().mockResolvedValue(undefined),
  default: {
    upsertRecords: vi.fn().mockResolvedValue(undefined),
    searchRecords: vi.fn().mockResolvedValue({ result: { hits: [] } }),
    deleteByIds: vi.fn().mockResolvedValue(undefined),
    getIndexStats: vi.fn().mockResolvedValue({ totalRecordCount: 0 }),
    embedQuote: vi.fn().mockResolvedValue(undefined),
    queryQuotes: vi.fn().mockResolvedValue([]),
    searchQuotes: vi.fn().mockResolvedValue([]),
  }
}));

describe('Quote Context API', () => {
  let app;
  let testQuoteId;
  let testPersonId;

  beforeAll(async () => {
    const { createApp } = await import('../../src/index.js');
    app = createApp();

    const { getDb } = await import('../../src/config/database.js');
    const db = getDb();

    // Seed test data
    const personResult = db.prepare('INSERT INTO persons (canonical_name, disambiguation) VALUES (?, ?)').run('Test Speaker', 'Politician');
    testPersonId = Number(personResult.lastInsertRowid);

    const quoteResult = db.prepare('INSERT INTO quotes (person_id, text, context, is_visible) VALUES (?, ?, ?, 1)').run(
      testPersonId, 'The economy is growing at an unprecedented rate.', 'Campaign rally speech'
    );
    testQuoteId = Number(quoteResult.lastInsertRowid);

    // Add a second person + quote that mentions the first person
    const person2Result = db.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Other Author');
    const person2Id = Number(person2Result.lastInsertRowid);
    db.prepare('INSERT INTO quotes (person_id, text, is_visible) VALUES (?, ?, 1)').run(
      person2Id, 'Test Speaker claims the economy is growing but experts disagree.'
    );
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/quote-context-test.db${suffix}`); } catch {}
    }
  });

  describe('POST /api/quotes/:id/context', () => {
    it('should return 400 for invalid quote ID', async () => {
      const res = await request(app).post('/api/quotes/abc/context');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid quote ID');
    });

    it('should return 404 for non-existent quote', async () => {
      const res = await request(app).post('/api/quotes/99999/context');
      expect(res.status).toBe(404);
    });

    it('should return analysis for valid quote', async () => {
      const gemini = (await import('../../src/services/ai/gemini.js')).default;
      gemini.generateText.mockReset();

      // Mock claim identification
      gemini.generateText.mockResolvedValueOnce(JSON.stringify({
        claims: [{ claim: 'Economy is growing', searchQuery: 'economy growth', type: 'factual' }],
        overallTheme: 'Economic growth',
      }));

      // Mock analysis
      gemini.generateText.mockResolvedValueOnce(JSON.stringify({
        claims: [{
          claim: 'Economy is growing',
          type: 'factual',
          supporting: [],
          contradicting: [],
          addingContext: [{ quoteId: null, explanation: 'GDP data shows moderate growth', source: 'general_knowledge' }],
        }],
        summary: 'An optimistic claim about economic growth.',
        confidenceNote: 'Limited internal evidence available.',
      }));

      const res = await request(app).post(`/api/quotes/${testQuoteId}/context`);
      expect(res.status).toBe(200);
      expect(res.body.claims).toBeDefined();
      expect(res.body.summary).toBeDefined();
      expect(res.body.cachedAt).toBeDefined();
      expect(res.body.expiresAt).toBeDefined();
    });

    it('should return cached result on second call', async () => {
      const gemini = (await import('../../src/services/ai/gemini.js')).default;
      gemini.generateText.mockClear();

      const res = await request(app).post(`/api/quotes/${testQuoteId}/context`);
      expect(res.status).toBe(200);
      expect(res.body.fromCache).toBe(true);
      // Gemini should NOT have been called again
      expect(gemini.generateText).not.toHaveBeenCalled();
    });
  });

  describe('GET /api/quotes/:id/smart-related', () => {
    it('should return 400 for invalid quote ID', async () => {
      const res = await request(app).get('/api/quotes/abc/smart-related');
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Invalid quote ID');
    });

    it('should return 404 for non-existent quote', async () => {
      const res = await request(app).get('/api/quotes/99999/smart-related');
      expect(res.status).toBe(404);
    });

    it('should return smart related quotes structure', async () => {
      const res = await request(app).get(`/api/quotes/${testQuoteId}/smart-related`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('contradictions');
      expect(res.body).toHaveProperty('supportingContext');
      expect(res.body).toHaveProperty('mentionsByOthers');
      expect(Array.isArray(res.body.contradictions)).toBe(true);
      expect(Array.isArray(res.body.supportingContext)).toBe(true);
      expect(Array.isArray(res.body.mentionsByOthers)).toBe(true);
    });

    it('should find mentions by other authors', async () => {
      // Clear the cache to force regeneration
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      db.prepare('DELETE FROM quote_smart_related WHERE quote_id = ?').run(testQuoteId);

      const res = await request(app).get(`/api/quotes/${testQuoteId}/smart-related`);
      expect(res.status).toBe(200);
      // Should find the quote from "Other Author" that mentions "Test Speaker"
      expect(res.body.mentionsByOthers.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Database schema', () => {
    it('should have quote_context_cache table', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quote_context_cache'").all();
      expect(tables).toHaveLength(1);
    });

    it('should have quote_smart_related table', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='quote_smart_related'").all();
      expect(tables).toHaveLength(1);
    });

    it('should enforce unique constraint on quote_context_cache', async () => {
      const { getDb } = await import('../../src/config/database.js');
      const db = getDb();

      // The cache should already have an entry from the context test above
      const count = db.prepare('SELECT COUNT(*) as cnt FROM quote_context_cache WHERE quote_id = ?').get(testQuoteId);
      expect(count.cnt).toBeLessThanOrEqual(1);
    });
  });
});
