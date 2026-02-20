import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../src/config/index.js', () => ({
  default: {
    env: 'test',
    port: 3000,
    databasePath: ':memory:',
    geminiApiKey: 'test-key',
    pineconeApiKey: '',
    pineconeIndexHost: '',
  }
}));

vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }
}));

const mockFactCheckQuote = vi.fn();
const mockClassifyAndVerify = vi.fn();
const mockExtractAndEnrichReferences = vi.fn();
const mockGenerateShareImage = vi.fn().mockResolvedValue(Buffer.from('fake'));
const mockInvalidateShareImageCache = vi.fn();

vi.mock('../../src/services/factCheck.js', () => ({
  factCheckQuote: mockFactCheckQuote,
  classifyAndVerify: mockClassifyAndVerify,
  extractAndEnrichReferences: mockExtractAndEnrichReferences,
}));

vi.mock('../../src/services/shareImage.js', () => ({
  generateShareImage: mockGenerateShareImage,
  invalidateShareImageCache: mockInvalidateShareImageCache,
}));

vi.mock('../../src/services/factCheckQueue.js', () => ({
  default: { enqueue: vi.fn((key, fn) => fn()) },
}));

const mockDbGet = vi.fn();
const mockDbPrepare = vi.fn().mockReturnValue({ get: mockDbGet, run: vi.fn() });
const mockGetDb = vi.fn().mockReturnValue({ prepare: mockDbPrepare });

vi.mock('../../src/config/database.js', () => ({
  getDb: mockGetDb,
}));

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app;

