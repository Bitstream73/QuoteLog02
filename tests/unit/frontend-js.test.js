import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Frontend JS files', () => {
  describe('home.js 4-tab system core functions', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should declare buildTabBarHtml function', () => {
      expect(homeJs).toContain('function buildTabBarHtml');
    });

    it('should declare switchHomepageTab function', () => {
      expect(homeJs).toContain('function switchHomepageTab');
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

    it('should store metadata in buildQuoteBlockHtml', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('_quoteMeta[q.id]');
    });

    it('should read metadata in shareEntity', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('const meta = _quoteMeta[entityId]');
    });
  });

  describe('home.js quote block author display', () => {
    it('should use quote-block__author wrapper', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('quote-block__author');
    });

    it('should use quote-block__author-desc for category context', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('quote-block__author-desc');
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

  describe('home.js 4-tab system tabs', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should default active tab to trending-topics', () => {
      expect(homeJs).toContain("let _activeTab = 'trending-topics'");
    });

    it('should include all 4 tab keys', () => {
      expect(homeJs).toContain("'trending-topics'");
      expect(homeJs).toContain("'trending-sources'");
      expect(homeJs).toContain("'trending-quotes'");
      expect(homeJs).toContain("key: 'all'");
    });

    it('should have renderTrendingTopicsTab function', () => {
      expect(homeJs).toContain('async function renderTrendingTopicsTab');
    });

    it('should have renderAllTab function', () => {
      expect(homeJs).toContain('async function renderAllTab');
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

    it('should call buildAdminActionsHtml in buildQuoteBlockHtml', () => {
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

    it('should make existing headshot clickable for admin to change photo on home.js', () => {
      const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');
      expect(homeJs).toContain('admin-headshot-clickable');
      expect(homeJs).toContain('adminChangeHeadshot');
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

  // Phase 6: Important? button component
  describe('important.js component', () => {
    const importantJs = fs.readFileSync(path.join(process.cwd(), 'public/js/important.js'), 'utf-8');

    it('should define renderImportantButton function', () => {
      expect(importantJs).toContain('function renderImportantButton');
    });

    it('should define handleImportantToggle function', () => {
      expect(importantJs).toContain('async function handleImportantToggle');
    });

    it('should define initImportantSocket function', () => {
      expect(importantJs).toContain('function initImportantSocket');
    });

    it('should use important-btn CSS class', () => {
      expect(importantJs).toContain('important-btn');
    });

    it('should use important-btn--active class for active state', () => {
      expect(importantJs).toContain('important-btn--active');
    });

    it('should use important-count class for count display', () => {
      expect(importantJs).toContain('important-count');
    });

    it('should call API.post for toggle', () => {
      expect(importantJs).toContain("API.post('/importants/toggle'");
    });

    it('should listen for important_update socket events', () => {
      expect(importantJs).toContain("'important_update'");
    });

    it('should use optimistic toggle pattern', () => {
      expect(importantJs).toContain('classList.toggle');
    });

    it('should call showToast on error', () => {
      expect(importantJs).toContain('showToast');
    });
  });

  // Phase 6: Homepage 4-tab system
  describe('home.js 4-tab homepage system', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should define homepage-tabs container', () => {
      expect(homeJs).toContain('homepage-tabs');
    });

    it('should have trending-topics tab', () => {
      expect(homeJs).toContain('trending-topics');
    });

    it('should have trending-sources tab', () => {
      expect(homeJs).toContain('trending-sources');
    });

    it('should have trending-quotes tab', () => {
      expect(homeJs).toContain('trending-quotes');
    });

    it('should have all tab key defined', () => {
      expect(homeJs).toContain("key: 'all'");
    });

    it('should define buildQuoteBlockHtml function', () => {
      expect(homeJs).toContain('function buildQuoteBlockHtml');
    });

    it('should define buildShareButtonsHtml function', () => {
      expect(homeJs).toContain('function buildShareButtonsHtml');
    });

    it('should define shareEntity function', () => {
      expect(homeJs).toContain('async function shareEntity');
    });

    it('should define initViewTracking function', () => {
      expect(homeJs).toContain('function initViewTracking');
    });

    it('should use IntersectionObserver for view tracking', () => {
      expect(homeJs).toContain('IntersectionObserver');
    });

    it('should have topic-card class for topic tab', () => {
      expect(homeJs).toContain('topic-card');
    });

    it('should have quote-block class in buildQuoteBlockHtml', () => {
      expect(homeJs).toContain('quote-block');
    });

    it('should include Important? button in quote blocks', () => {
      expect(homeJs).toContain('renderImportantButton');
    });

    it('should have sort toggle for tabs', () => {
      expect(homeJs).toContain('sort-btn');
    });
  });

  // Phase 6: index.html important.js script tag
  describe('index.html important.js integration', () => {
    const indexHtml = fs.readFileSync(path.join(process.cwd(), 'public/index.html'), 'utf-8');

    it('should include important.js script', () => {
      expect(indexHtml).toContain('important.js');
    });

    it('should not include vote.js script', () => {
      expect(indexHtml).not.toContain('vote.js');
    });
  });

  // Phase 6: app.js important socket initialization
  describe('app.js important socket integration', () => {
    const appJs = fs.readFileSync(path.join(process.cwd(), 'public/js/app.js'), 'utf-8');

    it('should call initImportantSocket instead of initVoteSocket', () => {
      expect(appJs).toContain('initImportantSocket');
      expect(appJs).not.toContain('initVoteSocket');
    });

    it('should have /topic/:slug route', () => {
      expect(appJs).toContain('/topic/');
    });
  });

  // Phase 6: CSS for important button, tabs, quote block
  describe('styles.css Phase 6 new classes', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('should have important-btn styles', () => {
      expect(css).toContain('.important-btn');
    });

    it('should have important-btn--active styles', () => {
      expect(css).toContain('.important-btn--active');
    });

    it('should have homepage-tabs styles', () => {
      expect(css).toContain('.homepage-tabs');
    });

    it('should have homepage-tab styles', () => {
      expect(css).toContain('.homepage-tab');
    });

    it('should have quote-block styles', () => {
      expect(css).toContain('.quote-block');
    });

    it('should have topic-card styles', () => {
      expect(css).toContain('.topic-card');
    });

    it('should have share-buttons styles', () => {
      expect(css).toContain('.share-buttons');
    });
  });

  // Admin autocomplete for topics/keywords
  describe('home.js admin autocomplete', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should define openAdminAutocomplete function', () => {
      expect(homeJs).toContain('function openAdminAutocomplete');
    });

    it('should define closeAdminAutocomplete function', () => {
      expect(homeJs).toContain('function closeAdminAutocomplete');
    });

    it('should define _ensureTopicsCache function', () => {
      expect(homeJs).toContain('async function _ensureTopicsCache');
    });

    it('should define _ensureKeywordsCache function', () => {
      expect(homeJs).toContain('async function _ensureKeywordsCache');
    });

    it('should define selectAutocompleteOption function', () => {
      expect(homeJs).toContain('async function selectAutocompleteOption');
    });

    it('should define selectAutocompleteCreate function', () => {
      expect(homeJs).toContain('async function selectAutocompleteCreate');
    });

    it('should use "Add Topic" label instead of "Create Topic"', () => {
      expect(homeJs).toContain('>Add Topic</button>');
      expect(homeJs).not.toContain('>Create Topic</button>');
    });

    it('should use "Add Keyword" label in admin quote block', () => {
      expect(homeJs).toContain('>Add Keyword</button>');
      // The admin-keywords-section in quote blocks should use autocomplete
      const quoteBlockSection = homeJs.substring(
        homeJs.indexOf('admin-keywords-section'),
        homeJs.indexOf('admin-topics-section')
      );
      expect(quoteBlockSection).toContain('Add Keyword');
      expect(quoteBlockSection).toContain('openAdminAutocomplete');
    });

    it('should have _topicsCacheAll variable', () => {
      expect(homeJs).toContain('let _topicsCacheAll');
    });

    it('should have _keywordsCacheAll variable', () => {
      expect(homeJs).toContain('let _keywordsCacheAll');
    });
  });

  describe('styles.css admin autocomplete styles', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'public/css/styles.css'), 'utf-8');

    it('should have admin-autocomplete styles', () => {
      expect(css).toContain('.admin-autocomplete');
    });

    it('should have admin-ac-input styles', () => {
      expect(css).toContain('.admin-ac-input');
    });

    it('should have admin-ac-dropdown styles', () => {
      expect(css).toContain('.admin-ac-dropdown');
    });

    it('should have admin-ac-option styles', () => {
      expect(css).toContain('.admin-ac-option');
    });

    it('should have admin-ac-create styles', () => {
      expect(css).toContain('.admin-ac-create');
    });
  });

  // Phase 7: Topic page rendering
  describe('home.js topic page rendering', () => {
    const homeJs = fs.readFileSync(path.join(process.cwd(), 'public/js/home.js'), 'utf-8');

    it('should define renderTopicPage function', () => {
      expect(homeJs).toContain('async function renderTopicPage');
    });
  });

  // Phase 7: quote.js replaces vote with Important?
  describe('quote.js Important? integration', () => {
    const quoteJs = fs.readFileSync(path.join(process.cwd(), 'public/js/quote.js'), 'utf-8');

    it('should use renderImportantButton instead of renderVoteControls', () => {
      expect(quoteJs).toContain('renderImportantButton');
      expect(quoteJs).not.toContain('renderVoteControls');
    });
  });

  // Phase 7: article.js uses Source label and Important?
  describe('article.js Source label and Important?', () => {
    const articleJs = fs.readFileSync(path.join(process.cwd(), 'public/js/article.js'), 'utf-8');

    it('should use renderImportantButton for article', () => {
      expect(articleJs).toContain('renderImportantButton');
    });

    it('should label as Source not Article in heading', () => {
      expect(articleJs).toContain('Source');
    });
  });

  // Phase 7: author.js replaces vote with Important?
  describe('author.js Important? integration', () => {
    const authorJs = fs.readFileSync(path.join(process.cwd(), 'public/js/author.js'), 'utf-8');

    it('should use renderImportantButton instead of renderVoteControls', () => {
      expect(authorJs).toContain('renderImportantButton');
      expect(authorJs).not.toContain('renderVoteControls');
    });
  });
});
