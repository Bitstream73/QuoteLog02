import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Pinecone SDK before importing vectorDb
vi.mock('@pinecone-database/pinecone', () => {
  const mockUpsertRecords = vi.fn().mockResolvedValue({});
  const mockSearchRecords = vi.fn().mockResolvedValue({
    result: {
      hits: [
        { _id: 'quote_1', _score: 0.95, fields: { text: 'test', quote_id: 1, person_id: 1, context: 'economy', person_name: 'Author One' } },
      ],
    },
  });
  const mockNamespace = vi.fn(() => ({
    upsertRecords: mockUpsertRecords,
    searchRecords: mockSearchRecords,
  }));
  const mockIndex = vi.fn(() => ({
    namespace: mockNamespace,
  }));

  return {
    Pinecone: vi.fn(() => ({
      index: mockIndex,
    })),
    _mocks: { mockUpsertRecords, mockSearchRecords, mockNamespace },
  };
});

// Mock config
vi.mock('../../src/config/index.js', () => ({
  default: {
    pineconeApiKey: 'test-key',
    pineconeIndexHost: 'test-host',
    pineconeNamespace: 'quotes',
  },
}));

// Mock logger
vi.mock('../../src/services/logger.js', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

describe('vectorDb enrichment', () => {
  let vectorDb;
  let mocks;

  beforeEach(async () => {
    vi.resetModules();
    const pinecone = await import('@pinecone-database/pinecone');
    mocks = pinecone._mocks;
    vectorDb = await import('../../src/services/vectorDb.js');
  });

  describe('embedQuote', () => {
    it('concatenates text, context, and personName into text field', async () => {
      await vectorDb.embedQuote(42, 'The economy is growing', 1, 'economy growth GDP', 'Author One');

      expect(mocks.mockUpsertRecords).toHaveBeenCalledWith({
        records: [{
          _id: 'quote_42',
          text: 'The economy is growing | economy growth GDP | Author One',
          quote_id: 42,
          person_id: 1,
          context: 'economy growth GDP',
          person_name: 'Author One',
        }],
      });
    });

    it('handles missing context and personName gracefully', async () => {
      await vectorDb.embedQuote(43, 'A quote without context', 2);

      expect(mocks.mockUpsertRecords).toHaveBeenCalledWith({
        records: [{
          _id: 'quote_43',
          text: 'A quote without context',
          quote_id: 43,
          person_id: 2,
          context: '',
          person_name: '',
        }],
      });
    });

    it('handles null context and personName', async () => {
      await vectorDb.embedQuote(44, 'Another quote', 3, null, null);

      expect(mocks.mockUpsertRecords).toHaveBeenCalledWith({
        records: [{
          _id: 'quote_44',
          text: 'Another quote',
          quote_id: 44,
          person_id: 3,
          context: '',
          person_name: '',
        }],
      });
    });

    it('truncates enriched text to 1000 chars', async () => {
      const longText = 'a'.repeat(800);
      const longContext = 'b'.repeat(300);
      await vectorDb.embedQuote(45, longText, 1, longContext, 'Author');

      const call = mocks.mockUpsertRecords.mock.calls[0][0];
      expect(call.records[0].text.length).toBeLessThanOrEqual(1000);
    });

    it('truncates context to 500 chars', async () => {
      const longContext = 'c'.repeat(600);
      await vectorDb.embedQuote(46, 'Short text', 1, longContext, 'Author');

      const call = mocks.mockUpsertRecords.mock.calls[0][0];
      expect(call.records[0].context.length).toBeLessThanOrEqual(500);
    });

    it('truncates person_name to 200 chars', async () => {
      const longName = 'd'.repeat(250);
      await vectorDb.embedQuote(47, 'Short text', 1, 'ctx', longName);

      const call = mocks.mockUpsertRecords.mock.calls[0][0];
      expect(call.records[0].person_name.length).toBeLessThanOrEqual(200);
    });
  });

  describe('searchQuotes', () => {
    it('returns results without personId filter', async () => {
      const results = await vectorDb.searchQuotes('economy');

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('id');
      expect(results[0]).toHaveProperty('score');
      expect(results[0]).toHaveProperty('metadata');
      expect(results[0].metadata).toHaveProperty('context');
      expect(results[0].metadata).toHaveProperty('person_name');
    });

    it('passes correct topK to Pinecone', async () => {
      await vectorDb.searchQuotes('test query', 30);

      expect(mocks.mockSearchRecords).toHaveBeenCalledWith({
        query: {
          topK: 30,
          inputs: { text: 'test query' },
        },
        fields: ['text', 'quote_id', 'person_id', 'context', 'person_name'],
      });
    });

    it('defaults topK to 20', async () => {
      await vectorDb.searchQuotes('default query');

      expect(mocks.mockSearchRecords).toHaveBeenCalledWith({
        query: {
          topK: 20,
          inputs: { text: 'default query' },
        },
        fields: ['text', 'quote_id', 'person_id', 'context', 'person_name'],
      });
    });
  });

  describe('queryQuotes', () => {
    it('requests enriched fields', async () => {
      await vectorDb.queryQuotes('test', 1, 10);

      expect(mocks.mockSearchRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: ['text', 'quote_id', 'person_id', 'context', 'person_name'],
        })
      );
    });
  });
});
