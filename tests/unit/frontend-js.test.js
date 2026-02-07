import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Frontend JS files', () => {
  describe('home.js variable ordering', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should declare groupId before using it in buildArticleGroupHtml', () => {
      // Extract the buildArticleGroupHtml function body
      const funcStart = homeJs.indexOf('function buildArticleGroupHtml(group)');
      expect(funcStart).toBeGreaterThan(-1);

      const funcBody = homeJs.substring(funcStart, homeJs.indexOf('\nfunction ', funcStart + 1));

      // groupId declaration must come before first usage
      const declarationIdx = funcBody.indexOf('const groupId');
      const firstUsageIdx = funcBody.indexOf('groupId');

      expect(declarationIdx).toBeGreaterThan(-1);
      // The first occurrence of groupId should be the declaration itself
      expect(firstUsageIdx).toBe(declarationIdx + 6); // "const groupId" - first 'groupId' is at position of 'const ' + 'groupId'
    });

    it('should not reference groupId before declaration in buildArticleGroupHtml', () => {
      const funcStart = homeJs.indexOf('function buildArticleGroupHtml(group)');
      const funcBody = homeJs.substring(funcStart);

      // Find the const groupId declaration line
      const lines = funcBody.split('\n');
      let declLine = -1;
      let firstUseLine = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('const groupId')) {
          declLine = i;
          break;
        }
      }

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('groupId') && !lines[i].includes('//')) {
          firstUseLine = i;
          break;
        }
      }

      expect(declLine).toBeGreaterThan(-1);
      expect(firstUseLine).toBeGreaterThan(-1);
      // Declaration must be at or before first use
      expect(declLine).toBeLessThanOrEqual(firstUseLine);
    });
  });

  describe('home.js escapeHtml function', () => {
    // Test that escapeHtml is defined
    it('should have escapeHtml function defined', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('function escapeHtml(str)');
    });
  });

  describe('home.js share metadata storage', () => {
    it('should declare _quoteMeta for sharing', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('const _quoteMeta = {}');
    });

    it('should store metadata in buildShareHtml', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('_quoteMeta[q.id]');
    });

    it('should read metadata in shareQuote', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('const meta = _quoteMeta[quoteId]');
    });
  });

  describe('home.js author stacking', () => {
    it('should use quote-author-block wrapper', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('quote-author-block');
    });

    it('should use quote-author-description for category context', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('quote-author-description');
    });
  });

  describe('quote.js author stacking', () => {
    it('should use quote-author-block wrapper', () => {
      const quoteJs = fs.readFileSync(path.join(process.cwd(), 'public/js/quote.js'), 'utf-8');
      expect(quoteJs).toContain('quote-author-block');
    });

    it('should use quote-author-description for disambiguation', () => {
      const quoteJs = fs.readFileSync(path.join(process.cwd(), 'public/js/quote.js'), 'utf-8');
      expect(quoteJs).toContain('quote-author-description');
    });
  });

  describe('article.js sticky header', () => {
    it('should use article-sticky-header class', () => {
      const articleJs = fs.readFileSync(path.join(process.cwd(), 'public/js/article.js'), 'utf-8');
      expect(articleJs).toContain('article-sticky-header');
    });

    it('should use navigateBackToQuotes for back link', () => {
      const articleJs = fs.readFileSync(path.join(process.cwd(), 'public/js/article.js'), 'utf-8');
      expect(articleJs).toContain('navigateBackToQuotes');
    });
  });

  describe('app.js scroll position restore', () => {
    it('should declare _homeScrollY variable', () => {
      const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
      expect(appJs).toContain('_homeScrollY');
    });

    it('should define navigateBackToQuotes function', () => {
      const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
      expect(appJs).toContain('function navigateBackToQuotes');
    });
  });

  describe('styles.css new classes', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('should have article-sticky-header styles', () => {
      expect(css).toContain('.article-sticky-header');
    });

    it('should have quote-author-block styles', () => {
      expect(css).toContain('.quote-author-block');
    });

    it('should have quote-author-description styles', () => {
      expect(css).toContain('.quote-author-description');
    });

    it('should have quote-primary-source-link styles', () => {
      expect(css).toContain('.quote-primary-source-link');
    });
  });

  describe('settings.js source errors modal', () => {
    it('should define showSourceErrors function', () => {
      const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');
      expect(settingsJs).toContain('function showSourceErrors');
    });

    it('should make source warning clickable', () => {
      const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');
      expect(settingsJs).toContain('onclick="showSourceErrors');
    });
  });
});
