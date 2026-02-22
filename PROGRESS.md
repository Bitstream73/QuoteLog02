# Build Progress

## Current Status
- **Current Phase:** COMPLETE
- **Last Updated:** 2026-02-22
- **Last Commit:** phase-10: add integration tests and verify all phases complete

## Phase 0: Prerequisites ✅
- [x] Existing project with passing test suite (`npx vitest run`)
- [x] SQLite database initialized with all current tables
- [x] Node.js/Express server running with ESM modules

## Phase 1: Database Schema & Settings ✅
- [x] Add `noteworthy_card_configs` and `noteworthy_collections` tables in `src/config/database.js` (see `docs/SCHEMA.md`)
- [x] Seed default card configs (28 card types, all disabled) and pepper settings keys via `INSERT OR IGNORE`
- [x] Write tests: verify tables exist, columns correct, seeds present, CRUD operations work

## Phase 2: Settings Page Tab Restructure ✅
- [x] Add settings tab bar CSS to `public/css/styles.css` (follow existing `.review-tab-bar` pattern)
- [x] Refactor `renderSettings()` in `public/js/settings.js`: wrap sections in tab containers, add tab bar HTML, implement `switchSettingsTab()` (see `docs/SETTINGS_TABS.md` for section→tab mapping)
- [x] Write tests: settings page renders, tab switching shows/hides correct content

## Phase 3: Noteworthy Card Config Backend ✅
- [x] Add CRUD routes in `src/routes/admin.js`: GET/POST/PATCH/DELETE `/api/admin/noteworthy-configs` and `/api/admin/noteworthy-collections`
- [x] Add GET `/api/noteworthy/evaluated` public endpoint in `src/routes/search.js` — returns computed data for all enabled card configs (time-based evaluation, search metadata, info content)
- [x] Add pepper settings to GET `/api/settings` response (frequency, chance, pick_mode, reuse)
- [x] Write tests: all CRUD operations, evaluated endpoint returns correct time-based data, pepper settings included

## Phase 4: Noteworthy Cards Settings UI ✅
- [x] Build card config list UI in the Noteworthy Cards settings tab: list of all card configs with enable/disable toggle, custom title edit, collection assignment, drag-to-reorder
- [x] Build pepper settings UI: frequency input, chance slider, sequential/random toggle, reuse toggle (see `docs/CARD_CONFIGS.md`)
- [x] Write tests: card config list renders, toggles work, pepper settings save/load correctly

## Phase 5: Homepage Restructure ✅
- [x] Remove tab bar (`buildTabBarHtml`, `switchHomepageTab`, `renderTabContent`) and move quotes infinite scroll to top of homepage content area; remove standalone noteworthy section (`buildNoteworthySectionHtml` call in `renderHome`)
- [x] Clean up tab state variables (`_activeTab`, `_authorsPage`, `_sourcesPage`, etc.) and simplify `loadMoreItems()` to only handle quotes
- [x] Write tests: homepage renders quotes scroll without tabs, noteworthy section removed, infinite scroll still works

## Phase 6: Swipe Gesture System ✅
- [x] Create `public/js/swipe.js` module: touch event handlers (touchstart/touchmove/touchend) for swipe-left (navigate to detail) and swipe-right (back to scroll position), with configurable threshold and velocity
- [x] Add slide transition CSS classes (`.slide-container`, `.slide-left`, `.slide-right`, `.slide-active`) and wire swipe handlers to `.quote-block` and noteworthy card elements via event delegation in `home.js`
- [x] Write tests: swipe detection logic (threshold, direction, velocity), slide class toggling, scroll position preservation

## Phase 7: Time-Based Card Evaluation Engine ✅
- [x] Create `src/services/noteworthyEvaluator.js`: time window helpers (`getTimeWindowStart(period)` for hour/day/week/month) and evaluators for Quote-of-X (highest importants_count quote in window, with optional filter), Author-of-X (person with highest aggregate importants across their quotes)
- [x] Add evaluators for Source-of-X (source_author with highest aggregate importants), Topic-of-X, Category-of-X — each returns entity + top 3 quotes by importants_count
- [x] Write tests: each evaluator returns correct data for given time window, handles empty results, respects filter config

## Phase 8: New Card Type Renderers ✅
- [x] Build frontend renderers for time-based cards: `buildTimedQuoteCardHtml()`, `buildTimedAuthorCardHtml()`, `buildTimedSourceCardHtml()`, `buildTimedTopicCardHtml()`, `buildTimedCategoryCardHtml()` — each with custom title, entity data, top quotes, and tap/swipe-to-reveal behavior
- [x] Build search card renderers: `buildSearchCardHtml(searchType)` with subhead text, full-width search bar, autocomplete dropdown — 4 types (topic, quote_text, source_author, source)
- [x] Build info card renderers: `buildInfoCardHtml(infoType)` for Importance, Fact Check, Bug Report, Donate — each with descriptive text and relevant icon/image
- [x] Write tests: each renderer produces valid HTML, search cards trigger autocomplete, info cards display correct content

## Phase 9: Card Peppering System ✅
- [x] Implement peppering algorithm in `public/js/home.js`: after loading each page of quotes, determine insertion points based on `noteworthy_pepper_frequency` and `noteworthy_pepper_chance`; pick next card from enabled configs using sequential or random mode; handle reuse toggle
- [x] Implement collection grouping: cards in the same collection render as a horizontal scroll row (`.noteworthy-section__scroll` pattern); wire Socket.IO `fetch_cycle_complete` event to re-evaluate time-based cards
- [x] Write tests: peppering inserts cards at correct intervals, respects chance percentage, sequential/random modes work, collections group correctly, re-evaluation updates cards

## Phase 10: Integration & Verification ✅
- [x] Write end-to-end integration tests: peppered scroll renders mixed quotes and cards, swipe gestures navigate correctly, settings round-trip (save → reload → verify), card evaluation produces fresh data after mock fetch
- [x] Run full test suite (`npx vitest run`), fix any regressions, verify all phases complete
