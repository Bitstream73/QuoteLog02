import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb;

vi.mock('../../src/config/database.js', () => ({
  getDb: () => testDb,
}));

function setupTestDb() {
  testDb = new Database(':memory:');
  testDb.pragma('journal_mode = WAL');
  testDb.pragma('foreign_keys = ON');

  // Keywords table
  testDb.exec(`
    CREATE TABLE keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      name_normalized TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Keyword aliases table
  testDb.exec(`
    CREATE TABLE keyword_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(keyword_id, alias)
    )
  `);

  // Taxonomy suggestions table
  testDb.exec(`
    CREATE TABLE taxonomy_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      suggestion_type TEXT NOT NULL CHECK(suggestion_type IN ('new_keyword','new_topic','keyword_alias','topic_keyword','topic_alias')),
      suggested_data TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('ai_extraction','batch_evolution','confidence_review')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','edited')),
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

describe('Unmatched Entity Handler', () => {
  beforeEach(() => {
    setupTestDb();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  describe('queueUnmatchedEntities', () => {
    it('creates taxonomy suggestions for unmatched entities', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      const unmatched = [
        {
          entity: { name: 'Climate Change', type: 'concept' },
          bestMatch: { keyword_name: 'Climate Policy' },
          bestScore: 0.72,
        },
        {
          entity: { name: 'European Union', type: 'organization' },
          bestMatch: null,
          bestScore: 0,
        },
      ];

      queueUnmatchedEntities(unmatched);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(2);

      expect(rows[0].suggestion_type).toBe('new_keyword');
      expect(rows[0].source).toBe('ai_extraction');
      expect(rows[0].status).toBe('pending');

      const data0 = JSON.parse(rows[0].suggested_data);
      expect(data0.name).toBe('Climate Change');
      expect(data0.type).toBe('concept');
      expect(data0.closest_match.keyword_name).toBe('Climate Policy');
      expect(data0.closest_match.score).toBe(0.72);
      expect(data0.suggested_aliases).toEqual(['Climate Change']);

      const data1 = JSON.parse(rows[1].suggested_data);
      expect(data1.name).toBe('European Union');
      expect(data1.closest_match).toBeNull();
    });

    it('skips duplicate pending suggestions with the same name', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      const entity = {
        entity: { name: 'Cornwall Insight', type: 'keyword' },
        bestMatch: null,
        bestScore: 0,
      };

      // Queue twice
      queueUnmatchedEntities([entity]);
      queueUnmatchedEntities([entity]);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(1);
    });

    it('skips duplicate pending suggestions case-insensitively', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      queueUnmatchedEntities([
        { entity: { name: 'Climate Change', type: 'concept' }, bestMatch: null, bestScore: 0 },
      ]);
      queueUnmatchedEntities([
        { entity: { name: 'climate change', type: 'concept' }, bestMatch: null, bestScore: 0 },
      ]);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(1);
    });

    it('allows suggestion after previous one was rejected', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      const entity = {
        entity: { name: 'New Entity', type: 'keyword' },
        bestMatch: null,
        bestScore: 0,
      };

      queueUnmatchedEntities([entity]);
      // Reject it
      testDb.prepare("UPDATE taxonomy_suggestions SET status = 'rejected'").run();

      // Queue again — should create a new one since previous was rejected
      queueUnmatchedEntities([entity]);

      const rows = testDb.prepare("SELECT * FROM taxonomy_suggestions WHERE status = 'pending'").all();
      expect(rows).toHaveLength(1);
    });

    it('skips entities that already exist as keywords', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      // Add existing keyword
      testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('NATO', 'nato');

      queueUnmatchedEntities([
        { entity: { name: 'NATO', type: 'organization' }, bestMatch: null, bestScore: 0 },
      ]);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(0);
    });

    it('deduplicates within a single batch', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      queueUnmatchedEntities([
        { entity: { name: 'Same Entity', type: 'keyword' }, bestMatch: null, bestScore: 0 },
        { entity: { name: 'Same Entity', type: 'keyword' }, bestMatch: null, bestScore: 0 },
      ]);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(1);
    });

    it('does nothing for empty array', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      queueUnmatchedEntities([]);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(0);
    });

    it('does nothing for null/undefined input', async () => {
      const { queueUnmatchedEntities } = await import('../../src/services/unmatchedEntityHandler.js');

      queueUnmatchedEntities(null);
      queueUnmatchedEntities(undefined);

      const rows = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(rows).toHaveLength(0);
    });
  });

  describe('getSuggestions', () => {
    it('returns pending suggestions by default', async () => {
      const { getSuggestions } = await import('../../src/services/unmatchedEntityHandler.js');

      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', '{"name":"Test1"}', 'ai_extraction', 'pending')
      `).run();
      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', '{"name":"Test2"}', 'ai_extraction', 'approved')
      `).run();

      const results = getSuggestions();
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0].suggested_data).name).toBe('Test1');
    });

    it('filters by suggestion_type', async () => {
      const { getSuggestions } = await import('../../src/services/unmatchedEntityHandler.js');

      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', '{"name":"Keyword1"}', 'ai_extraction', 'pending')
      `).run();
      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_topic', '{"name":"Topic1"}', 'batch_evolution', 'pending')
      `).run();

      const results = getSuggestions({ type: 'new_keyword' });
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0].suggested_data).name).toBe('Keyword1');
    });

    it('filters by status', async () => {
      const { getSuggestions } = await import('../../src/services/unmatchedEntityHandler.js');

      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', '{"name":"Rejected1"}', 'ai_extraction', 'rejected')
      `).run();

      const results = getSuggestions({ status: 'rejected' });
      expect(results).toHaveLength(1);
      expect(JSON.parse(results[0].suggested_data).name).toBe('Rejected1');
    });

    it('respects limit and offset', async () => {
      const { getSuggestions } = await import('../../src/services/unmatchedEntityHandler.js');

      for (let i = 0; i < 5; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending')
        `).run(JSON.stringify({ name: `Item${i}` }));
      }

      const page1 = getSuggestions({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = getSuggestions({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(2);

      const page3 = getSuggestions({ limit: 2, offset: 4 });
      expect(page3).toHaveLength(1);
    });
  });

  describe('approveSuggestion', () => {
    it('creates keyword and aliases when approved', async () => {
      const { approveSuggestion } = await import('../../src/services/unmatchedEntityHandler.js');

      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', ?, 'ai_extraction', 'pending')
      `).run(JSON.stringify({
        name: 'Climate Change',
        type: 'concept',
        suggested_aliases: ['Climate Change', 'Global Warming'],
      }));

      approveSuggestion(1);

      // Keyword created
      const keyword = testDb.prepare('SELECT * FROM keywords WHERE name = ?').get('Climate Change');
      expect(keyword).toBeTruthy();
      expect(keyword.name_normalized).toBe('climate change');

      // Aliases created
      const aliases = testDb.prepare('SELECT * FROM keyword_aliases WHERE keyword_id = ?').all(keyword.id);
      expect(aliases).toHaveLength(2);
      const aliasNames = aliases.map(a => a.alias).sort();
      expect(aliasNames).toEqual(['Climate Change', 'Global Warming']);

      // Suggestion marked approved
      const suggestion = testDb.prepare('SELECT * FROM taxonomy_suggestions WHERE id = 1').get();
      expect(suggestion.status).toBe('approved');
      expect(suggestion.reviewed_at).toBeTruthy();
    });

    it('uses edited data when provided', async () => {
      const { approveSuggestion } = await import('../../src/services/unmatchedEntityHandler.js');

      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', ?, 'ai_extraction', 'pending')
      `).run(JSON.stringify({
        name: 'Climte Change',
        type: 'concept',
        suggested_aliases: ['Climte Change'],
      }));

      // Admin corrects the typo
      approveSuggestion(1, {
        name: 'Climate Change',
        suggested_aliases: ['Climate Change'],
      });

      const keyword = testDb.prepare('SELECT * FROM keywords WHERE name = ?').get('Climate Change');
      expect(keyword).toBeTruthy();

      const suggestion = testDb.prepare('SELECT * FROM taxonomy_suggestions WHERE id = 1').get();
      expect(suggestion.status).toBe('edited');
    });

    it('throws for non-existent suggestion', async () => {
      const { approveSuggestion } = await import('../../src/services/unmatchedEntityHandler.js');

      expect(() => approveSuggestion(999)).toThrow('Suggestion not found');
    });
  });

  describe('rejectSuggestion', () => {
    it('marks suggestion as rejected', async () => {
      const { rejectSuggestion } = await import('../../src/services/unmatchedEntityHandler.js');

      testDb.prepare(`
        INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status)
        VALUES ('new_keyword', '{"name":"Test"}', 'ai_extraction', 'pending')
      `).run();

      rejectSuggestion(1);

      const suggestion = testDb.prepare('SELECT * FROM taxonomy_suggestions WHERE id = 1').get();
      expect(suggestion.status).toBe('rejected');
      expect(suggestion.reviewed_at).toBeTruthy();
    });
  });
});
