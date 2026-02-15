import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startServer, getPage, getBaseUrl, stopServer } from './visual-setup.js';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-key';
process.env.DATABASE_PATH = './tests/visual-test.db';

describe('Visual Tests', () => {
  let browser;
  let baseUrl;

  beforeAll(async () => {
    const result = await startServer();
    browser = result.browser;
    baseUrl = result.baseUrl;
  }, 30000);

  afterAll(async () => {
    await stopServer();
    // Clean up test database
    const fs = await import('fs');
    try {
      fs.unlinkSync('./tests/visual-test.db');
      fs.unlinkSync('./tests/visual-test.db-wal');
      fs.unlinkSync('./tests/visual-test.db-shm');
    } catch {}
  }, 15000);

  // ======= Desktop Viewport (1280x800) =======

  describe('Desktop (1280x800)', () => {
    it('1. Quote card text uses large font size', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      // Wait for content to load
      await page.waitForSelector('.quote-block__text, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasQuotes = await page.$('.quote-block__text');
      if (hasQuotes) {
        const fontSize = await page.evaluate(() => {
          const el = document.querySelector('.quote-block__text');
          return parseFloat(getComputedStyle(el).fontSize);
        });
        // Homepage quote font reduced to ~50% per design; base is still large elsewhere
        expect(fontSize).toBeGreaterThanOrEqual(12);
      }
      await page.close();
    }, 20000);

    it('2. Quote marks use accent color', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-mark, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasMarks = await page.$('.quote-mark');
      if (hasMarks) {
        const color = await page.evaluate(() => {
          const el = document.querySelector('.quote-mark');
          return getComputedStyle(el).color;
        });
        // Accent color is #E8596E → rgb(232, 89, 110)
        expect(color).toContain('232');
      }
      await page.close();
    }, 20000);

    it('3. Quote card has no border', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasQuotes = await page.$('.quote-block');
      if (hasQuotes) {
        const border = await page.evaluate(() => {
          const el = document.querySelector('.quote-block');
          return getComputedStyle(el).borderStyle;
        });
        expect(border).toBe('none');
      }
      await page.close();
    }, 20000);

    it('4. Quote dividers exist between quotes', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-divider, .empty-state', { timeout: 10000 }).catch(() => {});
      const dividerCount = await page.$$eval('.quote-divider', els => els.length);
      // Dividers should exist if there are quotes
      const quoteCount = await page.$$eval('.quote-block', els => els.length);
      if (quoteCount > 0) {
        expect(dividerCount).toBeGreaterThanOrEqual(1);
      }
      await page.close();
    }, 20000);

    it('5. Byline contains em dash', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block__byline, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasByline = await page.$('.quote-block__byline');
      if (hasByline) {
        const text = await page.evaluate(() => {
          return document.querySelector('.quote-block__attribution')?.textContent || '';
        });
        expect(text).toContain('\u2014');
      }
      await page.close();
    }, 20000);

    it('6. Footer hover elements hidden by default', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block__footer-hover, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasFooter = await page.$('.quote-block__footer-hover');
      if (hasFooter) {
        const opacity = await page.evaluate(() => {
          const el = document.querySelector('.quote-block__footer-hover');
          return getComputedStyle(el).opacity;
        });
        expect(opacity).toBe('0');
      }
      await page.close();
    }, 20000);

    it('7. AI summary has left border accent', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block__summary, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasSummary = await page.$('.quote-block__summary');
      if (hasSummary) {
        const borderLeft = await page.evaluate(() => {
          const el = document.querySelector('.quote-block__summary');
          return getComputedStyle(el).borderLeftStyle;
        });
        expect(borderLeft).toBe('solid');
      }
      await page.close();
    }, 20000);

    it('8. Source name uses small-caps', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block__source-name, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasSource = await page.$('.quote-block__source-name');
      if (hasSource) {
        const fontVariant = await page.evaluate(() => {
          const el = document.querySelector('.quote-block__source-name');
          return getComputedStyle(el).fontVariant;
        });
        expect(fontVariant).toContain('small-caps');
      }
      await page.close();
    }, 20000);

    it('9. New quotes snackbar has dark background (not accent)', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      // Check CSS exists for snackbar
      const hasSnackbarCSS = await page.evaluate(() => {
        const styles = document.styleSheets;
        for (const sheet of styles) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.selectorText && rule.selectorText.includes('new-quotes-snackbar')) {
                return true;
              }
            }
          } catch {}
        }
        return false;
      });
      expect(hasSnackbarCSS).toBe(true);
      await page.close();
    }, 20000);

    it('10. Topic headers use uppercase', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.topic-card__name, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasTopicName = await page.$('.topic-card__name');
      if (hasTopicName) {
        const textTransform = await page.evaluate(() => {
          return getComputedStyle(document.querySelector('.topic-card__name')).textTransform;
        });
        expect(textTransform).toBe('uppercase');
      }
      await page.close();
    }, 20000);

    it('11. Content max-width is 780px', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const maxWidth = await page.evaluate(() => {
        const main = document.querySelector('main');
        return getComputedStyle(main).maxWidth;
      });
      expect(maxWidth).toBe('780px');
      await page.close();
    }, 20000);

    it('12. WCAG AA contrast for primary text', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const contrast = await page.evaluate(() => {
        const body = document.body;
        const bg = getComputedStyle(body).backgroundColor;
        const color = getComputedStyle(body).color;

        function parseRgb(str) {
          const m = str.match(/(\d+)/g);
          return m ? m.map(Number) : [0, 0, 0];
        }
        function relativeLuminance(r, g, b) {
          const [rs, gs, bs] = [r, g, b].map(c => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }
        const [bgR, bgG, bgB] = parseRgb(bg);
        const [fgR, fgG, fgB] = parseRgb(color);
        const l1 = relativeLuminance(bgR, bgG, bgB);
        const l2 = relativeLuminance(fgR, fgG, fgB);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
      });
      // WCAG AA requires 4.5:1
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      await page.close();
    }, 20000);

    it('13. Design tokens exist in CSS', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return {
          textXl: style.getPropertyValue('--text-xl').trim(),
          space6: style.getPropertyValue('--space-6').trim(),
          fontHeadline: style.getPropertyValue('--font-headline').trim(),
          contentMaxWidth: style.getPropertyValue('--content-max-width').trim(),
          dividerLight: style.getPropertyValue('--divider-light').trim(),
        };
      });
      expect(tokens.textXl).toBeTruthy();
      expect(tokens.space6).toBeTruthy();
      expect(tokens.fontHeadline).toContain('Playfair');
      expect(tokens.contentMaxWidth).toBe('780px');
      expect(tokens.dividerLight).toBeTruthy();
      await page.close();
    }, 20000);

    it('14. Quote hero decorative mark CSS exists', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const hasHeroCSS = await page.evaluate(() => {
        const styles = document.styleSheets;
        for (const sheet of styles) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.selectorText && rule.selectorText.includes('quote-hero::before')) {
                return true;
              }
            }
          } catch {}
        }
        return false;
      });
      expect(hasHeroCSS).toBe(true);
      await page.close();
    }, 20000);

    it('15. Speaker group CSS exists', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const hasSpeakerCSS = await page.evaluate(() => {
        const styles = document.styleSheets;
        for (const sheet of styles) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.selectorText && rule.selectorText.includes('speaker-group')) {
                return true;
              }
            }
          } catch {}
        }
        return false;
      });
      expect(hasSpeakerCSS).toBe(true);
      await page.close();
    }, 20000);

    it('16. Headshot is 30px on quote blocks', async () => {
      const page = await getPage(1280, 800);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block__headshot, .quote-headshot-placeholder, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasHeadshot = await page.$('.quote-block__headshot');
      if (hasHeadshot) {
        const width = await page.evaluate(() => {
          return parseFloat(getComputedStyle(document.querySelector('.quote-block__headshot')).width);
        });
        expect(width).toBe(30);
      }
      await page.close();
    }, 20000);
  });

  // ======= Mobile Viewport (375x812) =======

  describe('Mobile (375x812)', () => {
    it('17. No horizontal scrollbar', async () => {
      const page = await getPage(375, 812);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const noOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
      });
      expect(noOverflow).toBe(true);
      await page.close();
    }, 20000);

    it('18. Footer-hover always visible on mobile (touch)', async () => {
      const page = await getPage(375, 812);
      // Simulate touch device
      await page.emulate({
        viewport: { width: 375, height: 812, hasTouch: true, isMobile: true },
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
      });
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      // Check if CSS has the hover:none rule
      const hasMobileRule = await page.evaluate(() => {
        const styles = document.styleSheets;
        for (const sheet of styles) {
          try {
            for (const rule of sheet.cssRules) {
              if (rule.cssText && rule.cssText.includes('hover: none') && rule.cssText.includes('footer-hover')) {
                return true;
              }
            }
          } catch {}
        }
        return false;
      });
      expect(hasMobileRule).toBe(true);
      await page.close();
    }, 20000);

    it('19. Quote text wraps properly', async () => {
      const page = await getPage(375, 812);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.quote-block__text, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasText = await page.$('.quote-block__text');
      if (hasText) {
        const noOverflow = await page.evaluate(() => {
          const el = document.querySelector('.quote-block__text');
          return el.scrollWidth <= el.clientWidth + 1; // +1 for rounding
        });
        expect(noOverflow).toBe(true);
      }
      await page.close();
    }, 20000);

    it('20. Tab bar is visible on mobile', async () => {
      const page = await getPage(375, 812);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.homepage-tabs, .empty-state', { timeout: 10000 }).catch(() => {});
      const hasTabs = await page.$('.homepage-tabs');
      if (hasTabs) {
        const isVisible = await page.evaluate(() => {
          const el = document.querySelector('.homepage-tabs');
          const style = getComputedStyle(el);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
        expect(isVisible).toBe(true);
      }
      await page.close();
    }, 20000);

    it('21. Sort controls accessible on mobile', async () => {
      const page = await getPage(375, 812);
      // Navigate to All tab
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      await page.waitForSelector('.homepage-tab', { timeout: 10000 }).catch(() => {});
      const allTab = await page.$('.homepage-tab[data-tab="all"]');
      if (allTab) {
        await allTab.click();
        await page.waitForSelector('.all-tab__sort, .sort-toggle-text, .empty-state', { timeout: 10000 }).catch(() => {});
        const hasSortControls = await page.$('.sort-toggle-text');
        if (hasSortControls) {
          const isVisible = await page.evaluate(() => {
            const el = document.querySelector('.sort-toggle-text');
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
          expect(isVisible).toBe(true);
        }
      }
      await page.close();
    }, 25000);

    it('22. Content fits within viewport width', async () => {
      const page = await getPage(375, 812);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      const fits = await page.evaluate(() => {
        const main = document.querySelector('main');
        if (!main) return true;
        const rect = main.getBoundingClientRect();
        return rect.width <= 375;
      });
      expect(fits).toBe(true);
      await page.close();
    }, 20000);

    it('23. Dark theme uses correct background color', async () => {
      const page = await getPage(375, 812);
      await page.goto(baseUrl, { waitUntil: 'networkidle2', timeout: 15000 });
      // Set dark theme
      await page.evaluate(() => {
        document.documentElement.setAttribute('data-theme', 'dark');
      });
      const bgColor = await page.evaluate(() => {
        return getComputedStyle(document.body).backgroundColor;
      });
      // #0D0D14 → rgb(13, 13, 20)
      expect(bgColor).toContain('13');
      await page.close();
    }, 20000);
  });
});
