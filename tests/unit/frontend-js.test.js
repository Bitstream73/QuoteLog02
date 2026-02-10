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

  describe('article.js Top Stories checkbox', () => {
    const articleJs = fs.readFileSync(path.join(process.cwd(), 'public/js/article.js'), 'utf-8');

    it('should include top-story-label in article header for admin', () => {
      expect(articleJs).toContain('top-story-label');
      expect(articleJs).toContain('toggleArticleTopStory');
    });

    it('should define toggleArticleTopStory function', () => {
      expect(articleJs).toContain('async function toggleArticleTopStory');
    });

    it('should check isTopStory from article data', () => {
      expect(articleJs).toContain('a.isTopStory');
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

    it('should declare _pendingScrollRestore flag', () => {
      const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
      expect(appJs).toContain('_pendingScrollRestore');
    });

    it('should define navigateBackToQuotes function', () => {
      const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
      expect(appJs).toContain('function navigateBackToQuotes');
    });

    it('should set _pendingScrollRestore in navigateBackToQuotes', () => {
      const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');
      const funcStart = appJs.indexOf('function navigateBackToQuotes');
      const funcEnd = appJs.indexOf('\nfunction ', funcStart + 1);
      const funcBody = appJs.substring(funcStart, funcEnd);
      expect(funcBody).toContain('_pendingScrollRestore = true');
    });

    it('should check _pendingScrollRestore in renderHome (home.js)', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('_pendingScrollRestore');
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

  describe('home.js Top Stories tab', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should default active category to Top Stories', () => {
      expect(homeJs).toContain("let _activeCategory = 'Top Stories'");
    });

    it('should include Top Stories in broadOrder tab list', () => {
      expect(homeJs).toContain("'Top Stories'");
      // Verify it comes before 'All'
      const tsIdx = homeJs.indexOf("'Top Stories', 'All'");
      expect(tsIdx).toBeGreaterThan(-1);
    });

    it('should use tab=top-stories query param when Top Stories is active', () => {
      expect(homeJs).toContain("queryParams.set('tab', 'top-stories')");
    });

    it('should show empty state message specific to Top Stories', () => {
      expect(homeJs).toContain('No top stories yet');
    });
  });

  describe('admin-actions.js shared module', () => {
    const adminActionsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/admin-actions.js'), 'utf-8');

    it('should define adminEditQuoteText function', () => {
      expect(adminActionsJs).toContain('async function adminEditQuoteText');
    });

    it('should define adminEditContext function', () => {
      expect(adminActionsJs).toContain('async function adminEditContext');
    });

    it('should define adminToggleVis function', () => {
      expect(adminActionsJs).toContain('async function adminToggleVis');
    });

    it('should define adminEditCategory function', () => {
      expect(adminActionsJs).toContain('async function adminEditCategory');
    });

    it('should define adminEditAuthorName function', () => {
      expect(adminActionsJs).toContain('async function adminEditAuthorName');
    });

    it('should define adminChangeHeadshot function', () => {
      expect(adminActionsJs).toContain('async function adminChangeHeadshot');
    });

    it('should define buildAdminActionsHtml function', () => {
      expect(adminActionsJs).toContain('function buildAdminActionsHtml');
    });

    it('should define ADMIN_CATEGORIES list', () => {
      expect(adminActionsJs).toContain('ADMIN_CATEGORIES');
      expect(adminActionsJs).toContain('Politician');
    });
  });

  describe('home.js admin inline actions', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should call buildAdminActionsHtml in buildQuoteEntryHtml', () => {
      expect(homeJs).toContain('buildAdminActionsHtml');
    });
  });

  describe('index.html admin-actions.js script tag', () => {
    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf-8');

    it('should include admin-actions.js script', () => {
      expect(indexHtml).toContain('admin-actions.js');
    });
  });

  describe('styles.css Top Stories tab styling', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('should have Top Stories tab accent styling', () => {
      expect(css).toContain('Top Stories');
    });
  });

  describe('settings.js Top Stories checkbox in source rows', () => {
    const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');

    it('should include top-story-label checkbox in renderSourceRow', () => {
      expect(settingsJs).toContain('top-story-label');
      expect(settingsJs).toContain('toggleTopStory');
    });

    it('should define toggleTopStory function', () => {
      expect(settingsJs).toContain('async function toggleTopStory');
    });

    it('should check is_top_story state from source data', () => {
      expect(settingsJs).toContain('source.is_top_story');
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
