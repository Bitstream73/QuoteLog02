import { describe, it, expect } from 'vitest';
import {
  classifyAndVerifyPrompt,
  extractAndEnrichReferencesPrompt,
  htmlRenderingPrompt,
} from '../../src/services/factCheckPrompts.js';

const sampleQuoteData = {
  quoteText: 'Unemployment is at 3.5 percent, the lowest in 50 years.',
  authorName: 'John Smith',
  authorDescription: 'Senator',
  context: 'Speaking at a press conference',
  sourceName: 'CNN',
  sourceDate: '2024-06-15',
  tags: ['economy', 'jobs'],
};

describe('Fact Check Prompts', () => {
  describe('classifyAndVerifyPrompt', () => {
    it('should include the quote text', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('Unemployment is at 3.5 percent');
    });

    it('should include speaker metadata', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('John Smith');
      expect(prompt).toContain('Senator');
    });

    it('should include source and date', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('CNN');
      expect(prompt).toContain('2024-06-15');
    });

    it('should include tags', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('economy');
      expect(prompt).toContain('jobs');
    });

    it('should include all three category descriptions (A, B, C)', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('Category A');
      expect(prompt).toContain('Category B');
      expect(prompt).toContain('Category C');
    });

    it('should include all verdict options', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('TRUE');
      expect(prompt).toContain('FALSE');
      expect(prompt).toContain('MOSTLY_TRUE');
      expect(prompt).toContain('MOSTLY_FALSE');
      expect(prompt).toContain('MISLEADING');
      expect(prompt).toContain('LACKS_CONTEXT');
      expect(prompt).toContain('UNVERIFIABLE');
    });

    it('should handle missing optional fields gracefully', () => {
      const minimal = {
        quoteText: 'Test quote',
        authorName: 'Unknown',
        authorDescription: '',
        context: '',
        sourceName: 'Unknown',
        sourceDate: '2024-01-01',
        tags: [],
      };
      const prompt = classifyAndVerifyPrompt(minimal);
      expect(prompt).toContain('Test quote');
      expect(prompt).toContain('Unknown');
    });

    it('should request JSON response format', () => {
      const prompt = classifyAndVerifyPrompt(sampleQuoteData);
      expect(prompt).toContain('JSON');
      expect(prompt).toContain('"category"');
    });
  });

  describe('extractAndEnrichReferencesPrompt', () => {
    it('should include the quote text', () => {
      const prompt = extractAndEnrichReferencesPrompt(sampleQuoteData);
      expect(prompt).toContain('Unemployment is at 3.5 percent');
    });

    it('should include reference type categories', () => {
      const prompt = extractAndEnrichReferencesPrompt(sampleQuoteData);
      expect(prompt).toContain('policy');
      expect(prompt).toContain('organization');
      expect(prompt).toContain('person');
      expect(prompt).toContain('event');
      expect(prompt).toContain('concept');
      expect(prompt).toContain('statistic');
      expect(prompt).toContain('media_clip');
    });

    it('should include enrichment instructions', () => {
      const prompt = extractAndEnrichReferencesPrompt(sampleQuoteData);
      expect(prompt).toContain('Google Search');
      expect(prompt).toContain('primary_url');
      expect(prompt).toContain('summary');
    });

    it('should include priority guide', () => {
      const prompt = extractAndEnrichReferencesPrompt(sampleQuoteData);
      expect(prompt).toContain('high');
      expect(prompt).toContain('medium');
      expect(prompt).toContain('low');
    });

    it('should request JSON response', () => {
      const prompt = extractAndEnrichReferencesPrompt(sampleQuoteData);
      expect(prompt).toContain('"references"');
      expect(prompt).toContain('"media_clip"');
    });
  });

  describe('htmlRenderingPrompt', () => {
    it('should include verdict data as JSON', () => {
      const prompt = htmlRenderingPrompt({
        verdict: { verdict: 'TRUE', verdict_explanation: 'Accurate claim.' },
        claim: { claim_text: 'Test claim' },
        displayType: 'timeline',
      });
      expect(prompt).toContain('TRUE');
      expect(prompt).toContain('Accurate claim');
    });

    it('should include display type', () => {
      const prompt = htmlRenderingPrompt({
        verdict: {},
        claim: {},
        displayType: 'comparison',
      });
      expect(prompt).toContain('comparison');
    });

    it('should include CSS variable references for theming', () => {
      const prompt = htmlRenderingPrompt({
        verdict: {},
        claim: {},
        displayType: 'timeline',
      });
      expect(prompt).toContain('--bg-primary');
      expect(prompt).toContain('--accent');
      expect(prompt).toContain('--success');
      expect(prompt).toContain('--error');
    });

    it('should specify HTML fragment output (no html/head/body)', () => {
      const prompt = htmlRenderingPrompt({
        verdict: {},
        claim: {},
        displayType: 'timeline',
      });
      expect(prompt).toContain('no <html>');
    });
  });
});
