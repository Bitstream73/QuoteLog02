import { describe, it, expect, beforeAll, afterAll } from 'vitest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = './tests/noteworthy-evaluator-test.db';

describe('Noteworthy Evaluator', () => {
  let db, evaluator;

  beforeAll(async () => {
    const { closeDb, getDb } = await import('../../src/config/database.js');
    closeDb();
    db = getDb();
    evaluator = await import('../../src/services/noteworthyEvaluator.js');

    // Seed test data
    db.exec(`INSERT OR IGNORE INTO persons (id, canonical_name, photo_url, category, category_context, quote_count, importants_count)
      VALUES (1, 'Test Author A', 'https://example.com/a.jpg', 'Politician', 'US Senator', 5, 10),
             (2, 'Test Author B', 'https://example.com/b.jpg', 'Journalist', 'CNN Reporter', 3, 5)`);

    // Insert recent quotes (within last hour)
    const recentDate = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    db.exec(`INSERT OR IGNORE INTO quotes (id, text, person_id, is_visible, importants_count, created_at, canonical_quote_id)
      VALUES (1, 'Quote one', 1, 1, 10, '${recentDate}', NULL),
             (2, 'Quote two', 1, 1, 5, '${recentDate}', NULL),
             (3, 'Quote three', 2, 1, 8, '${recentDate}', NULL),
             (4, 'Quote four', 2, 1, 3, '${recentDate}', NULL),
             (5, 'Old quote', 1, 1, 100, '2020-01-01T00:00:00Z', NULL)`);

    // Seed topics and categories
    db.exec(`INSERT OR IGNORE INTO topics (id, name, slug) VALUES (1, 'Economy', 'economy')`);
    db.exec(`INSERT OR IGNORE INTO categories (id, name, slug) VALUES (1, 'Politics', 'politics')`);
    db.exec(`INSERT OR IGNORE INTO category_topics (category_id, topic_id) VALUES (1, 1)`);
    db.exec(`INSERT OR IGNORE INTO quote_topics (quote_id, topic_id) VALUES (1, 1), (3, 1)`);
  }, 30000);

  afterAll(async () => {
    const { closeDb } = await import('../../src/config/database.js');
    closeDb();
    const fs = await import('fs');
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(`./tests/noteworthy-evaluator-test.db${suffix}`); } catch {}
    }
  });

  describe('getTimeWindowStart', () => {
    it('returns ISO string for hour', () => {
      const result = evaluator.getTimeWindowStart('hour');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      const d = new Date(result);
      expect(Date.now() - d.getTime()).toBeLessThan(61 * 60 * 1000);
      expect(Date.now() - d.getTime()).toBeGreaterThan(59 * 60 * 1000);
    });

    it('returns ISO string for day', () => {
      const result = evaluator.getTimeWindowStart('day');
      const d = new Date(result);
      expect(Date.now() - d.getTime()).toBeLessThan(25 * 60 * 60 * 1000);
    });

    it('returns ISO string for week', () => {
      const result = evaluator.getTimeWindowStart('week');
      const d = new Date(result);
      expect(Date.now() - d.getTime()).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    });

    it('returns ISO string for month', () => {
      const result = evaluator.getTimeWindowStart('month');
      const d = new Date(result);
      expect(Date.now() - d.getTime()).toBeLessThan(31 * 24 * 60 * 60 * 1000);
    });

    it('throws for invalid period', () => {
      expect(() => evaluator.getTimeWindowStart('year')).toThrow('Invalid period');
    });
  });

  describe('evaluateQuoteOfPeriod', () => {
    it('returns the highest-importants quote in the window', () => {
      const result = evaluator.evaluateQuoteOfPeriod(db, 'hour');
      expect(result).not.toBeNull();
      expect(result.id).toBe(1); // importants_count=10 is highest
      expect(result.person_name).toBe('Test Author A');
    });

    it('does not return old quotes outside the window', () => {
      // Quote 5 has 100 importants but is from 2020 — should not be returned for 'hour'
      const result = evaluator.evaluateQuoteOfPeriod(db, 'hour');
      expect(result.id).not.toBe(5);
    });

    it('returns null when no data in window', () => {
      // Use a very short window that might have no data — but since we inserted 30min ago, hour should have data
      // Test with a manually inserted query that filters out everything
      const result = evaluator.evaluateQuoteOfPeriod(db, 'hour', { filter_type: 'author', filter_value: 9999 });
      expect(result).toBeNull();
    });

    it('respects author filter', () => {
      const result = evaluator.evaluateQuoteOfPeriod(db, 'hour', { filter_type: 'author', filter_value: 2 });
      expect(result).not.toBeNull();
      expect(result.person_name).toBe('Test Author B');
    });

    it('respects topic filter', () => {
      const result = evaluator.evaluateQuoteOfPeriod(db, 'hour', { filter_type: 'topic', filter_value: 1 });
      expect(result).not.toBeNull();
      // Should be quote 1 (importants=10, in topic 1) or quote 3 (importants=8, in topic 1)
      expect([1, 3]).toContain(result.id);
    });
  });

  describe('evaluateAuthorOfPeriod', () => {
    it('returns the author with highest aggregate importants', () => {
      const result = evaluator.evaluateAuthorOfPeriod(db, 'hour');
      expect(result).not.toBeNull();
      expect(result.entity.canonical_name).toBe('Test Author A'); // 10+5=15 > 8+3=11
    });

    it('includes top 3 quotes', () => {
      const result = evaluator.evaluateAuthorOfPeriod(db, 'hour');
      expect(result.top_quotes).toBeDefined();
      expect(result.top_quotes.length).toBeLessThanOrEqual(3);
      expect(result.top_quotes.length).toBeGreaterThan(0);
    });

    it('top_quotes are ordered by importants_count DESC', () => {
      const result = evaluator.evaluateAuthorOfPeriod(db, 'hour');
      for (let i = 1; i < result.top_quotes.length; i++) {
        expect(result.top_quotes[i - 1].importants_count).toBeGreaterThanOrEqual(result.top_quotes[i].importants_count);
      }
    });
  });

  describe('evaluateTopicOfPeriod', () => {
    it('returns the topic with highest aggregate importants', () => {
      const result = evaluator.evaluateTopicOfPeriod(db, 'hour');
      expect(result).not.toBeNull();
      expect(result.entity.name).toBe('Economy');
    });

    it('includes top quotes for the topic', () => {
      const result = evaluator.evaluateTopicOfPeriod(db, 'hour');
      expect(result.top_quotes.length).toBeGreaterThan(0);
    });
  });

  describe('evaluateCategoryOfPeriod', () => {
    it('returns the category with highest aggregate importants', () => {
      const result = evaluator.evaluateCategoryOfPeriod(db, 'hour');
      expect(result).not.toBeNull();
      expect(result.entity.name).toBe('Politics');
    });
  });

  describe('evaluateCard dispatch', () => {
    it('dispatches quote_of_hour correctly', () => {
      const result = evaluator.evaluateCard(db, { card_type: 'quote_of_hour', config: '{}' });
      expect(result).not.toBeNull();
      expect(result.type).toBe('quote');
    });

    it('dispatches author_of_day correctly', () => {
      const result = evaluator.evaluateCard(db, { card_type: 'author_of_day', config: '{}' });
      expect(result).not.toBeNull();
      expect(result.type).toBe('author');
    });

    it('dispatches search_topic correctly', () => {
      const result = evaluator.evaluateCard(db, { card_type: 'search_topic', config: '{}' });
      expect(result).not.toBeNull();
      expect(result.type).toBe('search');
      expect(result.data.search_type).toBe('topic');
    });

    it('dispatches info_importance correctly', () => {
      const result = evaluator.evaluateCard(db, { card_type: 'info_importance', config: '{}' });
      expect(result).not.toBeNull();
      expect(result.type).toBe('info');
      expect(result.data.info_type).toBe('importance');
    });
  });
});
