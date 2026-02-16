import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('../../src/services/ai/gemini.js', () => ({
  default: {
    generateJSON: vi.fn(),
    generateText: vi.fn(),
  },
}));

vi.mock('../../src/config/index.js', () => ({
  default: {
    geminiApiKey: 'test-key',
  },
}));

vi.mock('../../src/config/database.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      get: vi.fn(),
      run: vi.fn(),
      all: vi.fn(() => []),
    })),
  })),
  getSettingValue: vi.fn((key, defaultVal) => defaultVal),
}));

vi.mock('../../src/services/promptManager.js', () => ({
  getPromptTemplate: vi.fn(() => 'Test prompt {{published_at}} {{title}} {{article_text}}'),
}));

vi.mock('../../src/services/nameDisambiguator.js', () => ({
  resolvePersonId: vi.fn(() => 1),
}));

vi.mock('../../src/services/quoteDeduplicator.js', () => ({
  insertAndDeduplicateQuote: vi.fn((quoteData) => ({
    id: 1,
    text: quoteData.text,
  })),
}));

vi.mock('../../src/services/personPhoto.js', () => ({
  fetchAndStoreHeadshot: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/services/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import gemini from '../../src/services/ai/gemini.js';
import { extractQuotesFromArticle } from '../../src/services/quoteExtractor.js';

describe('Entity Extraction', () => {
  const sampleArticle = {
    url: 'https://example.com/article',
    title: 'Test Article',
    published_at: '2025-01-15',
    source_id: 1,
    domain: 'example.com',
  };

  // Article text that passes the pre-filter (contains quote chars and attribution verbs)
  const sampleArticleText = `
    President Donald Trump said "We are going to impose massive tariffs on China"
    during a press conference at the White House. The announcement sent shockwaves
    through Wall Street and the European Union expressed concern.
    House Speaker Nancy Pelosi responded "This is reckless and will hurt American families."
    The Federal Reserve has been monitoring the situation closely.
    The Republican Party largely supported the move while Democrats argued it would
    increase prices for consumers.
  `;

  const mockDb = {
    prepare: vi.fn(() => ({
      get: vi.fn(() => null),
      run: vi.fn(),
      all: vi.fn(() => []),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return extracted_entities from Gemini response', async () => {
    gemini.generateJSON.mockResolvedValueOnce({
      quotes: [
        {
          quote_text: 'We are going to impose massive tariffs on China',
          speaker: 'Donald Trump',
          speaker_title: 'President',
          speaker_category: 'Politician',
          speaker_category_context: 'Republican, U.S. President',
          quote_type: 'direct',
          context: 'Trump announces tariffs on China',
          quote_date: '2025-01-15',
          topics: ['Trade & Tariffs'],
          keywords: ['China', 'tariffs'],
          significance: 8,
        },
      ],
      extracted_entities: [
        { name: 'Donald Trump', type: 'person' },
        { name: 'China', type: 'place' },
        { name: 'tariffs', type: 'theme' },
        { name: 'Republican Party', type: 'organization' },
        { name: 'White House', type: 'place' },
        { name: 'European Union', type: 'organization' },
        { name: 'Federal Reserve', type: 'organization' },
      ],
    });

    const result = await extractQuotesFromArticle(sampleArticleText, sampleArticle, mockDb, null);

    expect(result).toHaveProperty('extracted_entities');
    expect(result.extracted_entities).toBeInstanceOf(Array);
    expect(result.extracted_entities.length).toBe(7);
    expect(result.extracted_entities[0]).toEqual({ name: 'Donald Trump', type: 'person' });
    expect(result.extracted_entities).toContainEqual({ name: 'China', type: 'place' });
    expect(result.extracted_entities).toContainEqual({ name: 'tariffs', type: 'theme' });
    expect(result.extracted_entities).toContainEqual({ name: 'Republican Party', type: 'organization' });
  });

  it('should return quotes alongside entities', async () => {
    gemini.generateJSON.mockResolvedValueOnce({
      quotes: [
        {
          quote_text: 'We are going to impose massive tariffs on China',
          speaker: 'Donald Trump',
          speaker_title: 'President',
          speaker_category: 'Politician',
          quote_type: 'direct',
          context: 'Trump announces tariffs',
          quote_date: '2025-01-15',
          topics: ['Trade & Tariffs'],
          keywords: [],
          significance: 8,
        },
      ],
      extracted_entities: [
        { name: 'China', type: 'place' },
      ],
    });

    const result = await extractQuotesFromArticle(sampleArticleText, sampleArticle, mockDb, null);

    expect(result).toHaveProperty('quotes');
    expect(result).toHaveProperty('extracted_entities');
    expect(result.quotes).toBeInstanceOf(Array);
    expect(result.quotes.length).toBe(1);
    expect(result.extracted_entities.length).toBe(1);
  });

  it('should return empty extracted_entities when Gemini omits them', async () => {
    gemini.generateJSON.mockResolvedValueOnce({
      quotes: [
        {
          quote_text: 'We are going to impose massive tariffs on China',
          speaker: 'Donald Trump',
          speaker_title: 'President',
          quote_type: 'direct',
          context: 'Tariff announcement',
          quote_date: '2025-01-15',
          topics: [],
          keywords: [],
          significance: 7,
        },
      ],
      // No extracted_entities field
    });

    const result = await extractQuotesFromArticle(sampleArticleText, sampleArticle, mockDb, null);

    expect(result).toHaveProperty('extracted_entities');
    expect(result.extracted_entities).toEqual([]);
  });

  it('should return entities even when no quotes are found', async () => {
    gemini.generateJSON.mockResolvedValueOnce({
      quotes: [],
      extracted_entities: [
        { name: 'Federal Reserve', type: 'organization' },
        { name: 'inflation', type: 'theme' },
      ],
    });

    const result = await extractQuotesFromArticle(sampleArticleText, sampleArticle, mockDb, null);

    expect(result.quotes).toEqual([]);
    expect(result.extracted_entities.length).toBe(2);
    expect(result.extracted_entities).toContainEqual({ name: 'Federal Reserve', type: 'organization' });
  });

  it('should return empty arrays when article fails pre-filter', async () => {
    // Text without quote characters or attribution verbs
    const plainText = 'This is a plain article with no quotes or speech.';

    const result = await extractQuotesFromArticle(plainText, sampleArticle, mockDb, null);

    expect(result.quotes).toEqual([]);
    expect(result.extracted_entities).toEqual([]);
    expect(gemini.generateJSON).not.toHaveBeenCalled();
  });

  it('should validate entity type values', async () => {
    gemini.generateJSON.mockResolvedValueOnce({
      quotes: [],
      extracted_entities: [
        { name: 'Donald Trump', type: 'person' },
        { name: 'NATO', type: 'organization' },
        { name: 'Beijing', type: 'place' },
        { name: 'G7 Summit', type: 'event' },
        { name: 'climate change', type: 'theme' },
      ],
    });

    const result = await extractQuotesFromArticle(sampleArticleText, sampleArticle, mockDb, null);

    const validTypes = ['person', 'organization', 'place', 'event', 'theme'];
    for (const entity of result.extracted_entities) {
      expect(validTypes).toContain(entity.type);
      expect(entity).toHaveProperty('name');
      expect(typeof entity.name).toBe('string');
      expect(entity.name.length).toBeGreaterThan(0);
    }
  });

  it('should handle Gemini API failure gracefully', async () => {
    gemini.generateJSON.mockRejectedValueOnce(new Error('API error'));

    const result = await extractQuotesFromArticle(sampleArticleText, sampleArticle, mockDb, null);

    expect(result.quotes).toEqual([]);
    expect(result.extracted_entities).toEqual([]);
  });
});
