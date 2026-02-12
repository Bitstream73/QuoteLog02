# Build Progress

## Current Status
- **Current Phase:** COMPLETE
- **Last Updated:** 2026-02-10
- **Last Commit:** 1623f47

## Phase 0: Environment & Credentials ✅
- [x] Existing project — all credentials, dependencies, and services already configured

## Phase 1: Database Schema — Top Stories Support ✅
- [x] Add `is_top_story` column to `sources` table (INTEGER DEFAULT 0) in `src/config/database.js` `initializeTables()` using ALTER TABLE + PRAGMA table_info guard
- [x] Add `is_top_story` column to `articles` table (INTEGER DEFAULT 0) in `src/config/database.js` `initializeTables()` using ALTER TABLE + PRAGMA table_info guard
- [x] Write tests in `tests/unit/database.test.js` verifying both columns exist and default to 0

## Phase 2: Backend API — Top Stories ✅
- [x] Update GET `/api/sources` in `src/routes/sources.js` to include `is_top_story` in response
- [x] Update PATCH `/api/sources/:id` in `src/routes/sources.js` to accept `is_top_story` field (admin only)
- [x] Add PATCH `/api/articles/:id` endpoint in `src/routes/articles.js` for admin to update `is_top_story` field
- [x] Update GET `/api/quotes` in `src/routes/quotes.js` to support `tab=top-stories` query param — filter to quotes from articles where `articles.is_top_story=1` OR `sources.is_top_story=1`
- [x] Write integration tests in `tests/integration/top-stories.test.js` for all Top Stories API endpoints

## Phase 3: Frontend — Top Stories Tab ✅
- [x] Add "Top Stories" as first tab in homepage tab system in `public/js/home.js` — insert before "All" in the categories, make it the default active tab on page load
- [x] Implement Top Stories data loading — when "Top Stories" tab is active, fetch `/api/quotes?tab=top-stories` instead of regular category filter
- [x] Add CSS for Top Stories tab highlight/styling in `public/css/styles.css` (use existing tab styles, add distinguishing accent)
- [x] Write tests in `tests/unit/frontend-js.test.js` verifying Top Stories tab renders and defaults to active

## Phase 4: Settings — Source Top Stories Checkbox ✅
- [x] Add "Top Stories" checkbox to each source row in `public/js/settings.js` `renderSourceRow()` — checked when `source.is_top_story === 1`
- [x] Wire checkbox change to PATCH `/api/sources/:id` with `{ is_top_story: checked ? 1 : 0 }` — use existing `toggleSource` pattern
- [x] Write test in `tests/integration/top-stories.test.js` verifying source top-story toggle works via API

## Phase 5: Article Top Stories Checkbox (Admin Only) ✅
- [x] Add "Top Stories" checkbox to article detail page in `public/js/article.js` — only visible when `isAdmin`, checked when `article.is_top_story === 1`
- [x] Wire checkbox change to PATCH `/api/articles/:id` with `{ is_top_story: checked ? 1 : 0 }`
- [x] Update GET `/api/articles/:id` in `src/routes/articles.js` to include `is_top_story` in response
- [x] Write test verifying article top-story toggle via API in `tests/integration/top-stories.test.js`

## Phase 6: Inline Admin Editing — Homepage Quote Cards ✅
- [x] Add full admin edit controls to homepage quote cards in `public/js/home.js` `buildQuoteEntryHtml()` — reuse the edit functions from settings.js (editQuote text, editContext, toggleVisibility, editCategory, editAuthor, changeHeadshot). Show controls only when `isAdmin`
- [x] Extract shared admin edit functions from `public/js/settings.js` into `public/js/admin-actions.js` so they can be reused across pages (quote text, context, visibility, category, author name, headshot)
- [x] Import and wire admin-actions.js in `public/index.html` script tags
- [x] Write tests in `tests/unit/frontend-js.test.js` verifying admin edit buttons render on homepage when admin

## Phase 7: Inline Admin Editing — Other Pages ✅
- [x] Add admin edit controls to individual quote detail page in `public/js/quote.js` — edit text, context, visibility, category, author, headshot (using shared admin-actions.js)
- [x] Add admin edit controls to article page quote cards in `public/js/article.js` — same edit controls for each quote shown (using shared admin-actions.js)
- [x] Add admin edit controls to author page quote cards in `public/js/author.js` — same edit controls for each quote shown (using shared admin-actions.js)
- [x] Write tests verifying admin edit buttons appear on quote, article, and author pages when admin

## Phase 8: Google Image Search for Missing Author Photos ✅
- [x] When `isAdmin` and author has no photo (`!photoUrl`), render author name+disambiguation as a clickable link that opens Google Images search: `https://www.google.com/search?tbm=isch&q={encodeURIComponent(personName + ' ' + disambiguation)}` — apply in `public/js/home.js` `buildQuoteEntryHtml()` headshot placeholder area
- [x] Apply same Google Image search link to author detail page in `public/js/author.js` when no photo and admin
- [x] Apply same Google Image search link to article page quote cards in `public/js/article.js` when no photo and admin (reuses buildQuoteEntryHtml)
- [x] Apply same Google Image search link to quote detail page in `public/js/quote.js` when no photo and admin
- [x] Write test verifying Google Image search link is generated with correct URL encoding

## Phase 9: Move Quote Management to Review Page ✅
- [x] Add "Quote Management" tab/section to review page in `public/js/review.js` — add a tab bar with "Disambiguation Review" (existing) and "Quote Management" (new) tabs
- [x] Move quote management rendering logic from `public/js/settings.js` into `public/js/review.js` — search, pagination, quote cards with all admin actions (uses shared admin-actions.js)
- [x] Remove quote management section from `public/js/settings.js` settings page — delete the section HTML generation and related functions that were moved
- [x] No index.html changes needed — review.js already loaded
- [x] Write tests verifying quote management renders on review page and is absent from settings

## Phase 10: Reorganize Settings — Move News Sources Under Database ✅
- [x] Restructure settings page in `public/js/settings.js` — move the "News Sources" section to render inside/under the "Database" section as a subsection. Database section becomes "Data Management" with subsections: News Sources, Backup/Restore, Backfill Headshots
- [x] Update section navigation/headers in settings page to reflect new hierarchy
- [x] Update CSS in `public/css/styles.css` — added settings-subsection and subsection-title styles
- [x] Write tests verifying settings page structure shows news sources under data management
- [x] Run full test suite (`npx vitest run`) and verify ALL 309 tests pass — final verification
