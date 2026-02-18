import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for the contains_claim and Category C hard-filter logic
 * in the quoteExtractor verification chain.
 *
 * We test the filter predicates in isolation by mocking out
 * the Gemini extraction, DB, Socket.IO, and other services,
 * then calling extractQuotesFromArticle and checking which
 * quotes survive the filter.
 */

// --- Mocks ---

vi.mock('../../src/services/ai/gemini.js', () => ({
  default: { generateJSON: vi.fn(), generateText: vi.fn() },
}));

vi.mock('../../src/config/index.js', () => ({
  default: { geminiApiKey: 'test-key' },
}));

vi.mock('../../src/config/database.js', () => ({
  getDb: vi.fn(() => mockDb),
  getSettingValue: vi.fn((key, defaultVal) => {
    if (key === 'min_quote_words') return '3';
    if (key === 'min_significance_score') return '5';
    return defaultVal;
  }),
}));

vi.mock('../../src/services/nameDisambiguator.js', () => ({
  resolvePersonId: vi.fn(() => 1),
}));

vi.mock('../../src/services/quoteDeduplicator.js', () => ({
  insertAndDeduplicateQuote: vi.fn((data) => ({
    id: Math.floor(Math.random() * 10000),
    isDuplicate: false,
    text: data.text,
  })),
}));

vi.mock('../../src/services/personPhoto.js', () => ({
  fetchAndStoreHeadshot: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/services/promptManager.js', () => ({
  getPromptTemplate: vi.fn(() => 'Extract quotes from: {{article_text}}'),
}));

vi.mock('../../src/services/classificationPipeline.js', () => ({
  classifyQuote: vi.fn(() => ({ matched: [], unmatched: [], flagged: [] })),
}));

vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import gemini from '../../src/services/ai/gemini.js';
import { extractQuotesFromArticle } from '../../src/services/quoteExtractor.js';
import logger from '../../src/services/logger.js';

// Minimal mock DB
const mockDb = {
  prepare: vi.fn(() => ({
    get: vi.fn(() => ({ category: 'Other' })),
    run: vi.fn(),
  })),
};

// Helper: build a well-formed quote object that passes all other filters
function makeQuote(overrides = {}) {
  return {
    quote_text: 'This policy will cost two million jobs by next year',
    speaker: 'Jane Smith',
    speaker_title: 'Senator',
    speaker_category: 'Politician',
    speaker_category_context: 'Democrat, U.S. Senator from California',
    quote_type: 'direct',
    context: 'Discussion about the new trade bill',
    quote_date: '2025-01-15',
    topics: ['Trade & Tariffs'],
    keywords: ['Trade Bill'],
    significance: 7,
    fact_check_category: 'B',
    fact_check_score: 0.9,
    contains_claim: true,
    ...overrides,
  };
}

// Article text that contains the quote text and speaker name
const ARTICLE_TEXT = `
"This policy will cost two million jobs by next year," said Jane Smith, a U.S. Senator from California.
"I think we are doing really well," said John Doe, a spokesperson.
"We need to do better as a nation," said Bob Jones, a local politician.
"Inflation will hit five percent by Q3," said Alice Brown, an economist.
`;

const ARTICLE = {
  url: 'https://example.com/article',
  title: 'Trade Bill Debate',
  published_at: '2025-01-15',
  source_id: 1,
  domain: 'example.com',
};

describe('contains_claim hard filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should keep quotes with contains_claim: true', async () => {
    const quote = makeQuote({ contains_claim: true });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should reject quotes with contains_claim: false', async () => {
    const quote = makeQuote({ contains_claim: false });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(0);

    // Verify the debug log was called
    expect(logger.debug).toHaveBeenCalledWith(
      'extractor',
      'no_claim_skipped',
      expect.objectContaining({ speaker: 'Jane Smith' })
    );
  });

  it('should keep quotes with contains_claim: undefined (legacy/missing)', async () => {
    const quote = makeQuote();
    delete quote.contains_claim;
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should keep quotes with contains_claim: null (not accidentally filtered)', async () => {
    const quote = makeQuote({ contains_claim: null });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });
});

describe('Category C hard filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should reject quotes with fact_check_category C', async () => {
    const quote = makeQuote({ fact_check_category: 'C', contains_claim: true });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(0);

    expect(logger.debug).toHaveBeenCalledWith(
      'extractor',
      'rhetorical_skipped',
      expect.objectContaining({ quote: expect.any(String) })
    );
  });

  it('should reject quotes with fact_check_category c (lowercase)', async () => {
    const quote = makeQuote({ fact_check_category: 'c', contains_claim: true });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(0);
  });

  it('should keep quotes with fact_check_category A', async () => {
    const quote = makeQuote({ fact_check_category: 'A', contains_claim: true });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should keep quotes with fact_check_category B', async () => {
    const quote = makeQuote({ fact_check_category: 'B', contains_claim: true });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });
});

describe('filter chain integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should apply contains_claim before Category C check', async () => {
    // Quote has both contains_claim: false AND category C
    // contains_claim filter should fire first
    const quote = makeQuote({ contains_claim: false, fact_check_category: 'C' });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(0);

    // The no_claim_skipped log should fire, not rhetorical_skipped
    expect(logger.debug).toHaveBeenCalledWith(
      'extractor',
      'no_claim_skipped',
      expect.any(Object)
    );
  });

  it('should pass quotes through the full filter chain correctly', async () => {
    // One good quote, one with no claim, one Category C
    const goodQuote = makeQuote({ contains_claim: true, fact_check_category: 'A' });

    const noClaimQuote = makeQuote({
      quote_text: 'I think we are doing really well',
      speaker: 'John Doe',
      contains_claim: false,
      fact_check_category: 'B',
    });

    const rhetoricalQuote = makeQuote({
      quote_text: 'We need to do better as a nation',
      speaker: 'Bob Jones',
      contains_claim: true,
      fact_check_category: 'C',
    });

    gemini.generateJSON.mockResolvedValue({
      quotes: [goodQuote, noClaimQuote, rhetoricalQuote],
    });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should log containsClaim in quote_extracted log', async () => {
    const quote = makeQuote({ contains_claim: true });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);

    expect(logger.info).toHaveBeenCalledWith(
      'extractor',
      'quote_extracted',
      expect.objectContaining({ containsClaim: true })
    );
  });
});
