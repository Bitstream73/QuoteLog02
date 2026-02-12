import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('Historical Source Providers', () => {
  let db;
  const testDbPath = path.join(__dirname, '../historical-providers-test.db');
  let originalFetch;

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
      CREATE TABLE sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT NOT NULL,
        name TEXT,
        rss_url TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Seed providers
    const insert = db.prepare('INSERT INTO historical_sources (provider_key, name, description) VALUES (?, ?, ?)');
    insert.run('wikiquote', 'Wikiquote', 'Test');
    insert.run('chronicling_america', 'Chronicling America', 'Test');
    insert.run('wayback', 'Wayback Machine', 'Test');
    insert.run('govinfo', 'Congressional Record', 'Test');
    insert.run('presidency_project', 'American Presidency Project', 'Test');

    // Seed a source for wayback
    db.prepare('INSERT INTO sources (domain, name, enabled) VALUES (?, ?, 1)').run('cnn.com', 'CNN');
  });

  afterAll(() => {
    db.close();
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(testDbPath + suffix)) fs.unlinkSync(testDbPath + suffix);
    }
  });

  beforeEach(() => {
    originalFetch = global.fetch;
    db.prepare('DELETE FROM articles').run();
    db.prepare("UPDATE historical_sources SET config = '{}' WHERE 1=1").run();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // === WikiquoteProvider ===

  describe('WikiquoteProvider', () => {
    it('fetchArticles returns articles with correct shape', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [
                { title: 'Abraham Lincoln', pageid: 1 },
              ],
            },
            continue: { cmcontinue: 'next_page_token' },
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            parse: {
              wikitext: {
                '*': "== Quotes ==\n* Freedom is not worth having if it does not include the freedom to make mistakes.\n* In the end, it's not the years in your life that count. It's the life in your years.",
              },
            },
          }),
        });

      const { WikiquoteProvider } = await import('../../src/services/historical/wikiquoteProvider.js');
      const provider = new WikiquoteProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(1);
      expect(articles[0].url).toContain('wikiquote.org');
      expect(articles[0].title).toContain('Abraham Lincoln');
      expect(articles[0].text).toContain('quotes attributed to');
      expect(articles[0].sourceLabel).toContain('Wikiquote');
    });

    it('testConnection returns success object', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ query: { general: { sitename: 'Wikiquote' } } }),
      });

      const { WikiquoteProvider } = await import('../../src/services/historical/wikiquoteProvider.js');
      const provider = new WikiquoteProvider();
      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain('Wikiquote');
    });

    it('returns empty array on HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 500 });

      const { WikiquoteProvider } = await import('../../src/services/historical/wikiquoteProvider.js');
      const provider = new WikiquoteProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });

    it('skips already-existing URLs', async () => {
      // Pre-insert the URL
      db.prepare("INSERT INTO articles (url, title, status) VALUES (?, ?, 'pending')").run(
        'https://en.wikiquote.org/wiki/Abraham_Lincoln', 'Existing'
      );

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            query: {
              categorymembers: [{ title: 'Abraham Lincoln', pageid: 1 }],
            },
          }),
        });

      const { WikiquoteProvider } = await import('../../src/services/historical/wikiquoteProvider.js');
      const provider = new WikiquoteProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });
  });

  // === ChroniclingAmericaProvider ===

  describe('ChroniclingAmericaProvider', () => {
    it('fetchArticles returns articles with correct shape', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalItems: 100,
          itemsPerPage: 20,
          items: [
            {
              url: 'https://chroniclingamerica.loc.gov/lccn/sn12345/1900-01-15/ed-1/seq-1/',
              title: 'The Daily News',
              date: '1900-01-15',
              ocr_eng: '"I have a dream," said Lincoln. ' + 'A'.repeat(500),
            },
          ],
        }),
      });

      const { ChroniclingAmericaProvider } = await import('../../src/services/historical/chroniclingAmericaProvider.js');
      const provider = new ChroniclingAmericaProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(1);
      expect(articles[0].url).toContain('chroniclingamerica.loc.gov');
      expect(articles[0].text.length).toBeGreaterThan(500);
      expect(articles[0].published).toBe('1900-01-15');
    });

    it('skips pages with too little text', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          totalItems: 1,
          items: [{ url: 'https://ca.loc.gov/page1', title: 'Short Page', date: '1900-01-01', ocr_eng: 'Too short' }],
        }),
      });

      const { ChroniclingAmericaProvider } = await import('../../src/services/historical/chroniclingAmericaProvider.js');
      const provider = new ChroniclingAmericaProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });

    it('testConnection returns success object', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ totalItems: 42000 }),
      });

      const { ChroniclingAmericaProvider } = await import('../../src/services/historical/chroniclingAmericaProvider.js');
      const provider = new ChroniclingAmericaProvider();
      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toContain('42000');
    });

    it('returns empty array on network error', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const { ChroniclingAmericaProvider } = await import('../../src/services/historical/chroniclingAmericaProvider.js');
      const provider = new ChroniclingAmericaProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });
  });

  // === WaybackProvider ===

  describe('WaybackProvider', () => {
    it('fetchArticles returns articles from CDX API', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ([
          ['timestamp', 'original', 'statuscode', 'mimetype'],
          ['20150601120000', 'https://cnn.com/2015/article-1', '200', 'text/html'],
          ['20150701120000', 'https://cnn.com/2015/article-2', '200', 'text/html'],
        ]),
      });

      const { WaybackProvider } = await import('../../src/services/historical/waybackProvider.js');
      const provider = new WaybackProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(2);
      expect(articles[0].url).toBe('https://cnn.com/2015/article-1');
      expect(articles[0].text).toBeNull(); // Wayback doesn't prefetch
      expect(articles[0].published).toBe('2015-06-01');
    });

    it('testConnection returns success', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ([['timestamp', 'original'], ['20200101', 'https://cnn.com']]),
      });

      const { WaybackProvider } = await import('../../src/services/historical/waybackProvider.js');
      const provider = new WaybackProvider();
      const result = await provider.testConnection();

      expect(result.success).toBe(true);
    });

    it('returns empty array on HTTP error', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 });

      const { WaybackProvider } = await import('../../src/services/historical/waybackProvider.js');
      const provider = new WaybackProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });
  });

  // === GovInfoProvider ===

  describe('GovInfoProvider', () => {
    it('returns empty array when GOVINFO_API_KEY not set', async () => {
      delete process.env.GOVINFO_API_KEY;

      const { GovInfoProvider } = await import('../../src/services/historical/govInfoProvider.js');
      const provider = new GovInfoProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });

    it('testConnection reports missing API key', async () => {
      delete process.env.GOVINFO_API_KEY;

      const { GovInfoProvider } = await import('../../src/services/historical/govInfoProvider.js');
      const provider = new GovInfoProvider();
      const result = await provider.testConnection();

      expect(result.success).toBe(false);
      expect(result.message).toContain('GOVINFO_API_KEY');
    });

    it('fetchArticles works with API key', async () => {
      process.env.GOVINFO_API_KEY = 'test_key_123';

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            results: [{ packageId: 'CREC-2025-01-15-pt1', title: 'Congressional Record Vol 171', dateIssued: '2025-01-15' }],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<html><body><p>"We must act now," said the Senator. This is important legislation that will affect millions of Americans across the country. The debate has been ongoing for several months and we need to reach a consensus on this matter. The committee has reviewed all the evidence and we believe this is the right course of action for the nation. Let me be clear about our intentions.</p></body></html>',
        });

      const { GovInfoProvider } = await import('../../src/services/historical/govInfoProvider.js');
      const provider = new GovInfoProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(1);
      expect(articles[0].url).toContain('govinfo.gov');
      expect(articles[0].text).toContain('We must act now');
      expect(articles[0].published).toBe('2025-01-15');

      delete process.env.GOVINFO_API_KEY;
    });

    it('returns empty array on network error', async () => {
      process.env.GOVINFO_API_KEY = 'test_key_123';
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error'));

      const { GovInfoProvider } = await import('../../src/services/historical/govInfoProvider.js');
      const provider = new GovInfoProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
      delete process.env.GOVINFO_API_KEY;
    });
  });

  // === PresidencyProjectProvider ===

  describe('PresidencyProjectProvider', () => {
    it('fetchArticles parses search results and fetches documents', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `<html><body>
            <a href="/documents/inaugural-address-42">Inaugural Address</a>
            <a href="/documents/press-conference-101">Press Conference</a>
          </body></html>`,
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `<html><body>
            <span class="date-display-single">January 20, 2025</span>
            <div class="field-docs-content"><p>"Ask not what your country can do for you, ask what you can do for your country." This was a powerful moment in the history of the United States. The audience was moved by these words, which have been repeated countless times since.</p></div>
          </body></html>`,
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => `<html><body>
            <span class="date-display-single">February 5, 2025</span>
            <div class="field-docs-content"><p>The President addressed the press today. "We will continue to work for the American people," he stated. The conference lasted approximately one hour and covered many important topics including the economy and foreign policy.</p></div>
          </body></html>`,
        });

      const { PresidencyProjectProvider } = await import('../../src/services/historical/presidencyProjectProvider.js');
      const provider = new PresidencyProjectProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(2);
      expect(articles[0].url).toContain('presidency.ucsb.edu');
      expect(articles[0].title).toBe('Inaugural Address');
      expect(articles[0].text).toContain('Ask not');
      expect(articles[0].published).toBe('January 20, 2025');
    });

    it('testConnection returns success for valid HTML', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>presidency.ucsb.edu content</body></html>',
      });

      const { PresidencyProjectProvider } = await import('../../src/services/historical/presidencyProjectProvider.js');
      const provider = new PresidencyProjectProvider();
      const result = await provider.testConnection();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Site accessible');
    });

    it('returns empty array on network error', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('Timeout'));

      const { PresidencyProjectProvider } = await import('../../src/services/historical/presidencyProjectProvider.js');
      const provider = new PresidencyProjectProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });

    it('skips documents with too little text', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<a href="/documents/short-doc">Short Doc</a>',
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => '<div class="field-docs-content"><p>Short.</p></div>',
        });

      const { PresidencyProjectProvider } = await import('../../src/services/historical/presidencyProjectProvider.js');
      const provider = new PresidencyProjectProvider();
      const articles = await provider.fetchArticles(5, db, {});

      expect(articles).toHaveLength(0);
    });
  });
});
