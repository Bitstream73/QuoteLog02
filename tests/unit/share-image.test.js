import { describe, it, expect, beforeAll } from 'vitest';

process.env.NODE_ENV = 'test';

describe('Share Image Service', () => {
  let generateShareImage, loadFonts, invalidateShareImageCache;

  beforeAll(async () => {
    const mod = await import('../../src/services/shareImage.js');
    generateShareImage = mod.generateShareImage;
    loadFonts = mod.loadFonts;
    invalidateShareImageCache = mod.invalidateShareImageCache;
    await loadFonts();
  }, 30000);

  it('generates a JPEG buffer for landscape format', async () => {
    const buffer = await generateShareImage({
      quoteText: 'The economy is growing at an unprecedented rate.',
      authorName: 'John Smith',
      disambiguation: 'U.S. Senator from Texas',
      verdict: 'MOSTLY_TRUE',
      category: 'A',
      claim: 'GDP growth rate claim',
      explanation: 'The economy has grown, but the characterization is somewhat exaggerated.',
    }, 'landscape');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    // JPEG magic bytes: FF D8 FF
    expect(buffer[0]).toBe(0xFF);
    expect(buffer[1]).toBe(0xD8);
    expect(buffer[2]).toBe(0xFF);
  });

  it('generates a JPEG buffer for portrait format', async () => {
    const buffer = await generateShareImage({
      quoteText: 'We need to invest more in education for our children.',
      authorName: 'Jane Doe',
      category: 'B',
    }, 'portrait');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0xFF);
    expect(buffer[1]).toBe(0xD8);
    expect(buffer[2]).toBe(0xFF);
  });

  it('handles missing fact-check data', async () => {
    const buffer = await generateShareImage({
      quoteText: 'This is a simple quote with no fact-check.',
      authorName: 'Anonymous',
    }, 'landscape');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0xFF);
  });

  it('handles long text truncation', async () => {
    const longText = 'A'.repeat(500);
    const buffer = await generateShareImage({
      quoteText: longText,
      authorName: 'Long Speaker',
      verdict: 'FALSE',
      category: 'A',
      claim: 'B'.repeat(200),
      explanation: 'C'.repeat(300),
    }, 'landscape');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0xFF);
  });

  it('handles special characters in text', async () => {
    const buffer = await generateShareImage({
      quoteText: 'He said "this & that" is <important> — it\'s a 100% true fact!',
      authorName: 'O\'Brien & Associates',
      disambiguation: 'CEO of "Big Corp"',
      verdict: 'TRUE',
      category: 'A',
      claim: 'Claim with <html> entities & "quotes"',
      explanation: 'Explanation with special chars: < > & "',
    }, 'portrait');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0xFF);
  });

  it('generates portrait with photoUrl null (graceful fallback)', async () => {
    const buffer = await generateShareImage({
      quoteText: 'Testing photo fallback in portrait mode.',
      authorName: 'Photo Test',
      photoUrl: null,
      verdict: 'TRUE',
      category: 'A',
      claim: 'Test claim',
      explanation: 'Test explanation',
    }, 'portrait');

    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(1000);
    expect(buffer[0]).toBe(0xFF);
    expect(buffer[1]).toBe(0xD8);
    expect(buffer[2]).toBe(0xFF);
  });

  it('caches images by quoteId', async () => {
    const data = {
      quoteId: 99999,
      quoteText: 'Cached quote test',
      authorName: 'Cache Author',
    };

    const buffer1 = await generateShareImage(data, 'landscape');
    const buffer2 = await generateShareImage(data, 'landscape');

    // Same buffer reference from cache
    expect(buffer1).toBe(buffer2);

    // Invalidate and regenerate
    invalidateShareImageCache(99999);
    const buffer3 = await generateShareImage(data, 'landscape');
    // New buffer after cache invalidation (content may be same but it's a new buffer)
    expect(buffer3).toBeInstanceOf(Buffer);
    expect(buffer3.length).toBeGreaterThan(1000);
  });
});
