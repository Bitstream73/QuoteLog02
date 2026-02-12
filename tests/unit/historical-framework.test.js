import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { HistoricalProvider } from '../../src/services/historical/providerInterface.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Mock getEnabledProviders and getDb so historicalFetcher uses our test db/providers
let mockEnabledProviders = [];
vi.mock('../../src/services/historical/index.js', () => ({
  getEnabledProviders: () => mockEnabledProviders,
  getAllProviders: () => mockEnabledProviders,
  getProviderByKey: (key) => mockEnabledProviders.find(p => p.key === key),
  registerProvider: () => {},
}));

describe('Historical Provider Framework', () => {
  let db;
  const testDbPath = path.join(__dirname, '../historical-framework-test.db');

  beforeAll(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    db = new Database(testDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

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
        source_id INTEGER,
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

    // Seed test providers
    const insert = db.prepare('INSERT INTO historical_sources (provider_key, name, description) VALUES (?, ?, ?)');
    insert.run('test_provider_a', 'Test A', 'Test provider A');
    insert.run('test_provider_b', 'Test B', 'Test provider B');
    insert.run('disabled_provider', 'Disabled', 'Disabled provider');
    db.prepare("UPDATE historical_sources SET enabled = 0 WHERE provider_key = 'disabled_provider'").run();
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  // === ProviderInterface ===

  describe('ProviderInterface', () => {
    it('constructor sets key and name', () => {
      const provider = new HistoricalProvider('test_key', 'Test Name');
      expect(provider.key).toBe('test_key');
      expect(provider.name).toBe('Test Name');
    });

    it('fetchArticles throws by default', async () => {
      const provider = new HistoricalProvider('test', 'Test');
      await expect(provider.fetchArticles(5, db, {})).rejects.toThrow('fetchArticles() must be implemented');
    });

    it('testConnection throws by default', async () => {
      const provider = new HistoricalProvider('test', 'Test');
      await expect(provider.testConnection()).rejects.toThrow('testConnection() must be implemented');
    });
  });

  // === Provider Registry ===

  describe('Provider Registry (mocked)', () => {
    it('getAllProviders returns registered providers', async () => {
      const mockP = new HistoricalProvider('mock_reg', 'Mock Reg');
      mockEnabledProviders = [mockP];

      const { getAllProviders } = await import('../../src/services/historical/index.js');
      const all = getAllProviders();
      expect(all).toHaveLength(1);
      expect(all[0].key).toBe('mock_reg');
    });

    it('getProviderByKey returns correct provider', async () => {
      const mockP = new HistoricalProvider('mock_key', 'Mock Key');
      mockEnabledProviders = [mockP];

      const { getProviderByKey } = await import('../../src/services/historical/index.js');
      expect(getProviderByKey('mock_key').name).toBe('Mock Key');
    });

    it('getProviderByKey returns undefined for unknown key', async () => {
      mockEnabledProviders = [];
      const { getProviderByKey } = await import('../../src/services/historical/index.js');
      expect(getProviderByKey('nonexistent')).toBeUndefined();
    });
  });

  // === Historical Fetcher (Orchestrator) ===

  describe('Historical Fetcher', () => {
    beforeEach(() => {
      db.prepare('DELETE FROM articles').run();
      db.prepare("UPDATE historical_sources SET consecutive_failures = 0, status = 'unknown', total_articles_fetched = 0, last_error = NULL").run();
    });

    it('inserts articles from a successful provider', async () => {
      class MockSuccess extends HistoricalProvider {
        async fetchArticles() {
          return [
            { url: 'https://test.com/article1', title: 'Article 1', text: 'Full text here', published: '2025-01-01', sourceLabel: 'Test' },
            { url: 'https://test.com/article2', title: 'Article 2', text: null, published: null, sourceLabel: 'Test' },
          ];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new MockSuccess('test_provider_a', 'Test A')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      const result = await fetchHistoricalArticles(5, db);

      expect(result.newArticles).toBe(2);
      expect(result.providerResults).toHaveLength(1);
      expect(result.providerResults[0].provider).toBe('test_provider_a');
      expect(result.providerResults[0].fetched).toBe(2);
      expect(result.providerResults[0].inserted).toBe(2);

      // Verify articles in DB
      const articles = db.prepare('SELECT * FROM articles').all();
      expect(articles).toHaveLength(2);
    });

    it('handles duplicate URLs via INSERT OR IGNORE', async () => {
      db.prepare("INSERT INTO articles (url, title, status) VALUES (?, ?, 'pending')").run('https://dedup.com/existing', 'Existing');

      class MockDedup extends HistoricalProvider {
        async fetchArticles() {
          return [
            { url: 'https://dedup.com/existing', title: 'Duplicate', text: 'text', published: null, sourceLabel: 'Test' },
            { url: 'https://dedup.com/new', title: 'New Article', text: 'text', published: null, sourceLabel: 'Test' },
          ];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new MockDedup('test_provider_a', 'Test A')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      const result = await fetchHistoricalArticles(5, db);

      const provResult = result.providerResults[0];
      expect(provResult.fetched).toBe(2);
      expect(provResult.inserted).toBe(1);
    });

    it('updates consecutive_failures on provider error', async () => {
      class MockFail extends HistoricalProvider {
        async fetchArticles() { throw new Error('Network timeout'); }
        async testConnection() { return { success: false, message: 'Failed' }; }
      }

      mockEnabledProviders = [new MockFail('test_provider_b', 'Test B')];
      db.prepare("UPDATE historical_sources SET enabled = 1, status = 'unknown', consecutive_failures = 0 WHERE provider_key = 'test_provider_b'").run();

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const row = db.prepare('SELECT consecutive_failures, last_error FROM historical_sources WHERE provider_key = ?').get('test_provider_b');
      expect(row.consecutive_failures).toBe(1);
      expect(row.last_error).toBe('Network timeout');
    });

    it('auto-disables provider after 5 consecutive failures', async () => {
      class MockFail5 extends HistoricalProvider {
        async fetchArticles() { throw new Error('Persistent failure'); }
        async testConnection() { return { success: false, message: 'Failed' }; }
      }

      mockEnabledProviders = [new MockFail5('test_provider_b', 'Test B')];
      db.prepare("UPDATE historical_sources SET enabled = 1, status = 'unknown', consecutive_failures = 4 WHERE provider_key = 'test_provider_b'").run();

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const row = db.prepare('SELECT status, consecutive_failures FROM historical_sources WHERE provider_key = ?').get('test_provider_b');
      expect(row.consecutive_failures).toBe(5);
      expect(row.status).toBe('failed');
    });

    it('resets consecutive_failures on success', async () => {
      class MockRecover extends HistoricalProvider {
        async fetchArticles() {
          return [{ url: 'https://recover.com/art1', title: 'Recovered', text: 'text', published: null, sourceLabel: 'Test' }];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new MockRecover('test_provider_a', 'Test A')];
      db.prepare("UPDATE historical_sources SET consecutive_failures = 3, status = 'unknown', enabled = 1 WHERE provider_key = 'test_provider_a'").run();

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const row = db.prepare('SELECT consecutive_failures, status FROM historical_sources WHERE provider_key = ?').get('test_provider_a');
      expect(row.consecutive_failures).toBe(0);
      expect(row.status).toBe('working');
    });

    it('stores prefetched_text when provided', async () => {
      class MockText extends HistoricalProvider {
        async fetchArticles() {
          return [{ url: 'https://prefetch.com/art1', title: 'Prefetched', text: 'Full article text content here', published: '2020-05-15', sourceLabel: 'Test' }];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new MockText('test_provider_a', 'Test A')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const article = db.prepare('SELECT * FROM articles WHERE url = ?').get('https://prefetch.com/art1');
      expect(article).toBeDefined();
      expect(article.prefetched_text).toBe('Full article text content here');
      expect(article.published_at).toBe('2020-05-15');
      expect(article.status).toBe('pending');
    });

    it('returns empty results when no providers are enabled', async () => {
      mockEnabledProviders = [];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      const result = await fetchHistoricalArticles(5, db);

      expect(result.newArticles).toBe(0);
      expect(result.providerResults).toHaveLength(0);
    });

    it('sets historical_source_id correctly on inserted articles', async () => {
      class MockSourceId extends HistoricalProvider {
        async fetchArticles() {
          return [{ url: 'https://source-id.com/art1', title: 'Source ID Test', text: 'text', published: null, sourceLabel: 'Test' }];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new MockSourceId('test_provider_a', 'Test A')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const hsRow = db.prepare('SELECT id FROM historical_sources WHERE provider_key = ?').get('test_provider_a');
      const article = db.prepare('SELECT historical_source_id FROM articles WHERE url = ?').get('https://source-id.com/art1');
      expect(article.historical_source_id).toBe(hsRow.id);
    });

    it('updates total_articles_fetched on success', async () => {
      class MockStats extends HistoricalProvider {
        async fetchArticles() {
          return [
            { url: 'https://stats.com/art1', title: 'Stats 1', text: 'text', published: null, sourceLabel: 'Test' },
            { url: 'https://stats.com/art2', title: 'Stats 2', text: 'text', published: null, sourceLabel: 'Test' },
          ];
        }
        async testConnection() { return { success: true, message: 'OK' }; }
      }

      mockEnabledProviders = [new MockStats('test_provider_a', 'Test A')];

      const { fetchHistoricalArticles } = await import('../../src/services/historicalFetcher.js');
      await fetchHistoricalArticles(5, db);

      const row = db.prepare('SELECT total_articles_fetched FROM historical_sources WHERE provider_key = ?').get('test_provider_a');
      expect(row.total_articles_fetched).toBe(2);
    });
  });
});
