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

  describe('quote.js admin inline actions', () => {
    const quoteJs = fs.readFileSync(path.join(process.cwd(), 'public/js/quote.js'), 'utf-8');

    it('should call buildAdminActionsHtml in quote detail page', () => {
      expect(quoteJs).toContain('buildAdminActionsHtml');
    });
  });

  describe('author.js admin inline actions', () => {
    const authorJs = fs.readFileSync(path.join(process.cwd(), 'public/js/author.js'), 'utf-8');

    it('should call buildAdminActionsHtml in author quote cards', () => {
      expect(authorJs).toContain('buildAdminActionsHtml');
    });

    it('should have admin edit controls in author header', () => {
      expect(authorJs).toContain('adminEditAuthorName');
      expect(authorJs).toContain('adminEditCategory');
      expect(authorJs).toContain('adminChangeHeadshot');
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

  describe('Google Image search for missing author photos', () => {
    it('should have admin-headshot-search link in home.js for missing photos', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('admin-headshot-search');
      expect(homeJs).toContain('google.com/search?tbm=isch');
    });

    it('should have admin-headshot-search link in quote.js for missing photos', () => {
      const quoteJs = fs.readFileSync(path.join(process.cwd(), 'public/js/quote.js'), 'utf-8');
      expect(quoteJs).toContain('admin-headshot-search');
      expect(quoteJs).toContain('google.com/search?tbm=isch');
    });

    it('should have admin-headshot-search link in author.js for missing photos', () => {
      const authorJs = fs.readFileSync(path.join(process.cwd(), 'public/js/author.js'), 'utf-8');
      expect(authorJs).toContain('admin-headshot-search');
      expect(authorJs).toContain('google.com/search?tbm=isch');
    });

    it('should use encodeURIComponent for Google Image search URL', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('encodeURIComponent(');
      // Verify the search includes person name
      const searchPattern = homeJs.match(/google\.com\/search\?tbm=isch&q=\$\{encodeURIComponent\(([^)]+)\)/);
      expect(searchPattern).not.toBeNull();
      expect(searchPattern[1]).toContain('personName');
    });

    it('should have admin-headshot-search styles in CSS', () => {
      const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');
      expect(css).toContain('.admin-headshot-search');
    });
  });

  describe('review.js tab bar and quote management', () => {
    const reviewJs = fs.readFileSync(path.join(process.cwd(), 'public/js/review.js'), 'utf-8');

    it('should have review tab bar with disambiguation and quote management tabs', () => {
      expect(reviewJs).toContain('review-tab-bar');
      expect(reviewJs).toContain('Disambiguation Review');
      expect(reviewJs).toContain('Quote Management');
    });

    it('should define switchReviewTab function', () => {
      expect(reviewJs).toContain('function switchReviewTab');
    });

    it('should define renderQuoteManagementTab function', () => {
      expect(reviewJs).toContain('async function renderQuoteManagementTab');
    });

    it('should define loadAdminQuotes function in review.js', () => {
      expect(reviewJs).toContain('async function loadAdminQuotes');
    });

    it('should use buildAdminActionsHtml in quote management', () => {
      expect(reviewJs).toContain('buildAdminActionsHtml');
    });
  });

  describe('settings.js should not contain quote management', () => {
    const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');

    it('should not have Quote Management section', () => {
      expect(settingsJs).not.toContain('Quote Management');
    });

    it('should not have loadAdminQuotes function', () => {
      expect(settingsJs).not.toContain('function loadAdminQuotes');
    });

    it('should not have admin-quotes-list container', () => {
      expect(settingsJs).not.toContain('admin-quotes-list');
    });
  });

  describe('styles.css review tab bar', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('should have review-tab-bar styles', () => {
      expect(css).toContain('.review-tab-bar');
    });

    it('should have review-tab styles', () => {
      expect(css).toContain('.review-tab');
      expect(css).toContain('.review-tab.active');
    });
  });

  describe('settings.js Data Management structure', () => {
    const settingsJs = fs.readFileSync(path.join(process.cwd(), 'public/js/settings.js'), 'utf-8');

    it('should have Data Management section instead of separate Database', () => {
      expect(settingsJs).toContain('Data Management');
    });

    it('should have News Sources as a subsection under Data Management', () => {
      // News Sources should appear AFTER Data Management heading
      const dmIdx = settingsJs.indexOf('Data Management');
      const nsIdx = settingsJs.indexOf('News Sources', dmIdx);
      expect(dmIdx).toBeGreaterThan(-1);
      expect(nsIdx).toBeGreaterThan(dmIdx);
    });

    it('should have Backup & Restore as a subsection', () => {
      expect(settingsJs).toContain('Backup &amp; Restore');
    });

    it('should have Backfill Headshots as a subsection', () => {
      expect(settingsJs).toContain('Backfill Headshots');
    });

    it('should use settings-subsection class for subsections', () => {
      expect(settingsJs).toContain('settings-subsection');
    });

    it('should not have standalone News Sources section', () => {
      // News Sources should NOT be its own settings-section (h2), only a subsection (h3)
      const nsAsH2 = settingsJs.match(/<h2>News Sources<\/h2>/);
      expect(nsAsH2).toBeNull();
    });
  });

  describe('styles.css settings subsection styles', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('should have settings-subsection styles', () => {
      expect(css).toContain('.settings-subsection');
    });

    it('should have subsection-title styles', () => {
      expect(css).toContain('.subsection-title');
    });
  });
});
