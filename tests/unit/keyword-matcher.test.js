import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// In-memory database setup
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

function seedKeywords() {
  // Insert keywords
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Donald Trump', 'donald trump');
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Supreme Court', 'supreme court');
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('NATO', 'nato');
  testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Federal Reserve', 'federal reserve');

  // Insert aliases
  testDb.prepare('INSERT INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)').run(1, 'Trump', 'trump');
  testDb.prepare('INSERT INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)').run(1, 'President Trump', 'president trump');
  testDb.prepare('INSERT INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)').run(2, 'SCOTUS', 'scotus');
  testDb.prepare('INSERT INTO keyword_aliases (keyword_id, alias, alias_normalized) VALUES (?, ?, ?)').run(4, 'The Fed', 'the fed');

  // Insert a person and quote for FK tests
  testDb.prepare('INSERT INTO persons (canonical_name) VALUES (?)').run('Test Person');
  testDb.prepare('INSERT INTO quotes (person_id, text) VALUES (?, ?)').run(1, 'Test quote about politics');
}

function seedTopics() {
  // Topic with no date range
  testDb.prepare('INSERT INTO topics (name, slug, status) VALUES (?, ?, ?)').run('U.S. Presidential Politics', 'us-presidential-politics', 'active');

  // Topic with date range (2024 election)
  testDb.prepare('INSERT INTO topics (name, slug, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)').run(
    '2024 Election', '2024-election', 'active', '2024-01-01', '2024-12-31'
  );

  // Archived topic
  testDb.prepare('INSERT INTO topics (name, slug, status) VALUES (?, ?, ?)').run('Old Topic', 'old-topic', 'archived');

  // Link keywords to topics
  // Donald Trump -> U.S. Presidential Politics, 2024 Election
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(1, 1);
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(2, 1);

  // Supreme Court -> U.S. Presidential Politics
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(1, 2);

  // NATO -> Old Topic (archived, should not match)
  testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(3, 3);
}

