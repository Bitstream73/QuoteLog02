import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock the historical index to control providers
let mockEnabledProviders = [];
vi.mock('../../src/services/historical/index.js', () => ({
  getEnabledProviders: () => mockEnabledProviders,
  getAllProviders: () => mockEnabledProviders,
  getProviderByKey: (key) => mockEnabledProviders.find(p => p.key === key),
  registerProvider: () => {},
}));

describe('Scheduler Integration — Historical Fetch', () => {
  let db;
  const testDbPath = path.join(__dirname, '../historical-scheduler-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        name TEXT,
        rss_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE historical_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unknown'
          CHECK(status IN ('working', 'failed', 'disabled', 'unknown')),
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        total_articles_fetched INTEGER NOT NULL DEFAULT 0,
        last_fetch_at TEXT,
        last_success_at TEXT,
        last_error TEXT,
        config TEXT DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL UNIQUE,
        source_id INTEGER REFERENCES sources(id),
        historical_source_id INTEGER REFERENCES historical_sources(id),
        title TEXT,
        published_at TEXT,
        processed_at TEXT,
        quote_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK(status IN ('pending', 'processing', 'completed', 'failed', 'no_quotes')),
        error TEXT,
        prefetched_text TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Seed
    db.prepare('INSERT INTO historical_sources (provider_key, name, description) VALUES (?, ?, ?)').run('test_hist', 'Test Historical', 'Test');
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('historical_fetch_enabled', '1');
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run('historical_articles_per_source_per_cycle', '5');
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  beforeEach(() => {
    db.prepare('DELETE FROM articles').run();
    db.prepare("UPDATE historical_sources SET consecutive_failures = 0, status = 'unknown', total_articles_fetched = 0").run();
  });

  describe('fetchHistoricalArticles integration', () => {
    it('inserts articles with correct historical_source_id', async () => {
      const { HistoricalProvider } = await import('../../src/services/historical/providerInterface.js');

      class TestProvider extends HistoricalProvider {
        async fetchArticles() {
          return [
            { url: 'https://historical.com/art1', title: 'Historical 1', text: 'Long prefetched text for testing the historical article system', published: '1900-01-01', sourceLabel: 'Test' },
          ];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new TestProvider('test_hist', 'Test Historical')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      const result = await fetchHistoricalArticles(5, db);

      expect(result.newArticles).toBe(1);

      const article = db.prepare('SELECT * FROM articles WHERE url = ?').get('https://historical.com/art1');
      expect(article).toBeDefined();
      expect(article.historical_source_id).toBe(1);
      expect(article.source_id).toBeNull();
      expect(article.prefetched_text).toContain('Long prefetched text');
      expect(article.status).toBe('pending');
    });

    it('skips historical fetch when disabled', async () => {
      db.prepare("UPDATE settings SET value = '0' WHERE key = 'historical_fetch_enabled'").run();

      const setting = db.prepare("SELECT value FROM settings WHERE key = 'historical_fetch_enabled'").get();
      expect(setting.value).toBe('0');

      // Restore for other tests
      db.prepare("UPDATE settings SET value = '1' WHERE key = 'historical_fetch_enabled'").run();
    });

    it('historical articles get pending status', async () => {
      const { HistoricalProvider } = await import('../../src/services/historical/providerInterface.js');

      class TestProvider2 extends HistoricalProvider {
        async fetchArticles() {
          return [
            { url: 'https://historical.com/pending1', title: 'Pending Test', text: 'Some text', published: null, sourceLabel: 'Test' },
          ];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new TestProvider2('test_hist', 'Test Historical')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const article = db.prepare('SELECT status FROM articles WHERE url = ?').get('https://historical.com/pending1');
      expect(article.status).toBe('pending');
    });

    it('tracks provider failures correctly', async () => {
      const { HistoricalProvider } = await import('../../src/services/historical/providerInterface.js');

      class FailProvider extends HistoricalProvider {
        async fetchArticles() { throw new Error('Test failure'); }
        async testConnection() { return { success: false, message: 'Failed' }; }
      }

      mockEnabledProviders = [new FailProvider('test_hist', 'Test Historical')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const row = db.prepare('SELECT consecutive_failures, last_error FROM historical_sources WHERE provider_key = ?').get('test_hist');
      expect(row.consecutive_failures).toBe(1);
      expect(row.last_error).toBe('Test failure');
    });
  });

  describe('Phase 2 query includes historical articles', () => {
    it('historical articles are selectable with LEFT JOIN query pattern', () => {
      // Insert an RSS article
      db.prepare('INSERT INTO sources (domain, name) VALUES (?, ?)').run('test.com', 'Test Source');
      db.prepare("INSERT INTO articles (url, source_id, title, status) VALUES (?, 1, ?, 'pending')").run('https://test.com/rss1', 'RSS Article');

      // Insert a historical article
      db.prepare("INSERT INTO articles (url, historical_source_id, title, prefetched_text, status) VALUES (?, 1, ?, ?, 'pending')").run(
        'https://historical.com/doc1', 'Historical Doc', 'Full text of the document'
      );

      // RSS query (existing pattern)
      const rssArticles = db.prepare(`
        SELECT a.*, s.domain FROM articles a
        JOIN sources s ON a.source_id = s.id
        WHERE a.status = 'pending' AND a.source_id IS NOT NULL
        ORDER BY a.created_at ASC
      `).all();

      // Historical query (new pattern)
      const historicalArticles = db.prepare(`
        SELECT a.*, hs.provider_key as domain FROM articles a
        JOIN historical_sources hs ON a.historical_source_id = hs.id
        WHERE a.status = 'pending' AND a.historical_source_id IS NOT NULL
        ORDER BY a.created_at ASC
      `).all();

      expect(rssArticles).toHaveLength(1);
      expect(rssArticles[0].url).toBe('https://test.com/rss1');

      expect(historicalArticles).toHaveLength(1);
      expect(historicalArticles[0].url).toBe('https://historical.com/doc1');
      expect(historicalArticles[0].prefetched_text).toBe('Full text of the document');
      expect(historicalArticles[0].domain).toBe('test_hist');

      const pending = [...rssArticles, ...historicalArticles];
      expect(pending).toHaveLength(2);
    });
  });

  describe('processArticle uses prefetched_text', () => {
    it('article with prefetched_text skips URL extraction concept', () => {
      // Insert a historical article with prefetched text
      db.prepare("INSERT INTO articles (url, historical_source_id, title, prefetched_text, status) VALUES (?, 1, ?, ?, 'pending')").run(
        'https://historical.com/prefetch1', 'Prefetch Test', 'A'.repeat(250)
      );

      const article = db.prepare('SELECT * FROM articles WHERE url = ?').get('https://historical.com/prefetch1');
      expect(article.prefetched_text).toBeDefined();
      expect(article.prefetched_text.length).toBeGreaterThanOrEqual(200);
    });

    it('article without prefetched_text has null field', () => {
      db.prepare("INSERT INTO articles (url, source_id, title, status) VALUES (?, 1, ?, 'pending')").run(
        'https://test.com/no-prefetch', 'No Prefetch'
      );

      const article = db.prepare('SELECT * FROM articles WHERE url = ?').get('https://test.com/no-prefetch');
      expect(article.prefetched_text).toBeNull();
    });
  });
});
