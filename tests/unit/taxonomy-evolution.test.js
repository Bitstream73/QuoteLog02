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

  // Persons (needed for quotes FK)
  testDb.exec(`
    CREATE TABLE persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL
    )
  `);

  // Quotes table (minimal)
  testDb.exec(`
    CREATE TABLE quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_id INTEGER NOT NULL REFERENCES persons(id),
      text TEXT NOT NULL,
      quote_type TEXT NOT NULL DEFAULT 'direct',
      is_visible INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Quote-keyword association
  testDb.exec(`
    CREATE TABLE quote_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      confidence TEXT NOT NULL DEFAULT 'high' CHECK(confidence IN ('high','medium','low')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(quote_id, keyword_id)
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

function seedTestData() {
  // Insert a person for FK
  testDb.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Test Person');

  // Insert keywords
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Donald Trump', 'donald trump');
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Supreme Court', 'supreme court');

  // Insert quotes
  testDb.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Quote about politics');
  testDb.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Quote about law');
  testDb.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Quote about economy');
}

describe('Taxonomy Evolution', () => {
  beforeEach(() => {
    setupTestDb();
    seedTestData();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  describe('analyzeUnmatchedEntities', () => {
    it('finds frequently occurring unmatched entities', async () => {
      const { analyzeUnmatchedEntities } = await import('../../src/services/taxonomyEvolution.js');

      // Insert 3 ai_extraction suggestions for the same entity (meets >= 3 threshold)
      const now = new Date().toISOString();
      for (let i = 0; i < 3; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending', ?)
        `).run(JSON.stringify({ name: 'Climate Change', type: 'concept' }), now);
      }

      const results = analyzeUnmatchedEntities(7);
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Climate Change');
      expect(results[0].type).toBe('concept');
      expect(results[0].occurrence_count).toBe(3);
    });

    it('ignores entities with fewer than 3 occurrences', async () => {
      const { analyzeUnmatchedEntities } = await import('../../src/services/taxonomyEvolution.js');

      const now = new Date().toISOString();
      // Only 2 occurrences — below threshold
      for (let i = 0; i < 2; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending', ?)
        `).run(JSON.stringify({ name: 'Rare Entity', type: 'person' }), now);
      }

      const results = analyzeUnmatchedEntities(7);
      expect(results).toHaveLength(0);
    });

    it('ignores suggestions outside the lookback window', async () => {
      const { analyzeUnmatchedEntities } = await import('../../src/services/taxonomyEvolution.js');

      // Insert 3 suggestions but with old timestamps (30 days ago)
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 30);
      const oldDateStr = oldDate.toISOString();

      for (let i = 0; i < 3; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending', ?)
        `).run(JSON.stringify({ name: 'Old Entity', type: 'concept' }), oldDateStr);
      }

      const results = analyzeUnmatchedEntities(7);
      expect(results).toHaveLength(0);
    });

    it('ignores non-pending suggestions', async () => {
      const { analyzeUnmatchedEntities } = await import('../../src/services/taxonomyEvolution.js');

      const now = new Date().toISOString();
      for (let i = 0; i < 3; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'approved', ?)
        `).run(JSON.stringify({ name: 'Approved Entity', type: 'concept' }), now);
      }

      const results = analyzeUnmatchedEntities(7);
      expect(results).toHaveLength(0);
    });

    it('returns empty array when no suggestions exist', async () => {
      const { analyzeUnmatchedEntities } = await import('../../src/services/taxonomyEvolution.js');
      const results = analyzeUnmatchedEntities(7);
      expect(results).toHaveLength(0);
    });
  });

  describe('suggestAliasExpansions', () => {
    it('finds keywords with multiple medium-confidence matches', async () => {
      const { suggestAliasExpansions } = await import('../../src/services/taxonomyEvolution.js');

      // Add medium-confidence quote-keyword links (>= 2 for same keyword)
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(1, 1, 'medium');
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(2, 1, 'medium');

      const results = suggestAliasExpansions();
      expect(results).toHaveLength(1);
      expect(results[0].keyword_id).toBe(1);
      expect(results[0].keyword_name).toBe('Donald Trump');
      expect(results[0].match_count).toBe(2);
    });

    it('ignores high-confidence matches', async () => {
      const { suggestAliasExpansions } = await import('../../src/services/taxonomyEvolution.js');

      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(1, 1, 'high');
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(2, 1, 'high');

      const results = suggestAliasExpansions();
      expect(results).toHaveLength(0);
    });

    it('ignores keywords with only one medium-confidence match', async () => {
      const { suggestAliasExpansions } = await import('../../src/services/taxonomyEvolution.js');

      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(1, 1, 'medium');

      const results = suggestAliasExpansions();
      expect(results).toHaveLength(0);
    });

    it('returns empty array when no medium-confidence matches exist', async () => {
      const { suggestAliasExpansions } = await import('../../src/services/taxonomyEvolution.js');
      const results = suggestAliasExpansions();
      expect(results).toHaveLength(0);
    });
  });

  describe('runTaxonomyEvolution', () => {
    it('creates keyword proposals from frequent unmatched entities', async () => {
      const { runTaxonomyEvolution } = await import('../../src/services/taxonomyEvolution.js');

      const now = new Date().toISOString();
      for (let i = 0; i < 4; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending', ?)
        `).run(JSON.stringify({ name: 'European Union', type: 'organization' }), now);
      }

      const results = runTaxonomyEvolution(7);
      expect(results.keywordProposals).toBe(1);

      // Verify the batch_evolution suggestion was created
      const batchSuggestions = testDb.prepare(
        "SELECT * FROM taxonomy_suggestions WHERE source = 'batch_evolution'"
      ).all();
      expect(batchSuggestions).toHaveLength(1);
      expect(batchSuggestions[0].suggestion_type).toBe('new_keyword');

      const data = JSON.parse(batchSuggestions[0].suggested_data);
      expect(data.name).toBe('European Union');
      expect(data.type).toBe('organization');
      expect(data.occurrence_count).toBe(4);
      expect(data.suggested_aliases).toEqual(['European Union']);
    });

    it('creates alias expansion suggestions', async () => {
      const { runTaxonomyEvolution } = await import('../../src/services/taxonomyEvolution.js');

      // Add medium-confidence matches
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(1, 2, 'medium');
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(2, 2, 'medium');
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(3, 2, 'medium');

      const results = runTaxonomyEvolution(7);
      expect(results.aliasExpansions).toBe(1);

      const aliasSuggestions = testDb.prepare(
        "SELECT * FROM taxonomy_suggestions WHERE source = 'batch_evolution' AND suggestion_type = 'keyword_alias'"
      ).all();
      expect(aliasSuggestions).toHaveLength(1);

      const data = JSON.parse(aliasSuggestions[0].suggested_data);
      expect(data.keyword_id).toBe(2);
      expect(data.keyword_name).toBe('Supreme Court');
      expect(data.match_count).toBe(3);
    });

    it('does not create duplicate keyword proposals', async () => {
      const { runTaxonomyEvolution } = await import('../../src/services/taxonomyEvolution.js');

      const now = new Date().toISOString();
      for (let i = 0; i < 3; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending', ?)
        `).run(JSON.stringify({ name: 'NATO Expansion', type: 'event' }), now);
      }

      // First run — creates the proposal
      const results1 = runTaxonomyEvolution(7);
      expect(results1.keywordProposals).toBe(1);

      // Second run — should NOT create a duplicate
      const results2 = runTaxonomyEvolution(7);
      expect(results2.keywordProposals).toBe(0);

      // Verify only 1 batch_evolution suggestion
      const batchSuggestions = testDb.prepare(
        "SELECT * FROM taxonomy_suggestions WHERE source = 'batch_evolution' AND suggestion_type = 'new_keyword'"
      ).all();
      expect(batchSuggestions).toHaveLength(1);
    });

    it('returns zero counts when nothing to process', async () => {
      const { runTaxonomyEvolution } = await import('../../src/services/taxonomyEvolution.js');

      const results = runTaxonomyEvolution(7);
      expect(results.keywordProposals).toBe(0);
      expect(results.aliasExpansions).toBe(0);
    });

    it('handles both proposals and expansions in one run', async () => {
      const { runTaxonomyEvolution } = await import('../../src/services/taxonomyEvolution.js');

      // Unmatched entities (>= 3 occurrences)
      const now = new Date().toISOString();
      for (let i = 0; i < 5; i++) {
        testDb.prepare(`
          INSERT INTO taxonomy_suggestions (suggestion_type, suggested_data, source, status, created_at)
          VALUES ('new_keyword', ?, 'ai_extraction', 'pending', ?)
        `).run(JSON.stringify({ name: 'Gaza Strip', type: 'location' }), now);
      }

      // Medium-confidence matches
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(1, 1, 'medium');
      testDb.prepare('INSERT INTO quote_keywords (quote_id, keyword_id, confidence) VALUES (?, ?, ?)').run(2, 1, 'medium');

      const results = runTaxonomyEvolution(7);
      expect(results.keywordProposals).toBe(1);
      expect(results.aliasExpansions).toBe(1);
    });
  });
});