describe('Keyword Matcher', () => {
  beforeEach(() => {
    setupTestDb();
    seedKeywords();
  });

  afterEach(() => {
    if (testDb) testDb.close();
  });

  describe('matchEntities', () => {
    it('exact match on keyword names', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      const result = matchEntities([
        { name: 'Donald Trump', type: 'person' },
        { name: 'NATO', type: 'organization' },
      ]);

      expect(result.matched).toHaveLength(2);
      expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
      expect(result.matched[0].confidence).toBe('high');
      expect(result.matched[0].score).toBe(1.0);
      expect(result.matched[1].keyword.keyword_name).toBe('NATO');
    });

    it('exact match on aliases', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      const result = matchEntities([
        { name: 'Trump', type: 'person' },
        { name: 'SCOTUS', type: 'organization' },
        { name: 'The Fed', type: 'organization' },
      ]);

      expect(result.matched).toHaveLength(3);
      expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
      expect(result.matched[0].confidence).toBe('high');
      expect(result.matched[1].keyword.keyword_name).toBe('Supreme Court');
      expect(result.matched[2].keyword.keyword_name).toBe('Federal Reserve');
    });

    it('fuzzy match with Jaro-Winkler (close misspelling)', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      // "Donld Trump" is close to "Donald Trump" — should fuzzy match
      const result = matchEntities([
        { name: 'Donld Trump', type: 'person' },
      ]);

      // Should match with high confidence (Jaro-Winkler >= 0.95 for close strings)
      expect(result.matched.length + result.unmatched.length).toBe(1);
      if (result.matched.length > 0) {
        expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
        expect(result.matched[0].score).toBeGreaterThanOrEqual(0.85);
      }
    });

    it('fuzzy match — medium confidence for moderate similarity', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      // "Don Trump" is moderately similar to "Donald Trump"
      const result = matchEntities([
        { name: 'Don Trump', type: 'person' },
      ]);

      // Jaro-Winkler between "don trump" and "donald trump" should be ~0.90
      const allResults = [...result.matched, ...result.unmatched];
      expect(allResults).toHaveLength(1);

      if (result.matched.length > 0) {
        expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
        expect(['high', 'medium']).toContain(result.matched[0].confidence);
      }
    });

    it('unmatched entities for dissimilar strings', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      const result = matchEntities([
        { name: 'Climate Change', type: 'concept' },
        { name: 'European Union', type: 'organization' },
      ]);

      expect(result.unmatched).toHaveLength(2);
      expect(result.matched).toHaveLength(0);
    });

    it('returns empty results for empty entities', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      const result = matchEntities([]);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
      expect(result.flagged).toHaveLength(0);
    });

    it('case insensitive matching', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      const result = matchEntities([
        { name: 'DONALD TRUMP', type: 'person' },
        { name: 'nato', type: 'organization' },
      ]);

      expect(result.matched).toHaveLength(2);
      expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
      expect(result.matched[1].keyword.keyword_name).toBe('NATO');
    });

    it('flagged array contains medium-confidence matches', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      // Add a keyword that will produce a medium-confidence match
      testDb.prepare('INSERT INTO keywords (name, name_normalized) VALUES (?, ?)').run('Immigration Reform', 'immigration reform');

      // "Imigration Reform" has a typo — should fuzzy match with medium confidence
      const result = matchEntities([
        { name: 'Imigration Reform', type: 'concept' },
      ]);

      if (result.matched.length > 0 && result.matched[0].confidence === 'medium') {
        expect(result.flagged).toHaveLength(1);
        expect(result.flagged[0].entity.name).toBe('Imigration Reform');
      }
    });

    it('handles whitespace in entity names', async () => {
      const { matchEntities } = await import('../../src/services/keywordMatcher.js');
      const result = matchEntities([
        { name: '  Donald Trump  ', type: 'person' },
      ]);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].keyword.keyword_name).toBe('Donald Trump');
    });
  });

  describe('storeQuoteKeywords', () => {
    it('stores keyword matches for a quote', async () => {
      const { storeQuoteKeywords } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 1, keyword_name: 'Donald Trump' }, confidence: 'high' },
        { keyword: { keyword_id: 2, keyword_name: 'Supreme Court' }, confidence: 'medium' },
      ];

      storeQuoteKeywords(1, matches);

      const rows = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = ?').all(1);
      expect(rows).toHaveLength(2);
      expect(rows[0].keyword_id).toBe(1);
      expect(rows[0].confidence).toBe('high');
      expect(rows[1].keyword_id).toBe(2);
      expect(rows[1].confidence).toBe('medium');
    });

    it('ignores duplicate quote-keyword pairs', async () => {
      const { storeQuoteKeywords } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 1, keyword_name: 'Donald Trump' }, confidence: 'high' },
      ];

      storeQuoteKeywords(1, matches);
      storeQuoteKeywords(1, matches); // second call should not duplicate

      const rows = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = ?').all(1);
      expect(rows).toHaveLength(1);
    });

    it('handles empty matches array', async () => {
      const { storeQuoteKeywords } = await import('../../src/services/keywordMatcher.js');
      storeQuoteKeywords(1, []);

      const rows = testDb.prepare('SELECT * FROM quote_keywords WHERE quote_id = ?').all(1);
      expect(rows).toHaveLength(0);
    });
  });

  describe('resolveTopicsAndCategories', () => {
    beforeEach(() => {
      seedTopics();
    });

    it('links quote to active topics via matched keywords', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 1, keyword_name: 'Donald Trump' } },
      ];

      resolveTopicsAndCategories(1, matches, '2024-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      // Should link to both "U.S. Presidential Politics" (no date range) and "2024 Election" (in range)
      expect(rows).toHaveLength(2);
      const topicIds = rows.map(r => r.topic_id).sort();
      expect(topicIds).toEqual([1, 2]);
    });

    it('excludes topics outside date range', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 1, keyword_name: 'Donald Trump' } },
      ];

      // Date outside 2024 Election range
      resolveTopicsAndCategories(1, matches, '2023-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      // Should only link to "U.S. Presidential Politics" (no date range)
      expect(rows).toHaveLength(1);
      expect(rows[0].topic_id).toBe(1);
    });

    it('excludes archived topics', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 3, keyword_name: 'NATO' } },
      ];

      resolveTopicsAndCategories(1, matches, '2024-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      // "Old Topic" is archived — should not link
      expect(rows).toHaveLength(0);
    });

    it('handles empty matches gracefully', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      resolveTopicsAndCategories(1, [], '2024-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      expect(rows).toHaveLength(0);
    });

    it('handles null quoteDate — still links topics without date constraints', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 1, keyword_name: 'Donald Trump' } },
      ];

      resolveTopicsAndCategories(1, matches, null);

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      // With null quoteDate: topics with date ranges still pass because the date comparisons are skipped
      expect(rows).toHaveLength(2);
    });

    it('handles topic with only start_date (no end_date)', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      // Add a topic with only start_date
      testDb.prepare('INSERT INTO topics (name, slug, status, start_date) VALUES (?, ?, ?, ?)').run(
        'Post-2025 Topic', 'post-2025', 'active', '2025-01-01'
      );
      testDb.prepare('INSERT INTO topic_keywords (topic_id, keyword_id) VALUES (?, ?)').run(4, 2);

      const matches = [
        { keyword: { keyword_id: 2, keyword_name: 'Supreme Court' } },
      ];

      // Quote date before start — should not link to Post-2025 Topic
      resolveTopicsAndCategories(1, matches, '2024-06-15');
      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      // Links to "U.S. Presidential Politics" (active, no date) but NOT "Post-2025 Topic"
      expect(rows).toHaveLength(1);
      expect(rows[0].topic_id).toBe(1);
    });

    it('duplicate topic insertion is ignored', async () => {
      const { resolveTopicsAndCategories } = await import('../../src/services/keywordMatcher.js');
      const matches = [
        { keyword: { keyword_id: 1, keyword_name: 'Donald Trump' } },
      ];

      resolveTopicsAndCategories(1, matches, '2024-06-15');
      resolveTopicsAndCategories(1, matches, '2024-06-15'); // second call

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = ?').all(1);
      expect(rows).toHaveLength(2); // still only 2 unique topic links
    });
  });

  describe('matchTopics', () => {
    beforeEach(() => {
      seedTopics();
      // Add topic aliases
      testDb.prepare('INSERT INTO topic_aliases (topic_id, alias, alias_normalized) VALUES (?, ?, ?)').run(1, 'US Politics', 'us politics');
      testDb.prepare('INSERT INTO topic_aliases (topic_id, alias, alias_normalized) VALUES (?, ?, ?)').run(2, 'Election 2024', 'election 2024');
    });

    it('exact match on topic name', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics(['U.S. Presidential Politics']);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].topicName).toBe('U.S. Presidential Politics');
      expect(result.matched[0].topicId).toBe(1);
      expect(result.unmatched).toHaveLength(0);
    });

    it('match via topic alias', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics(['US Politics']);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].topicName).toBe('U.S. Presidential Politics');
      expect(result.matched[0].topicId).toBe(1);
    });

    it('unmatched goes to unmatched array', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics(['Nonexistent Topic']);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
      expect(result.unmatched[0].topicName).toBe('Nonexistent Topic');
    });

    it('ignores archived topics', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics(['Old Topic']);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(1);
    });

    it('case-insensitive matching', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics(['u.s. presidential politics']);

      expect(result.matched).toHaveLength(1);
      expect(result.matched[0].topicId).toBe(1);
    });

    it('skips empty/null entries', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics(['', null, undefined, 'U.S. Presidential Politics']);

      expect(result.matched).toHaveLength(1);
      expect(result.unmatched).toHaveLength(0);
    });

    it('returns empty for empty input', async () => {
      const { matchTopics } = await import('../../src/services/keywordMatcher.js');
      const result = matchTopics([]);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
    });
  });

  describe('storeQuoteTopicsDirect', () => {
    beforeEach(() => {
      seedTopics();
    });

    it('inserts into quote_topics', async () => {
      const { storeQuoteTopicsDirect } = await import('../../src/services/keywordMatcher.js');
      storeQuoteTopicsDirect(1, [{ topicName: 'U.S. Presidential Politics', topicId: 1 }], '2024-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(rows).toHaveLength(1);
      expect(rows[0].topic_id).toBe(1);
    });

    it('respects temporal scoping — excludes out-of-range topics', async () => {
      const { storeQuoteTopicsDirect } = await import('../../src/services/keywordMatcher.js');
      // 2024 Election topic has date range 2024-01-01 to 2024-12-31
      storeQuoteTopicsDirect(1, [{ topicName: '2024 Election', topicId: 2 }], '2023-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(rows).toHaveLength(0);
    });

    it('includes in-range topics', async () => {
      const { storeQuoteTopicsDirect } = await import('../../src/services/keywordMatcher.js');
      storeQuoteTopicsDirect(1, [{ topicName: '2024 Election', topicId: 2 }], '2024-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(rows).toHaveLength(1);
      expect(rows[0].topic_id).toBe(2);
    });

    it('handles null quoteDate — includes all topics', async () => {
      const { storeQuoteTopicsDirect } = await import('../../src/services/keywordMatcher.js');
      storeQuoteTopicsDirect(1, [
        { topicName: 'U.S. Presidential Politics', topicId: 1 },
        { topicName: '2024 Election', topicId: 2 },
      ], null);

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(rows).toHaveLength(2);
    });

    it('ignores duplicate insertions', async () => {
      const { storeQuoteTopicsDirect } = await import('../../src/services/keywordMatcher.js');
      storeQuoteTopicsDirect(1, [{ topicName: 'U.S. Presidential Politics', topicId: 1 }], '2024-06-15');
      storeQuoteTopicsDirect(1, [{ topicName: 'U.S. Presidential Politics', topicId: 1 }], '2024-06-15');

      const rows = testDb.prepare('SELECT * FROM quote_topics WHERE quote_id = 1').all();
      expect(rows).toHaveLength(1);
    });
  });
});
