# Build Progress — Admin Edit Capabilities

## Current Status
- **Current Phase:** 5
- **Last Updated:** 2026-02-12
- **Last Commit:** b0c9142

---

## Phase 0: Environment & Branch Setup ✅
- [x] Verify admin login credentials at https://whattheysaid.news/login
- [x] Create branch `AdminEditCapabilitiesChanges` off `main`

---

## Phase 1: Backend — SuperImportant Endpoint ✅
- [x] Write integration tests for `POST /api/importants/super-toggle` in `tests/integration/importants.test.js`. Tests: 401 without auth, +100 increment on valid call, proper response with updated `importants_count`, Socket.IO `important_update` emission, 404 for nonexistent entity. See `docs/SUPER-IMPORTANT.md`.
- [x] Implement `POST /api/importants/super-toggle` in `src/routes/importants.js`. Admin-only endpoint using `requireAdmin` middleware. Validates entity_type/entity_id against existing TABLE_MAP. Increments `importants_count` by 100 (no voter_hash row). Recalculates trending score. Emits Socket.IO `important_update`. Returns `{ success, importants_count }`. See `docs/SUPER-IMPORTANT.md`.

---

## Phase 2: Backend — Quote Keywords/Topics CRUD ✅
- [x] Write integration tests for quote-level keyword/topic endpoints in new file `tests/integration/quote-keywords.test.js`. Tests: `GET /api/quotes/:id/keywords-topics` returns both arrays; `POST /api/admin/quotes/:id/keywords` links keyword (create-and-link if new); `DELETE /api/admin/quotes/:id/keywords/:keywordId` unlinks; `POST /api/admin/quotes/:id/topics` links topic; `DELETE /api/admin/quotes/:id/topics/:topicId` unlinks. POST/DELETE require admin. See `docs/KEYWORD-TOPIC-CRUD.md`.
- [x] Implement `GET /api/quotes/:id/keywords-topics` in `src/routes/quotes.js`. Returns `{ keywords: [{id, name, keyword_type}], topics: [{id, name, slug}] }` by joining through `quote_keywords` and `quote_topics` tables. No auth required (read-only).
- [x] Implement `POST/DELETE /api/admin/quotes/:id/keywords` in `src/routes/admin.js`. POST accepts `{ name, keyword_type? }`, upserts into `keywords` table (normalize name), inserts into `quote_keywords`. DELETE removes from `quote_keywords`. Both require `requireAdmin`. See `docs/KEYWORD-TOPIC-CRUD.md`.
- [x] Implement `POST/DELETE /api/admin/quotes/:id/topics` in `src/routes/admin.js`. POST accepts `{ topic_id }` or `{ name }` (create-and-link with auto-slug). DELETE removes from `quote_topics`. Both require `requireAdmin`. See `docs/KEYWORD-TOPIC-CRUD.md`.

---

## Phase 3: Backend — Standalone Keyword CRUD ✅
- [x] Write integration tests for standalone keyword CRUD in `tests/integration/quote-keywords.test.js`. Tests: `GET /api/admin/keywords` lists all with quote counts; `POST /api/admin/keywords` creates with name+type; `PATCH /api/admin/keywords/:id` updates name/type; `DELETE /api/admin/keywords/:id` cascade-deletes from `quote_keywords` and `topic_keywords`. All require admin. See `docs/KEYWORD-TOPIC-CRUD.md`.
- [x] Implement keyword CRUD routes in `src/routes/admin.js`. GET `/admin/keywords` with LEFT JOIN for quote count. POST `/admin/keywords` with name normalization. PATCH `/admin/keywords/:id`. DELETE `/admin/keywords/:id` with cascade. All use `requireAdmin`. See `docs/KEYWORD-TOPIC-CRUD.md`.

---

## Phase 4: Frontend — Important Button Redesign ✅
- [x] Write unit tests for important button rendering in `tests/unit/important-button.test.js`. Tests: (a) non-admin `renderImportantButton()` output does NOT contain count number, only "Important?" text; (b) admin output contains count AND a SuperImportant button element; (c) SuperImportant button has correct onclick handler. Import and test the render function directly.
- [x] Modify `renderImportantButton()` in `public/js/important.js` to accept optional `adminView` param (defaults to global `isAdmin`). Non-admin: render "Important?" without count number. Admin: render "Important? {count}" plus `[SuperImportant]` button with `onclick="handleSuperImportant(event, '${entityType}', ${entityId})"`. Add `handleSuperImportant()` function that calls `API.post('/importants/super-toggle', { entity_type, entity_id })`, updates count span, shows toast. Update all callers in `home.js`, `quote.js`, `author.js` (search for `renderImportantButton` calls).

---

## Phase 5: Frontend — Review Page Tab Reorder & Badge
- [ ] Write unit tests for review page defaults in `tests/unit/review-tabs.test.js`. Tests: (a) default active tab variable is `'quotes'` not `'disambiguation'`; (b) tab render order has Quote Management first; (c) disambiguation tab includes badge element with pending count.
- [ ] Modify `public/js/review.js`: Change `_reviewActiveTab` default from `'disambiguation'` to `'quotes'` (line 3). In `renderReview()`, swap tab button HTML order so Quote Management appears first. Add `<span class="disambig-tab-badge" id="disambig-tab-badge"></span>` inside Disambiguation Review tab button. Create `updateDisambigTabBadge(count)` function called alongside existing `updateReviewBadge()`. Badge shows count if > 0. See `docs/REVIEW-SETTINGS-UI.md`.

---

