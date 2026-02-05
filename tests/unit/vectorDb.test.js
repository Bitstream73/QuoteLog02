import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  default: {
    env: 'test',
    port: 3000,
    databasePath: ':memory:',
    geminiApiKey: 'test-key',
    pineconeApiKey: 'test-pinecone-key',
    pineconeIndexHost: 'https://test.pinecone.io',
  }
}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
    }),
  }
}));

// Mock Pinecone client with integrated model methods
vi.mock('@pinecone-database/pinecone', () => ({
  Pinecone: vi.fn().mockImplementation(() => ({
    index: vi.fn().mockReturnValue({
      namespace: vi.fn().mockReturnValue({
        upsertRecords: vi.fn().mockResolvedValue(undefined),
        searchRecords: vi.fn().mockResolvedValue({
          result: {
            hits: [{ _id: 'test-1', _score: 0.9, fields: { text: 'test', quote_id: 1 } }]
          }
        }),
        deleteOne: vi.fn().mockResolvedValue({}),
      }),
      describeIndexStats: vi.fn().mockResolvedValue({
        indexFullness: 0.1,
        totalRecordCount: 100
      })
    })
  }))
}));

describe('Vector Database Service', () => {
  let vectorDb;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock('../../src/config/index.js', () => ({
      default: {
        env: 'test',
        port: 3000,
        databasePath: ':memory:',
        geminiApiKey: 'test-key',
        pineconeApiKey: 'test-pinecone-key',
        pineconeIndexHost: 'https://test.pinecone.io',
      }
    }));

    vi.doMock('../../src/services/logger.js', () => ({
      default: {
        info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
        child: vi.fn().mockReturnValue({
          info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn()
        }),
      }
    }));

    vi.doMock('@pinecone-database/pinecone', () => ({
      Pinecone: vi.fn().mockImplementation(() => ({
        index: vi.fn().mockReturnValue({
          namespace: vi.fn().mockReturnValue({
            upsertRecords: vi.fn().mockResolvedValue(undefined),
            searchRecords: vi.fn().mockResolvedValue({
              result: {
                hits: [{ _id: 'test-1', _score: 0.9, fields: { text: 'test', quote_id: 1 } }]
              }
            }),
            deleteOne: vi.fn().mockResolvedValue({}),
          }),
          describeIndexStats: vi.fn().mockResolvedValue({
            indexFullness: 0.1,
            totalRecordCount: 100
          })
        })
      }))
    }));

    const module = await import('../../src/services/vectorDb.js');
    vectorDb = module.default;
  });

  it('should upsert records successfully', async () => {
    const records = [
      { _id: 'test-1', text: 'hello world', category: 'test' }
    ];

    await vectorDb.upsertRecords(records);
    // upsertRecords returns void on success
  });

  it('should search records by text', async () => {
    const result = await vectorDb.searchRecords('test query', 5);

    expect(result.result.hits).toHaveLength(1);
    expect(result.result.hits[0]._score).toBeGreaterThan(0);
  });

  it('should return index statistics', async () => {
    const stats = await vectorDb.getIndexStats();

    expect(stats).toHaveProperty('totalRecordCount');
  });

  it('should embed a quote using integrated model', async () => {
    const { embedQuote } = await import('../../src/services/vectorDb.js');
    await embedQuote(1, 'This is a test quote', 42);
    // Should not throw - upsertRecords called with text field
  });

  it('should query quotes and return mapped results', async () => {
    const { queryQuotes } = await import('../../src/services/vectorDb.js');
    const results = await queryQuotes('test quote', 42, 5);

    expect(results).toHaveLength(1);
    expect(results[0]).toHaveProperty('id', 'test-1');
    expect(results[0]).toHaveProperty('score', 0.9);
    expect(results[0]).toHaveProperty('metadata');
    expect(results[0].metadata).toHaveProperty('text', 'test');
  });
});
