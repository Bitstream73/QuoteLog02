import { describe, it, expect } from 'vitest';
import { isQuoteFragment } from '../../src/services/quoteExtractor.js';

describe('isQuoteFragment', () => {
  it('should detect ellipsis at start as fragment', () => {
    expect(isQuoteFragment('...and then we moved forward')).toBe(true);
    expect(isQuoteFragment('\u2026and then we moved forward')).toBe(true);
  });

  it('should detect ellipsis at end as fragment', () => {
    expect(isQuoteFragment('We were going to...')).toBe(true);
    expect(isQuoteFragment('We were going to\u2026')).toBe(true);
  });

  it('should detect lowercase start as fragment', () => {
    expect(isQuoteFragment('but we need to act now')).toBe(true);
    expect(isQuoteFragment('the economy is strong')).toBe(true);
  });

  it('should NOT flag normal quotes as fragments', () => {
    expect(isQuoteFragment('We need to act now.')).toBe(false);
    expect(isQuoteFragment('The economy is strong and growing.')).toBe(false);
    expect(isQuoteFragment('I believe this is the right decision.')).toBe(false);
  });

  it('should NOT flag quotes starting with numbers', () => {
    expect(isQuoteFragment('100 million people are affected by this.')).toBe(false);
  });

  it('should flag empty/null text as fragment', () => {
    expect(isQuoteFragment('')).toBe(true);
    expect(isQuoteFragment(null)).toBe(true);
    expect(isQuoteFragment(undefined)).toBe(true);
  });

  it('should NOT flag quotes starting with quotes or punctuation followed by uppercase', () => {
    expect(isQuoteFragment('"This is important," he said.')).toBe(false);
  });
});
