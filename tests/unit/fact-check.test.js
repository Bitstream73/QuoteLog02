import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

const mockGenerateGroundedJSON = vi.fn();
const mockGenerateText = vi.fn();

vi.mock('../../src/services/ai/gemini.js', () => ({
  default: {
    generateGroundedJSON: mockGenerateGroundedJSON,
    generateText: mockGenerateText,
  }
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleQuoteData = {
  quoteText: 'Unemployment is at 3.5 percent, the lowest in 50 years.',
  authorName: 'John Smith',
  authorDescription: 'Senator',
  context: 'Speaking at a press conference',
  sourceName: 'CNN',
  sourceDate: '2024-06-15',
  tags: ['economy', 'jobs'],
};

const categoryAResult = {
  category: 'A',
  confidence: 0.9,
  reasoning: 'Contains verifiable statistical claim about unemployment.',
  claims: [{ claim_text: 'Unemployment is at 3.5%', data_type: 'statistic', verification_approach: 'BLS data' }],
  summary_label: 'Statistical claim about unemployment',
  verdict: 'TRUE',
  verdict_explanation: 'According to BLS data, the unemployment rate was 3.5% in that period.',
  key_data_points: [
    { label: 'Unemployment Rate', value: '3.5%', source_name: 'BLS', source_url: 'https://bls.gov/data', date: '2024-06' }
  ],
  display_type: 'single_stat',
  display_rationale: 'Single headline figure.',
  timeline_data: [],
  comparison_data: null,
  citation: { text: 'Bureau of Labor Statistics, June 2024', url: 'https://bls.gov/data' },
};

const categoryBResult = {
  category: 'B',
  confidence: 0.95,
  reasoning: 'This is a policy opinion.',
  claims: [],
  summary_label: 'Opinion on trade policy',
};

const categoryCResult = {
  category: 'C',
  confidence: 0.85,
  reasoning: 'Rhetorical fragment without verifiable content.',
  claims: [],
  summary_label: 'Rhetorical fragment',
};

const enrichedReferencesResult = {
  references: [
    {
      text_span: 'Unemployment',
      type: 'statistic',
      display_name: 'U.S. Unemployment Rate',
      why_relevant: 'Key economic indicator referenced in the claim',
      priority: 'high',
      enrichment: {
        found: true,
        title: 'U.S. Unemployment Rate',
        summary: 'The unemployment rate measures the percentage of the labor force that is jobless.',
        primary_url: 'https://bls.gov/unemployment',
        primary_source_name: 'Bureau of Labor Statistics',
        additional_links: [],
        media_embed: { type: 'none', url: null, title: null, timestamp_seconds: null },
        date_context: 'June 2024',
        category_tag: 'Economic Indicator',
      },
    },
  ],
  media_clip: null,
};

const emptyReferencesResult = { references: [], media_clip: null };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fact Check Service', () => {
  let factCheck;
  let originalFetch;

  beforeEach(async () => {
    originalFetch = global.fetch;
    // Default: all URL validations pass (200 OK)
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    vi.resetModules();
    mockGenerateGroundedJSON.mockReset();
    mockGenerateText.mockReset();

    vi.doMock('../../src/config/index.js', () => ({
      default: { env: 'test', port: 3000, databasePath: ':memory:', geminiApiKey: 'test-key', pineconeApiKey: '', pineconeIndexHost: '' }
    }));
    vi.doMock('../../src/services/logger.js', () => ({
      default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }
    }));
    vi.doMock('../../src/services/ai/gemini.js', () => ({
      default: { generateGroundedJSON: mockGenerateGroundedJSON, generateText: mockGenerateText }
    }));

    factCheck = await import('../../src/services/factCheck.js');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  // -----------------------------------------------------------------------
  // classifyAndVerify
  // -----------------------------------------------------------------------

  describe('classifyAndVerify', () => {
    it('should return Category A result for verifiable claims', async () => {
      mockGenerateGroundedJSON.mockResolvedValue(categoryAResult);
      const result = await factCheck.classifyAndVerify(sampleQuoteData);
      expect(result.category).toBe('A');
      expect(result.verdict).toBe('TRUE');
      expect(result.claims).toHaveLength(1);
    });

    it('should return Category B result for opinions', async () => {
      mockGenerateGroundedJSON.mockResolvedValue(categoryBResult);
      const result = await factCheck.classifyAndVerify(sampleQuoteData);
      expect(result.category).toBe('B');
      expect(result.claims).toHaveLength(0);
    });

    it('should return Category C result for fragments', async () => {
      mockGenerateGroundedJSON.mockResolvedValue(categoryCResult);
      const result = await factCheck.classifyAndVerify(sampleQuoteData);
      expect(result.category).toBe('C');
      expect(result.claims).toHaveLength(0);
    });

    it('should throw on invalid category', async () => {
      mockGenerateGroundedJSON.mockResolvedValue({ category: 'X' });
      await expect(factCheck.classifyAndVerify(sampleQuoteData)).rejects.toThrow('Invalid category: X');
    });

    it('should call generateGroundedJSON with a prompt string', async () => {
      mockGenerateGroundedJSON.mockResolvedValue(categoryBResult);
      await factCheck.classifyAndVerify(sampleQuoteData);
      expect(mockGenerateGroundedJSON).toHaveBeenCalledWith(expect.any(String));
    });
  });

  // -----------------------------------------------------------------------
  // extractAndEnrichReferences
  // -----------------------------------------------------------------------

  describe('extractAndEnrichReferences', () => {
    it('should return enriched references', async () => {
      mockGenerateGroundedJSON.mockResolvedValue(enrichedReferencesResult);
      const result = await factCheck.extractAndEnrichReferences(sampleQuoteData);
      expect(result.references).toHaveLength(1);
      expect(result.references[0].enrichment.found).toBe(true);
    });

    it('should default to empty references array if missing', async () => {
      mockGenerateGroundedJSON.mockResolvedValue({ media_clip: null });
      const result = await factCheck.extractAndEnrichReferences(sampleQuoteData);
      expect(result.references).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // factCheckQuote — full pipeline
  // -----------------------------------------------------------------------

  describe('factCheckQuote', () => {
    it('should run full pipeline for Category A quote', async () => {
      // First call = classifyAndVerify, second = extractAndEnrichReferences
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryAResult)
        .mockResolvedValueOnce(enrichedReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);

      expect(result.category).toBe('A');
      expect(result.verdict).toBe('TRUE');
      expect(result.html).toBeTruthy();
      expect(result.html).toContain('fc-widget');
      expect(result.references).toBeTruthy();
      expect(result.referencesHtml).toContain('fc-references');
      expect(result.combinedHtml).toBeTruthy();
      expect(typeof result.processingTimeMs).toBe('number');
    });

    it('should run full pipeline for Category B (opinion) quote', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);

      expect(result.category).toBe('B');
      expect(result.verdict).toBeNull();
      expect(result.html).toContain('Opinion');
    });

    it('should run full pipeline for Category C (fragment) quote', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryCResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);

      expect(result.category).toBe('C');
      expect(result.verdict).toBeNull();
      expect(result.html).toContain('Unverifiable Fragment');
    });

    it('should skip fact check when skipFactCheck is true', async () => {
      mockGenerateGroundedJSON.mockResolvedValueOnce(enrichedReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData, { skipFactCheck: true });

      expect(result.category).toBeNull();
      expect(result.html).toBe('');
      expect(result.references).toBeTruthy();
    });

    it('should skip references when skipReferences is true', async () => {
      mockGenerateGroundedJSON.mockResolvedValueOnce(categoryBResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData, { skipReferences: true });

      expect(result.references).toBeNull();
      expect(result.referencesHtml).toBe('');
      expect(result.html).toContain('Opinion');
    });

    it('should skip both when both skip flags are true', async () => {
      const result = await factCheck.factCheckQuote(sampleQuoteData, {
        skipFactCheck: true,
        skipReferences: true,
      });

      expect(result.category).toBeNull();
      expect(result.html).toBe('');
      expect(result.references).toBeNull();
      expect(result.referencesHtml).toBe('');
      expect(mockGenerateGroundedJSON).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // HTML rendering — verdict template
  // -----------------------------------------------------------------------

  describe('HTML rendering', () => {
    it('should render verdict badge with correct label for TRUE verdict', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryAResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('Verified True');
      expect(result.html).toContain('fc-badge');
    });

    it('should render single_stat display type', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryAResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('fc-single-stat');
      expect(result.html).toContain('3.5%');
    });

    it('should render key data points with source links', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryAResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('BLS');
      expect(result.html).toContain('https://bls.gov/data');
    });

    it('should render citation block', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryAResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('fc-citation');
      expect(result.html).toContain('Bureau of Labor Statistics');
    });

    it('should render FALSE verdict with error color class', async () => {
      const falseResult = { ...categoryAResult, verdict: 'FALSE', verdict_explanation: 'The claim is false.' };
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(falseResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('False');
      expect(result.html).toContain('var(--error)');
    });

    it('should render MISLEADING verdict with warning color', async () => {
      const misleadingResult = { ...categoryAResult, verdict: 'MISLEADING', verdict_explanation: 'Technically true but misleading.', display_type: 'text' };
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(misleadingResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('Misleading');
      expect(result.html).toContain('var(--warning)');
    });

    it('should fall back to template when complex HTML rendering fails', async () => {
      const timelineResult = { ...categoryAResult, display_type: 'timeline' };
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(timelineResult)
        .mockResolvedValueOnce(emptyReferencesResult);
      mockGenerateText.mockRejectedValueOnce(new Error('AI error'));

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      // Should fall back to template rendering
      expect(result.html).toContain('fc-widget');
    });

    it('should render Category A without verdict as error label', async () => {
      const noVerdictResult = { ...categoryAResult, verdict: undefined };
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(noVerdictResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('Verification Error');
    });

    it('should render excerpt display type with blockquote', async () => {
      const excerptResult = {
        ...categoryAResult,
        display_type: 'excerpt',
        key_data_points: [{
          label: 'Original statement',
          value: 'The exact quote from the source',
          source_name: 'Official Report',
          source_url: 'https://example.com/report',
        }],
      };
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(excerptResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.html).toContain('fc-excerpt');
      expect(result.html).toContain('blockquote');
    });
  });

  // -----------------------------------------------------------------------
  // Reference HTML rendering
  // -----------------------------------------------------------------------

  describe('Reference HTML rendering', () => {
    it('should render reference cards with type badges', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(enrichedReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.referencesHtml).toContain('fc-ref-card');
      expect(result.referencesHtml).toContain('fc-ref-type-badge');
    });

    it('should show reference count', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(enrichedReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.referencesHtml).toContain('1 reference');
    });

    it('should render empty string when no references found', async () => {
      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(emptyReferencesResult);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.referencesHtml).toBe('');
    });

    it('should render YouTube media clip when present', async () => {
      const withClip = {
        references: [],
        media_clip: {
          text_span: 'test clip',
          type: 'media_clip',
          display_name: 'Test Clip',
          enrichment: {
            found: true,
            title: 'A Video Clip',
            summary: 'Brief description',
            primary_url: 'https://youtube.com/watch?v=abc',
            primary_source_name: 'YouTube',
            additional_links: [],
            media_embed: { type: 'youtube', url: 'https://www.youtube.com/embed/abc', title: 'Test Video' },
            date_context: 'Jan 2024',
            category_tag: 'TV Clip',
          },
        },
      };

      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(withClip);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.referencesHtml).toContain('iframe');
      expect(result.referencesHtml).toContain('youtube.com/embed/abc');
      expect(result.referencesHtml).toContain('Watch the Clip');
    });

    it('should render non-YouTube media clip as a card link', async () => {
      const withNonYoutubeClip = {
        references: [],
        media_clip: {
          text_span: 'clip',
          type: 'media_clip',
          display_name: 'Podcast Clip',
          enrichment: {
            found: true,
            title: 'Podcast Episode',
            summary: 'A podcast episode',
            primary_url: 'https://podcast.example.com/ep123',
            primary_source_name: 'The Podcast',
            additional_links: [],
            media_embed: { type: 'none', url: null },
            date_context: 'Feb 2024',
            category_tag: 'Podcast',
          },
        },
      };

      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(withNonYoutubeClip);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.referencesHtml).toContain('podcast.example.com/ep123');
      expect(result.referencesHtml).not.toContain('iframe');
    });

    it('should render additional links on reference cards', async () => {
      const withAdditionalLinks = {
        references: [{
          text_span: 'Congress',
          type: 'organization',
          display_name: 'U.S. Congress',
          why_relevant: 'Relevant institution',
          priority: 'medium',
          enrichment: {
            found: true,
            title: 'U.S. Congress',
            summary: 'The legislative branch.',
            primary_url: 'https://congress.gov',
            primary_source_name: 'Congress.gov',
            additional_links: [
              { url: 'https://en.wikipedia.org/wiki/Congress', label: 'Wikipedia', source_name: 'Wikipedia' },
            ],
            media_embed: { type: 'none', url: null },
            date_context: null,
            category_tag: 'Legislative Body',
          },
        }],
        media_clip: null,
      };

      mockGenerateGroundedJSON
        .mockResolvedValueOnce(categoryBResult)
        .mockResolvedValueOnce(withAdditionalLinks);

      const result = await factCheck.factCheckQuote(sampleQuoteData);
      expect(result.referencesHtml).toContain('fc-ref-additional-link');
      expect(result.referencesHtml).toContain('Wikipedia');
    });
  });

  // -----------------------------------------------------------------------
  // VERDICT_COLORS and VERDICT_LABELS exports
  // -----------------------------------------------------------------------

  describe('Exports', () => {
    it('should export VERDICT_COLORS with all verdict types', () => {
      const { VERDICT_COLORS } = factCheck;
      expect(VERDICT_COLORS.TRUE).toBeTruthy();
      expect(VERDICT_COLORS.FALSE).toBeTruthy();
      expect(VERDICT_COLORS.MISLEADING).toBeTruthy();
      expect(VERDICT_COLORS.UNVERIFIABLE).toBeTruthy();
      expect(VERDICT_COLORS.LACKS_CONTEXT).toBeTruthy();
      expect(VERDICT_COLORS.MOSTLY_TRUE).toBeTruthy();
      expect(VERDICT_COLORS.MOSTLY_FALSE).toBeTruthy();
    });

    it('should export VERDICT_LABELS with readable labels', () => {
      const { VERDICT_LABELS } = factCheck;
      expect(VERDICT_LABELS.TRUE).toContain('Verified');
      expect(VERDICT_LABELS.FALSE).toContain('False');
      expect(VERDICT_LABELS.MISLEADING).toContain('Misleading');
    });
  });

  // -----------------------------------------------------------------------
  // validateReferenceUrls
  // -----------------------------------------------------------------------

  describe('validateReferenceUrls', () => {
    it('should keep valid URLs unchanged', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const data = {
        references: [{
          display_name: 'Test Ref',
          enrichment: {
            found: true,
            primary_url: 'https://example.com/valid',
            additional_links: [
              { url: 'https://example.com/extra', label: 'Extra' },
            ],
          },
        }],
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.references[0].enrichment.primary_url).toBe('https://example.com/valid');
      expect(data.references[0].enrichment.additional_links).toHaveLength(1);
    });

    it('should null out broken primary_url with no additional_links', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const data = {
        references: [{
          display_name: 'Dead Ref',
          enrichment: {
            found: true,
            primary_url: 'https://example.com/dead',
            additional_links: [],
          },
        }],
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.references[0].enrichment.primary_url).toBeNull();
    });

    it('should promote working additional_link when primary is broken', async () => {
      global.fetch = vi.fn().mockImplementation((url) => {
        if (url === 'https://example.com/dead') {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const data = {
        references: [{
          display_name: 'Mixed Ref',
          enrichment: {
            found: true,
            primary_url: 'https://example.com/dead',
            primary_source_name: 'Dead Source',
            additional_links: [
              { url: 'https://example.com/backup', label: 'Backup Source' },
            ],
          },
        }],
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.references[0].enrichment.primary_url).toBe('https://example.com/backup');
      expect(data.references[0].enrichment.primary_source_name).toBe('Backup Source');
      expect(data.references[0].enrichment.additional_links).toHaveLength(0);
    });

    it('should remove broken additional_links', async () => {
      global.fetch = vi.fn().mockImplementation((url) => {
        if (url === 'https://example.com/broken-extra') {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const data = {
        references: [{
          display_name: 'Test',
          enrichment: {
            found: true,
            primary_url: 'https://example.com/good',
            additional_links: [
              { url: 'https://example.com/broken-extra', label: 'Broken' },
              { url: 'https://example.com/good-extra', label: 'Good' },
            ],
          },
        }],
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.references[0].enrichment.primary_url).toBe('https://example.com/good');
      expect(data.references[0].enrichment.additional_links).toHaveLength(1);
      expect(data.references[0].enrichment.additional_links[0].label).toBe('Good');
    });

    it('should handle timeout as broken URL', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('AbortError'));

      const data = {
        references: [{
          display_name: 'Timeout Ref',
          enrichment: {
            found: true,
            primary_url: 'https://example.com/slow',
            additional_links: [],
          },
        }],
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.references[0].enrichment.primary_url).toBeNull();
    });

    it('should handle empty/null enrichedData gracefully', async () => {
      await factCheck.validateReferenceUrls(null);
      await factCheck.validateReferenceUrls({ references: [] });
      await factCheck.validateReferenceUrls({});
      // No errors thrown
    });

    it('should skip references without enrichment', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const data = {
        references: [
          { display_name: 'No Enrichment', enrichment: null },
          { display_name: 'Has Enrichment', enrichment: { found: true, primary_url: 'https://example.com', additional_links: [] } },
        ],
      };

      await factCheck.validateReferenceUrls(data);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should use HEAD method with 4s timeout', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const data = {
        references: [{
          display_name: 'Test',
          enrichment: { found: true, primary_url: 'https://example.com', additional_links: [] },
        }],
      };

      await factCheck.validateReferenceUrls(data);
      expect(global.fetch).toHaveBeenCalledWith('https://example.com', expect.objectContaining({
        method: 'HEAD',
        redirect: 'follow',
      }));
    });

    it('should null out broken media clip embed URL', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });

      const data = {
        references: [],
        media_clip: {
          enrichment: {
            found: true,
            primary_url: 'https://youtube.com/watch?v=abc',
            media_embed: { type: 'youtube', url: 'https://www.youtube.com/embed/abc' },
          },
        },
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.media_clip.enrichment.media_embed.url).toBeNull();
      expect(data.media_clip.enrichment.primary_url).toBeNull();
    });

    it('should keep valid media clip URLs', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const data = {
        references: [],
        media_clip: {
          enrichment: {
            found: true,
            primary_url: 'https://youtube.com/watch?v=good',
            media_embed: { type: 'youtube', url: 'https://www.youtube.com/embed/good' },
          },
        },
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.media_clip.enrichment.media_embed.url).toBe('https://www.youtube.com/embed/good');
      expect(data.media_clip.enrichment.primary_url).toBe('https://youtube.com/watch?v=good');
    });

    it('should null broken embed but keep valid primary URL for media clip', async () => {
      global.fetch = vi.fn().mockImplementation((url) => {
        if (url === 'https://www.youtube.com/embed/bad') {
          return Promise.resolve({ ok: false, status: 404 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      const data = {
        references: [],
        media_clip: {
          enrichment: {
            found: true,
            primary_url: 'https://youtube.com/watch?v=good',
            media_embed: { type: 'youtube', url: 'https://www.youtube.com/embed/bad' },
          },
        },
      };

      await factCheck.validateReferenceUrls(data);
      expect(data.media_clip.enrichment.media_embed.url).toBeNull();
      expect(data.media_clip.enrichment.primary_url).toBe('https://youtube.com/watch?v=good');
    });

    it('should validate both references and media clip URLs together', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });

      const data = {
        references: [{
          display_name: 'Test',
          enrichment: { found: true, primary_url: 'https://example.com/ref', additional_links: [] },
        }],
        media_clip: {
          enrichment: {
            found: true,
            primary_url: 'https://youtube.com/watch?v=abc',
            media_embed: { type: 'youtube', url: 'https://www.youtube.com/embed/abc' },
          },
        },
      };

      await factCheck.validateReferenceUrls(data);
      // All 3 unique URLs validated
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });
});