beforeEach(async () => {
  vi.resetModules();
  mockFactCheckQuote.mockReset();
  mockClassifyAndVerify.mockReset();
  mockExtractAndEnrichReferences.mockReset();
  mockGenerateShareImage.mockReset();
  mockGenerateShareImage.mockResolvedValue(Buffer.from('fake'));
  mockInvalidateShareImageCache.mockReset();

  vi.doMock('../../src/config/index.js', () => ({
    default: { env: 'test', port: 3000, databasePath: ':memory:', geminiApiKey: 'test-key', pineconeApiKey: '', pineconeIndexHost: '' }
  }));
  vi.doMock('../../src/services/logger.js', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
  }));
  vi.doMock('../../src/services/factCheck.js', () => ({
    factCheckQuote: mockFactCheckQuote,
    classifyAndVerify: mockClassifyAndVerify,
    extractAndEnrichReferences: mockExtractAndEnrichReferences,
  }));
  vi.doMock('../../src/services/shareImage.js', () => ({
    generateShareImage: mockGenerateShareImage,
    invalidateShareImageCache: mockInvalidateShareImageCache,
  }));
  vi.doMock('../../src/services/factCheckQueue.js', () => ({
    default: { enqueue: vi.fn((key, fn) => fn()) },
  }));
  mockDbGet.mockReset();
  mockDbPrepare.mockReset();
  mockDbPrepare.mockReturnValue({ get: mockDbGet, run: vi.fn() });
  mockGetDb.mockReset();
  mockGetDb.mockReturnValue({ prepare: mockDbPrepare });
  vi.doMock('../../src/config/database.js', () => ({
    getDb: mockGetDb,
  }));

  const routerModule = await import('../../src/routes/factCheck.js');
  app = express();
  app.use(express.json());
  app.use('/api/fact-check', routerModule.default);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fact Check Routes', () => {
  // -----------------------------------------------------------------------
  // GET /status
  // -----------------------------------------------------------------------

  describe('GET /status', () => {
    it('should return status ok', async () => {
      const res = await request(app).get('/api/fact-check/status');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(typeof res.body.cacheSize).toBe('number');
      expect(res.body.geminiConfigured).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // POST /check
  // -----------------------------------------------------------------------

  describe('POST /check', () => {
    it('should return 400 when quoteText is missing', async () => {
      const res = await request(app)
        .post('/api/fact-check/check')
        .send({ authorName: 'Test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('quoteText is required');
    });

    it('should return fact-check result for valid request', async () => {
      mockFactCheckQuote.mockResolvedValue({
        category: 'A',
        verdict: 'TRUE',
        html: '<div>result</div>',
        references: null,
        referencesHtml: '',
        combinedHtml: '<div>result</div>',
        processingTimeMs: 150,
      });

      const res = await request(app)
        .post('/api/fact-check/check')
        .send({ quoteText: 'Test claim about something.' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('A');
      expect(res.body.verdict).toBe('TRUE');
      expect(res.body.html).toContain('result');
    });

    it('should pass optional fields to factCheckQuote', async () => {
      mockFactCheckQuote.mockResolvedValue({ category: 'B', verdict: null, html: '', references: null, referencesHtml: '', combinedHtml: '', processingTimeMs: 50 });

      await request(app)
        .post('/api/fact-check/check')
        .send({
          quoteText: 'Test',
          authorName: 'Jane',
          authorDescription: 'Journalist',
          context: 'Interview',
          sourceName: 'BBC',
          sourceDate: '2024-01-01',
          tags: ['politics'],
        });

      expect(mockFactCheckQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          quoteText: 'Test',
          authorName: 'Jane',
          authorDescription: 'Journalist',
          context: 'Interview',
          sourceName: 'BBC',
          sourceDate: '2024-01-01',
          tags: ['politics'],
        }),
        expect.objectContaining({
          skipFactCheck: false,
          skipReferences: false,
        })
      );
    });

    it('should default missing optional fields', async () => {
      mockFactCheckQuote.mockResolvedValue({ category: 'B', verdict: null, html: '', references: null, referencesHtml: '', combinedHtml: '', processingTimeMs: 50 });

      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteText: 'Test' });

      expect(mockFactCheckQuote).toHaveBeenCalledWith(
        expect.objectContaining({
          authorName: 'Unknown',
          authorDescription: '',
          context: '',
          sourceName: 'Unknown',
          tags: [],
        }),
        expect.any(Object)
      );
    });

    it('should return 500 when pipeline fails', async () => {
      mockFactCheckQuote.mockRejectedValue(new Error('Gemini API error'));

      const res = await request(app)
        .post('/api/fact-check/check')
        .send({ quoteText: 'Test claim' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Fact-check pipeline failed');
      expect(res.body.message).toContain('Gemini API error');
    });

    it('should return cached result on second request', async () => {
      const mockResult = {
        category: 'A',
        verdict: 'TRUE',
        html: '<div>cached</div>',
        references: null,
        referencesHtml: '',
        combinedHtml: '<div>cached</div>',
        processingTimeMs: 100,
      };
      mockFactCheckQuote.mockResolvedValue(mockResult);

      // First request
      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 'cache-test', quoteText: 'Cacheable claim' });

      // Second request — should come from cache
      const res = await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 'cache-test', quoteText: 'Cacheable claim' });

      expect(res.status).toBe(200);
      expect(res.body.fromCache).toBe(true);
      // factCheckQuote should only have been called once
      expect(mockFactCheckQuote).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // POST /classify
  // -----------------------------------------------------------------------

  describe('POST /classify', () => {
    it('should return 400 when quoteText is missing', async () => {
      const res = await request(app)
        .post('/api/fact-check/classify')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('quoteText is required');
    });

    it('should return classification result', async () => {
      mockClassifyAndVerify.mockResolvedValue({
        category: 'B',
        confidence: 0.9,
        reasoning: 'Opinion statement',
        claims: [],
        summary_label: 'Political opinion',
      });

      const res = await request(app)
        .post('/api/fact-check/classify')
        .send({ quoteText: 'This policy is a disaster.' });

      expect(res.status).toBe(200);
      expect(res.body.category).toBe('B');
      expect(res.body.reasoning).toContain('Opinion');
    });

    it('should return 500 on classification failure', async () => {
      mockClassifyAndVerify.mockRejectedValue(new Error('API error'));

      const res = await request(app)
        .post('/api/fact-check/classify')
        .send({ quoteText: 'Test' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Classification failed');
    });
  });

  // -----------------------------------------------------------------------
  // POST /references
  // -----------------------------------------------------------------------

  describe('POST /references', () => {
    it('should return 400 when quoteText is missing', async () => {
      const res = await request(app)
        .post('/api/fact-check/references')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('quoteText is required');
    });

    it('should return references result', async () => {
      mockFactCheckQuote.mockResolvedValue({
        references: [{ text_span: 'test', enrichment: { found: true } }],
        referencesHtml: '<div>refs</div>',
        processingTimeMs: 200,
      });

      const res = await request(app)
        .post('/api/fact-check/references')
        .send({ quoteText: 'The Federal Reserve raised interest rates.' });

      expect(res.status).toBe(200);
      expect(res.body.references).toHaveLength(1);
      expect(res.body.referencesHtml).toContain('refs');
      expect(res.body.processingTimeMs).toBe(200);
    });

    it('should call factCheckQuote with skipFactCheck=true', async () => {
      mockFactCheckQuote.mockResolvedValue({
        references: [],
        referencesHtml: '',
        processingTimeMs: 50,
      });

      await request(app)
        .post('/api/fact-check/references')
        .send({ quoteText: 'Test' });

      expect(mockFactCheckQuote).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ skipFactCheck: true, skipReferences: false })
      );
    });

    it('should return 500 on reference extraction failure', async () => {
      mockFactCheckQuote.mockRejectedValue(new Error('Extraction error'));

      const res = await request(app)
        .post('/api/fact-check/references')
        .send({ quoteText: 'Test' });

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Reference extraction failed');
    });
  });

  // -----------------------------------------------------------------------
  // Share image pre-warming after fact-check
  // -----------------------------------------------------------------------

  describe('POST /check — share image pre-warming', () => {
    it('should trigger share image generation after fresh fact-check with quoteId', async () => {
      mockFactCheckQuote.mockResolvedValue({
        category: 'A',
        verdict: 'TRUE',
        html: '<div>result</div>',
        references: null,
        referencesHtml: '',
        combinedHtml: '<div>result</div>',
        processingTimeMs: 150,
      });

      // Mock DB returning a quote row for pre-warming query
      mockDbGet.mockReturnValue({
        id: 42,
        text: 'Test quote text',
        context: 'Test context',
        fact_check_verdict: 'TRUE',
        fact_check_claim: 'Test claim',
        fact_check_explanation: 'Test explanation',
        canonical_name: 'Test Author',
        disambiguation: 'Politician',
        photo_url: null,
        fact_check_category: 'A',
      });

      const res = await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 42, quoteText: 'Test quote text' });

      expect(res.status).toBe(200);

      // Give the fire-and-forget Promise time to resolve
      await new Promise(r => setTimeout(r, 50));

      expect(mockGenerateShareImage).toHaveBeenCalledTimes(2);
      expect(mockGenerateShareImage).toHaveBeenCalledWith(
        expect.objectContaining({ quoteId: 42, quoteText: 'Test quote text' }),
        'landscape'
      );
      expect(mockGenerateShareImage).toHaveBeenCalledWith(
        expect.objectContaining({ quoteId: 42, quoteText: 'Test quote text' }),
        'portrait'
      );
    });

    it('should NOT trigger share image generation for cached fact-check', async () => {
      mockFactCheckQuote.mockResolvedValue({
        category: 'A', verdict: 'TRUE', html: '<div>result</div>',
        references: null, referencesHtml: '', combinedHtml: '<div>result</div>', processingTimeMs: 100,
      });

      // First request — triggers fresh fact-check + pre-warming
      mockDbGet.mockReturnValue({
        id: 43, text: 'Cached', context: '', fact_check_verdict: 'TRUE',
        fact_check_claim: '', fact_check_explanation: '', canonical_name: 'Author',
        disambiguation: '', photo_url: null, fact_check_category: 'A',
      });

      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 43, quoteText: 'Cached claim for pre-warm test' });

      await new Promise(r => setTimeout(r, 50));
      mockGenerateShareImage.mockClear();

      // Second request — should come from in-memory cache, no pre-warming
      const res = await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 43, quoteText: 'Cached claim for pre-warm test' });

      expect(res.status).toBe(200);
      expect(res.body.fromCache).toBe(true);

      await new Promise(r => setTimeout(r, 50));
      expect(mockGenerateShareImage).not.toHaveBeenCalled();
    });

    it('should invalidate share image cache before pre-warming', async () => {
      mockFactCheckQuote.mockResolvedValue({
        category: 'A', verdict: 'TRUE', html: '<div>r</div>',
        references: null, referencesHtml: '', combinedHtml: '<div>r</div>', processingTimeMs: 50,
      });

      mockDbGet.mockReturnValue({
        id: 55, text: 'Test', context: '', fact_check_verdict: 'TRUE',
        fact_check_claim: '', fact_check_explanation: '', canonical_name: 'Author',
        disambiguation: '', photo_url: null, fact_check_category: 'A',
      });

      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 55, quoteText: 'Test invalidation' });

      await new Promise(r => setTimeout(r, 50));
      expect(mockInvalidateShareImageCache).toHaveBeenCalledWith(55);
    });

    it('should NOT trigger share image generation when quoteId is absent', async () => {
      mockFactCheckQuote.mockResolvedValue({
        category: 'A', verdict: 'TRUE', html: '<div>r</div>',
        references: null, referencesHtml: '', combinedHtml: '<div>r</div>', processingTimeMs: 50,
      });

      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteText: 'No quoteId here' });

      await new Promise(r => setTimeout(r, 50));
      expect(mockGenerateShareImage).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Socket.IO broadcast after fact-check
  // -----------------------------------------------------------------------

  describe('POST /check — Socket.IO broadcast', () => {
    it('should emit fact_check_complete event with correct payload', async () => {
      const mockIoEmit = vi.fn();

      mockFactCheckQuote.mockResolvedValue({
        category: 'A', verdict: 'TRUE', html: '<div>result</div>',
        references: null, referencesHtml: '', combinedHtml: '<div>result</div>', processingTimeMs: 100,
      });

      app.set('io', { emit: mockIoEmit });

      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteId: 99, quoteText: 'Socket test claim' });

      expect(mockIoEmit).toHaveBeenCalledWith('fact_check_complete', {
        quoteId: 99,
        verdict: 'TRUE',
        category: 'A',
      });
    });

    it('should NOT emit when quoteId is absent', async () => {
      const mockIoEmit = vi.fn();
      app.set('io', { emit: mockIoEmit });

      mockFactCheckQuote.mockResolvedValue({
        category: 'A', verdict: 'TRUE', html: '<div>r</div>',
        references: null, referencesHtml: '', combinedHtml: '<div>r</div>', processingTimeMs: 50,
      });

      await request(app)
        .post('/api/fact-check/check')
        .send({ quoteText: 'No quoteId socket test' });

      expect(mockIoEmit).not.toHaveBeenCalled();
    });
  });
});
