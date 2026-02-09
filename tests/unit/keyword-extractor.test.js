import { describe, it, expect } from 'vitest';
import { extractKeywords } from '../../src/services/keywordExtractor.js';

describe('Keyword Extractor', () => {
  it('extracts keywords from text', () => {
    const keywords = extractKeywords('The economy is growing and inflation remains a concern for policymakers');
    expect(keywords.length).toBeGreaterThan(0);
    expect(keywords.length).toBeLessThanOrEqual(5);
    expect(keywords).toContain('economy');
  });

  it('filters stopwords', () => {
    const keywords = extractKeywords('The quick brown fox jumps over the lazy dog');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('over');
  });

  it('filters short words (< 3 chars)', () => {
    const keywords = extractKeywords('AI is a new frontier in tech');
    expect(keywords).not.toContain('ai');
    expect(keywords).not.toContain('is');
  });

  it('returns empty array for null/empty input', () => {
    expect(extractKeywords(null)).toEqual([]);
    expect(extractKeywords('')).toEqual([]);
    expect(extractKeywords(undefined)).toEqual([]);
  });

  it('returns lowercase keywords', () => {
    const keywords = extractKeywords('Immigration Reform Is Critical');
    for (const kw of keywords) {
      expect(kw).toBe(kw.toLowerCase());
    }
  });

  it('limits to maxKeywords', () => {
    const keywords = extractKeywords(
      'economy policy immigration reform healthcare education climate infrastructure defense spending taxation regulation',
      3
    );
    expect(keywords.length).toBeLessThanOrEqual(3);
  });

  it('higher frequency words ranked first', () => {
    const keywords = extractKeywords('economy economy economy climate climate policy');
    expect(keywords[0]).toBe('economy');
    expect(keywords[1]).toBe('climate');
  });
});
