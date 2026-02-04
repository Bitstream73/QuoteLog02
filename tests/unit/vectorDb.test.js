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

// Mock Pinecone client
vi.mock('@pinecone-database/pinecone', () => ({
  Pinecone: vi.fn().mockImplementation(() => ({
    index: vi.fn().mockReturnValue({
      namespace: vi.fn().mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
        query: vi.fn().mockResolvedValue({
          matches: [{ id: 'test-1', score: 0.9, metadata: { text: 'test' } }]
        }),
        deleteOne: vi.fn().mockResolvedValue({}),
      }),
      describeIndexStats: vi.fn().mockResolvedValue({
        dimension: 768,
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
            upsert: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
            query: vi.fn().mockResolvedValue({
              matches: [{ id: 'test-1', score: 0.9, metadata: { text: 'test' } }]
            }),
            deleteOne: vi.fn().mockResolvedValue({}),
          }),
          describeIndexStats: vi.fn().mockResolvedValue({
            dimension: 768,
            indexFullness: 0.1,
            totalRecordCount: 100
          })
        })
      }))
    }));

    const module = await import('../../src/services/vectorDb.js');
    vectorDb = module.default;
  });

  it('should upsert embeddings successfully', async () => {
    const vectors = [
      { id: 'test-1', values: new Array(768).fill(0.1), metadata: { text: 'hello' } }
    ];

    const result = await vectorDb.upsertEmbeddings(vectors);
    expect(result.upsertedCount).toBe(1);
  });

  it('should query vectors by similarity', async () => {
    const queryVector = new Array(768).fill(0.1);
    const results = await vectorDb.queryByVector(queryVector, 5);

    expect(results.matches).toHaveLength(1);
    expect(results.matches[0].score).toBeGreaterThan(0);
  });

  it('should return index statistics', async () => {
    const stats = await vectorDb.getIndexStats();

    expect(stats).toHaveProperty('dimension');
    expect(stats).toHaveProperty('totalRecordCount');
  });
});
