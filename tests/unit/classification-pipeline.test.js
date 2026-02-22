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

  // Topics table
  testDb.exec(`
    CREATE TABLE topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','draft')),
      start_date TEXT,
      end_date TEXT,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Topic-keyword association
  testDb.exec(`
    CREATE TABLE topic_keywords (
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
      PRIMARY KEY (topic_id, keyword_id)
    )
  `);

  // Persons (needed for quotes FK)
  testDb.exec(`
    CREATE TABLE persons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      canonical_name TEXT NOT NULL
    )
  `);

  // Quotes table (minimal, needed for FK)
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

  // Quote-topic association
  testDb.exec(`
    CREATE TABLE quote_topics (
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      PRIMARY KEY (quote_id, topic_id)
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

  // Topic aliases
  testDb.exec(`
    CREATE TABLE topic_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      alias_normalized TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(topic_id, alias)
    )
  `);
}

function seedData() {
  // Insert keywords
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Donald Trump', 'donald trump');
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Supreme Court', 'supreme court');
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('NATO', 'nato');

  // Insert aliases
  testDb.prepare('INSERT INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)').run(1, 'Trump', 'trump');
  testDb.prepare('INSERT INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)').run(2, 'SCOTUS', 'scotus');

  // Insert topics
  testDb.prepare('INSERT INTO topics (name, slug, status) VALUES (?, ?, ?)').run('U.S. Politics', 'us-politics', 'active');
  testDb.prepare('INSERT INTO topics (name, slug, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)').run(
    '2024 Election', '2024-election', 'active', '2024-01-01', '2024-12-31'
  );

  // Link keywords to topics
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(1, 1); // Trump -> U.S. Politics
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(2, 1); // Trump -> 2024 Election
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(1, 2); // Supreme Court -> U.S. Politics

  // Insert a person and quote
  testDb.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Test Speaker');
  testDb.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'This is a test quote about politics');
}

