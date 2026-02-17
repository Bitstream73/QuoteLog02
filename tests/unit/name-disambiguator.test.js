import { describe, it, expect } from 'vitest';
import { normalizeName, areFirstNamesCompatible, splitNameParts } from '../../src/services/nameDisambiguator.js';

describe('normalizeName', () => {
  it('should strip common titles', () => {
    expect(normalizeName('Dr. Martin Luther King')).toBe('martin luther king');
    expect(normalizeName('Sen. John Smith')).toBe('john smith');
    expect(normalizeName('President Joe Biden')).toBe('joe biden');
    expect(normalizeName('Rev. Jesse Jackson')).toBe('jesse jackson');
  });

  it('should strip suffixes', () => {
    expect(normalizeName('Jaren Jackson Jr.')).toBe('jaren jackson');
    expect(normalizeName('Martin Luther King Jr')).toBe('martin luther king');
    expect(normalizeName('John Smith III')).toBe('john smith');
  });

  it('should normalize whitespace and case', () => {
    expect(normalizeName('  John   Smith  ')).toBe('john smith');
    expect(normalizeName('JOHN SMITH')).toBe('john smith');
  });

  it('should handle names with both titles and suffixes', () => {
    expect(normalizeName('Dr. John Smith Jr.')).toBe('john smith');
  });
});

describe('splitNameParts', () => {
  it('should handle single-part names', () => {
    const result = splitNameParts('madonna');
    expect(result.first).toBe('');
    expect(result.last).toBe('madonna');
  });

  it('should handle two-part names', () => {
    const result = splitNameParts('john smith');
    expect(result.first).toBe('john');
    expect(result.last).toBe('smith');
  });

  it('should handle three-part names', () => {
    const result = splitNameParts('martin luther king');
    expect(result.first).toBe('martin');
    expect(result.middle).toBe('luther');
    expect(result.last).toBe('king');
  });
});

describe('areFirstNamesCompatible', () => {
  it('should match identical names', () => {
    expect(areFirstNamesCompatible('jesse', 'jesse')).toBe(true);
  });

  it('should reject clearly different names', () => {
    expect(areFirstNamesCompatible('jesse', 'jaren')).toBe(false);
    expect(areFirstNamesCompatible('john', 'michael')).toBe(false);
  });

  it('should match nicknames to canonical names', () => {
    expect(areFirstNamesCompatible('bill', 'william')).toBe(true);
    expect(areFirstNamesCompatible('bob', 'robert')).toBe(true);
    expect(areFirstNamesCompatible('jim', 'james')).toBe(true);
    expect(areFirstNamesCompatible('mike', 'michael')).toBe(true);
  });

  it('should match initials', () => {
    expect(areFirstNamesCompatible('j', 'john')).toBe(true);
    expect(areFirstNamesCompatible('j.', 'john')).toBe(true);
    expect(areFirstNamesCompatible('john', 'j')).toBe(true);
  });

  it('should treat empty first name as compatible (last-name-only)', () => {
    expect(areFirstNamesCompatible('', 'john')).toBe(true);
    expect(areFirstNamesCompatible('john', '')).toBe(true);
  });

  it('should match nickname variants to each other', () => {
    // Both "bill" and "will" map to "william"
    expect(areFirstNamesCompatible('bill', 'will')).toBe(true);
  });
});

describe('Jesse Jackson vs Jaren Jackson Jr. scenario', () => {
  it('should NOT consider jesse and jaren as first-name compatible', () => {
    // This is the core bug fix — "Jesse Jackson" should NOT auto-match "Jaren Jackson Jr."
    expect(areFirstNamesCompatible('jesse', 'jaren')).toBe(false);
  });

  it('normalizeName should strip Jr. from Jaren Jackson Jr.', () => {
    expect(normalizeName('Jaren Jackson Jr.')).toBe('jaren jackson');
  });

  it('splitNameParts should correctly parse both names', () => {
    const jesse = splitNameParts(normalizeName('Jesse Jackson'));
    expect(jesse.first).toBe('jesse');
    expect(jesse.last).toBe('jackson');

    const jaren = splitNameParts(normalizeName('Jaren Jackson Jr.'));
    expect(jaren.first).toBe('jaren');
    expect(jaren.last).toBe('jackson');
  });
});

describe('Bill Smith matches William Smith scenario', () => {
  it('should consider bill and william as first-name compatible', () => {
    expect(areFirstNamesCompatible('bill', 'william')).toBe(true);
  });
});