## Phase 6: Frontend — Admin Quote Block Redesign
- [ ] Create `buildAdminQuoteBlockHtml(q, topics, isImportant, keywords)` function in `public/js/home.js`. Returns expanded admin layout: full-width quote text (no truncation), `[Quote context]`, `[Quote Datetime]`, circular author portrait + name + badges + description (clickable → `/author/:personId`), source URL link + top 2 topic tags, share buttons + Important? with count + SuperImportant, stats row (ViewCount, SharesCount, ImportantsCount), edit buttons row [Quote] [Context] [Topics] [Sources] [Author] [Photo]. Each edit button calls the appropriate `prompt()` + `API.patch()`. See `docs/ADMIN-QUOTE-BLOCK.md`.
- [ ] Add keywords/topics sections to admin quote block. After the edit buttons row, render: "Keywords [Edit] [Create Keyword]:" followed by keyword chips; "Topics [Edit] [Create Topic]:" followed by topic chips. Lazy-load data from `GET /api/quotes/:id/keywords-topics` when block renders. [Create Keyword] calls `prompt()` then `POST /api/admin/quotes/:id/keywords`. [Create Topic] calls `prompt()` then `POST /api/admin/quotes/:id/topics`. [Edit] on individual chips calls `prompt()` for rename. See `docs/ADMIN-QUOTE-BLOCK.md`.
- [ ] Modify `buildQuoteBlockHtml()` in `public/js/home.js` to call `buildAdminQuoteBlockHtml()` when `isAdmin === true`. Non-admin rendering stays unchanged. Verify with Puppeteer that admin sees expanded blocks and non-admin sees original blocks.

---

## Phase 7: Frontend — Trending Topics Tab Admin View
- [ ] Modify `renderTrendingTopicsTab()` and `buildTopicCardHtml()` in `public/js/home.js`. When `isAdmin`: render topic name as heading, show context, use admin quote blocks for the 3 quotes, show topic-level Important? + count + SuperImportant, show stats row, add [Topic] edit button (calls `prompt()` + `PUT /api/admin/topics/:id`). See `docs/ADMIN-QUOTE-BLOCK.md`.
- [ ] Add keyword management to admin topic cards. Modify `GET /api/analytics/trending-topics` in `src/routes/analytics.js` to return each topic's keywords (join through `topic_keywords`→`keywords`). Render keyword chips in topic card footer: "Keywords [Edit] [Create Keyword]:" + chips. [Create] calls `prompt()` then `PUT /api/admin/topics/:id` with updated keywords. [Edit] renames individual keyword. See `docs/KEYWORD-TOPIC-CRUD.md`.

---

## Phase 8: Frontend — Trending Sources & All Tab Admin View
- [ ] Modify `buildSourceCardHtml()` in `public/js/home.js`. When `isAdmin`: render source name as heading, show context, use admin quote blocks for the 3 quotes, show source-level stats row (ViewCount, SharesCount, ImportantsCount), show keyword/topic management sections (same pattern as topic cards). See `docs/ADMIN-QUOTE-BLOCK.md`.
- [ ] Verify `renderAllTab()` in `public/js/home.js` correctly inherits admin formatting from the shared `buildSourceCardHtml()` function. Add any missing admin-specific elements. Puppeteer verify both Trending Sources and All tabs render correctly in admin mode.

---

## Phase 9: Frontend — Trending Quotes Tab Admin View
- [ ] Verify `renderTrendingQuotesTab()` in `public/js/home.js` uses admin quote blocks for Quote of Day/Week/Month and Recent Quotes (automatic after Phase 6 since it calls `buildQuoteBlockHtml()`). Ensure sort toggles (Date/Importance) work with admin blocks. Add small italic disclaimer text: "*Trending quotes change over time as views and shares change". Puppeteer verify the quotes tab in admin mode.

---

## Phase 10: Frontend — Navigation Links
- [ ] Verify and fix navigation in admin quote blocks: clicking quote text, author name, author description, or author portrait navigates to `/author/:personId`; clicking source URL or quote context navigates to the source page (`/article/:articleId`). Test in Puppeteer: click an author name in an admin quote block and confirm navigation to the author page. Click source link and confirm navigation to article page.

---

## Phase 11: Frontend — Settings Page Source Twirl-Down
- [ ] Write unit test for settings page source list collapsibility in `tests/unit/settings-ui.test.js`. Test: sources list renders inside a `<details>` element; the element is closed by default.
- [ ] Modify `public/js/settings.js` Data Management → Sources section. Wrap `#sources-list` in `<details><summary>Sources (N)</summary>...</details>` HTML5 disclosure element, closed by default. Keep the Add Source form (domain, display name, RSS URL inputs + Add Source button) visible above the twirl-down. Update `renderSourcesList()` to set the summary text with count. See `docs/REVIEW-SETTINGS-UI.md`.

---

## Phase 12: CSS Styling
- [ ] Add CSS for admin components in `public/css/styles.css`: `.admin-quote-block` (expanded layout with padding), `.super-important-btn` (gold/orange color, distinct from regular important), `.admin-edit-buttons` (flex row of small edit buttons), `.admin-keywords-section` and `.admin-topics-section` (sections with label + chips), `.keyword-chip` and `.topic-chip` (inline pill/tag styles), `.admin-stats-row` (muted stats display), `.disambig-tab-badge` (overlay notification bubble matching existing `#review-badge` style).
- [ ] Add CSS for settings twirl-down in `public/css/styles.css`: `details.sources-details` styling to match settings-section aesthetic, `summary` cursor pointer and padding, open/closed chevron indicator. Ensure responsive layout on mobile.

---

## Phase 13: Integration Testing & Cache Busting
- [ ] Run full test suite (`npx vitest run`). ALL 122+ existing tests plus new tests must pass. Fix any regressions. Do not proceed until green.
- [ ] Bump cache version in `public/index.html`: update all `?v=N` query strings to next version. Update service worker cache version in `public/sw.js` if present. Commit as `phase-13: bump cache version`.