describe('Classification Pipeline', () => {
  beforeEach(() => {
    setupTestDb();
    seedData();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  describe('classifyQuote', () => {
    it('matches entities, stores keywords, and resolves topics', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', [
        { name: 'Donald Trump', type: 'person' },
        { name: 'Supreme Court', type: 'organization' },
      ]);

      // Should match both entities
      expect(result.matched).toHaveLength(2);
      expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
      expect(result.matched[1].keyword.keyword_name).toBe('Supreme Court');
      expect(result.unmatched).toHaveLength(0);

      // Should store quote_keywords
      const qk = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = 1').all();
      expect(qk).toHaveLength(2);
      const kwIds = qk.map(r => r.keyword_id).sort();
      expect(kwIds).toEqual([1, 2]);

      // Should resolve topics (Trump -> U.S. Politics + 2024 Election, Supreme Court -> U.S. Politics)
      const qt = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(qt.length).toBeGreaterThanOrEqual(2);
      const topicIds = qt.map(r => r.topic_id).sort();
      expect(topicIds).toContain(1); // U.S. Politics
      expect(topicIds).toContain(2); // 2024 Election
    });

    it('queues unmatched entities as taxonomy suggestions', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', [
        { name: 'Climate Change', type: 'concept' },
        { name: 'European Union', type: 'organization' },
      ]);

      // No keywords match these entities
      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(2);

      // Should create taxonomy suggestions
      const suggestions = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(suggestions).toHaveLength(2);
      expect(suggestions[0].suggestion_type).toBe('new_keyword');
      expect(suggestions[0].source).toBe('ai_extraction');
      expect(suggestions[0].status).toBe('pending');

      const data0 = JSON.parse(suggestions[0].suggested_data);
      expect(data0.name).toBe('Climate Change');

      // No quote_keywords or quote_topics should be created
      const qk = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = 1').all();
      expect(qk).toHaveLength(0);
      const qt = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(qt).toHaveLength(0);
    });

    it('returns empty results for empty entities array', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', []);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
      expect(result.flagged).toHaveLength(0);
      expect(result.topicsAssigned).toBe(0);

      // No side effects
      const qk = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = 1').all();
      expect(qk).toHaveLength(0);
      const suggestions = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(suggestions).toHaveLength(0);
    });

    it('returns empty results for null entities', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', null);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
      expect(result.flagged).toHaveLength(0);
      expect(result.topicsAssigned).toBe(0);
    });

    it('returns empty results for undefined entities', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', undefined);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
      expect(result.flagged).toHaveLength(0);
      expect(result.topicsAssigned).toBe(0);
    });

    it('correctly applies temporal scoping for topic resolution', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      // Use a date outside the 2024 Election range
      const result = classifyQuote(1, '2023-06-15', [
        { name: 'Donald Trump', type: 'person' },
      ]);

      expect(result.matched).toHaveLength(1);

      // Should only link to U.S. Politics (no date range), not 2024 Election (out of range)
      const qt = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(qt).toHaveLength(1);
      expect(qt[0].topic_id).toBe(1); // U.S. Politics only
    });

    it('handles mix of matched and unmatched entities', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', [
        { name: 'Trump', type: 'person' },         // matches via alias
        { name: 'Climate Change', type: 'concept' }, // unmatched
      ]);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0].entity.name).toBe('Climate Change');

      // Should store keyword for matched
      const qk = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = 1').all();
      expect(qk).toHaveLength(1);

      // Should create suggestion for unmatched
      const suggestions = testDb.prepare('SELECT * FROM taxonomy_suggestions').all();
      expect(suggestions).toHaveLength(1);
      const data = JSON.parse(suggestions[0].suggested_data);
      expect(data.name).toBe('Climate Change');
    });

    it('populates flagged array for medium-confidence fuzzy matches', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      // "Imigration Reform" is close enough to potentially match fuzzy
      testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Immigration Reform', 'immigration reform');

      const result = classifyQuote(1, '2024-06-15', [
        { name: 'Imigration Reform', type: 'concept' },
      ]);

      // Depending on Jaro-Winkler score, may be matched (medium) or unmatched
      const total = result.matched.length + result.unmatched.length;
      expect(total).toBe(1);

      // If matched with medium confidence, should appear in flagged
      if (result.matched.length > 0 && result.matched[0].confidence === 'medium') {
        expect(result.flagged).toHaveLength(1);
      }
    });

    it('classifyQuote with topics matches and links directly', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', [
        { name: 'Donald Trump', type: 'person' },
      ], ['U.S. Politics']);

      expect(result.matched).toHaveLength(1);

      // Topic linked directly via topic name match
      const qt = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      const topicIds = qt.map(r => r.topic_id);
      expect(topicIds).toContain(1); // U.S. Politics
    });

    it('classifyQuote with topics queues unmatched topics', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      classifyQuote(1, '2024-06-15', [
        { name: 'Donald Trump', type: 'person' },
      ], ['Nonexistent Topic']);

      const suggestions = testDb.prepare("SELECT * FROM taxonomy_suggestions WHERE suggestion_type = 'new_topic'").all();
      expect(suggestions).toHaveLength(1);
      const data = JSON.parse(suggestions[0].suggested_data);
      expect(data.name).toBe('Nonexistent Topic');
    });

    it('classifyQuote without topics param works unchanged (backward compat)', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', [
        { name: 'Donald Trump', type: 'person' },
      ]);

      expect(result.matched).toHaveLength(1);

      // No new_topic suggestions created
      const suggestions = testDb.prepare("SELECT * FROM taxonomy_suggestions WHERE suggestion_type = 'new_topic'").all();
      expect(suggestions).toHaveLength(0);
    });

    it('classifyQuote processes topics even with empty entities', async () => {
      const { classifyQuote } = await import('../../src/services/classificationPipeline.js');

      const result = classifyQuote(1, '2024-06-15', [], ['U.S. Politics']);

      expect(result.matched).toHaveLength(0);

      // Topic should still be linked
      const qt = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(qt).toHaveLength(1);
      expect(qt[0].topic_id).toBe(1);
    });
  });
});
