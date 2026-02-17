import { describe, it, expect } from 'vitest';
import { normalizeToIsoDate } from '../../src/services/quoteExtractor.js';

describe('normalizeToIsoDate', () => {
  it('should return null for "unknown"', () => {
    expect(normalizeToIsoDate('unknown')).toBeNull();
  });

  it('should return null for null/undefined/empty', () => {
    expect(normalizeToIsoDate(null)).toBeNull();
    expect(normalizeToIsoDate(undefined)).toBeNull();
    expect(normalizeToIsoDate('')).toBeNull();
  });

  it('should pass through ISO dates (YYYY-MM-DD)', () => {
    expect(normalizeToIsoDate('2024-01-15')).toBe('2024-01-15');
    expect(normalizeToIsoDate('2001-03-22')).toBe('2001-03-22');
  });

  it('should truncate ISO datetime to date only', () => {
    expect(normalizeToIsoDate('2024-01-15T10:30:00Z')).toBe('2024-01-15');
    expect(normalizeToIsoDate('2024-01-15T10:30:00+05:00')).toBe('2024-01-15');
  });

  it('should parse natural language dates', () => {
    expect(normalizeToIsoDate('October 28, 1932')).toBe('1932-10-28');
    expect(normalizeToIsoDate('January 1, 2001')).toBe('2001-01-01');
  });

  it('should return null for unparseable strings', () => {
    expect(normalizeToIsoDate('not a date')).toBeNull();
    expect(normalizeToIsoDate('foobar')).toBeNull();
  });
});

describe('quote date fallback logic', () => {
  // These tests verify the logic of the rawDate computation in quoteExtractor.js
  // The actual line: const rawDate = q.quote_date === 'unknown' ? null : (q.quote_date || article.published_at || null);

  function computeRawDate(quoteDate, articlePublishedAt) {
    return quoteDate === 'unknown' ? null : (quoteDate || articlePublishedAt || null);
  }

  it('"unknown" should produce null (not article date)', () => {
    expect(computeRawDate('unknown', '2024-06-15')).toBeNull();
  });

  it('specific date should be used directly', () => {
    expect(computeRawDate('2001-03-22', '2024-06-15')).toBe('2001-03-22');
  });

  it('undefined/null should fall back to article date', () => {
    expect(computeRawDate(undefined, '2024-06-15')).toBe('2024-06-15');
    expect(computeRawDate(null, '2024-06-15')).toBe('2024-06-15');
    expect(computeRawDate('', '2024-06-15')).toBe('2024-06-15');
  });

  it('undefined with no article date should produce null', () => {
    expect(computeRawDate(undefined, null)).toBeNull();
    expect(computeRawDate(undefined, undefined)).toBeNull();
  });

  it('partial date (year-only) should be used directly', () => {
    // Gemini returns "2001-01-01" for year-only per updated prompt
    expect(computeRawDate('2001-01-01', '2024-06-15')).toBe('2001-01-01');
  });
});
