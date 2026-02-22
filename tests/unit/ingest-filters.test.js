import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for ingest filter logic — filtering quotes by author person_category
 * during ingestion in quoteExtractor.
 */

// --- Mocks ---

// Store for dynamic setting values
const settingsStore = {};

vi.mock('../../src/services/ai/gemini.js', () => ({
  default: { generateJSON: vi.fn(), generateText: vi.fn() },
}));

vi.mock('../../src/config/index.js', () => ({
  default: { geminiApiKey: 'test-key' },
}));

vi.mock('../../src/config/database.js', () => ({
  getDb: vi.fn(() => mockDb),
  getSettingValue: vi.fn((key, defaultVal) => {
    if (key in settingsStore) return settingsStore[key];
    if (key === 'min_quote_words') return '3';
    if (key === 'min_significance_score') return '5';
    return defaultVal;
  }),
  setSettingValue: vi.fn((key, value) => {
    settingsStore[key] = value;
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

// Track which personId gets which category
const personCategories = {};

const mockDb = {
  prepare: vi.fn((sql) => ({
    get: vi.fn((id) => {
      if (sql.includes('SELECT category FROM persons')) {
        const cat = personCategories[id] || 'Other';
        return { category: cat };
      }
      return { category: 'Other' };
    }),
    run: vi.fn(),
  })),
};

// Helper: build a well-formed quote that passes all other filters
function makeQuote(overrides = {}) {
  return {
    quote_text: 'This policy will cost two million jobs by next year',
    speaker: 'Jane Smith',
    speaker_title: 'Senator',
    speaker_category: 'Politician',
    speaker_category_context: 'U.S. Senator',
    quote_type: 'direct',
    context: 'Trade bill discussion',
    quote_date: '2025-01-15',
    topics: ['Trade'],
    keywords: ['Trade Bill'],
    significance: 7,
    fact_check_category: 'B',
    contains_claim: true,
    ...overrides,
  };
}

const ARTICLE_TEXT = `
"This policy will cost two million jobs by next year," said Jane Smith, a U.S. Senator.
"Box office numbers are through the roof this quarter," said Tom Actor, a famous entertainer.
"The team will win the championship this season," said Mike Runner, a professional athlete.
`;

const ARTICLE = {
  url: 'https://example.com/article',
  title: 'Test Article',
  published_at: '2025-01-15',
  source_id: 1,
  domain: 'example.com',
};

describe('ingest filters — category exclusion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset settings store
    for (const key of Object.keys(settingsStore)) {
      delete settingsStore[key];
    }
  });

  it('should allow all quotes when exclusion list is empty (default)', async () => {
    const quote = makeQuote();
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should allow all quotes when no exclusion setting exists', async () => {
    // No ingest_filter_excluded_categories in store — defaults to '[]'
    const quote = makeQuote();
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should skip quotes when author category is excluded', async () => {
    settingsStore.ingest_filter_excluded_categories = '["Politician"]';

    const quote = makeQuote({ speaker_category: 'Politician' });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(0);

    // Verify the filter log was called
    expect(logger.info).toHaveBeenCalledWith(
      'extractor',
      'quote_filtered_by_category',
      expect.objectContaining({
        speaker: 'Jane Smith',
        category: expect.any(String),
      })
    );
  });

  it('should allow quotes when their category is not in the exclusion list', async () => {
    settingsStore.ingest_filter_excluded_categories = '["Entertainer","Athlete"]';

    const quote = makeQuote({ speaker_category: 'Politician' });
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should filter multiple categories at once', async () => {
    settingsStore.ingest_filter_excluded_categories = '["Entertainer","Athlete","Politician"]';

    const politicianQuote = makeQuote({ speaker_category: 'Politician' });
    gemini.generateJSON.mockResolvedValue({ quotes: [politicianQuote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(0);
  });

  it('should use person DB category when speaker_category not provided by extraction', async () => {
    settingsStore.ingest_filter_excluded_categories = '["Entertainer"]';

    // Quote without speaker_category — the person's DB category will be used
    // The existing person in mockDb has category 'Other' by default
    const quote = makeQuote();
    delete quote.speaker_category;
    delete quote.speaker_category_context;
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    // 'Other' is NOT in the exclusion list, so it should pass through
    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });

  it('should handle empty JSON array string correctly', async () => {
    settingsStore.ingest_filter_excluded_categories = '[]';

    const quote = makeQuote();
    gemini.generateJSON.mockResolvedValue({ quotes: [quote] });

    const result = await extractQuotesFromArticle(ARTICLE_TEXT, ARTICLE, mockDb, null);
    expect(result.quotes.length).toBe(1);
  });
});
