# Build Progress

## Current Status
- **Current Phase:** 1
- **Last Updated:** not started
- **Last Commit:** none

## Phase 0: Environment & Prerequisites ✅
- [x] Existing codebase functional with 214+ passing tests
- [x] SQLite database schema stable (votes, topics, keywords tables exist)
- [x] Gemini API key configured for topic suggestion
- [x] Branch `SiteTopicFocusChanges` created from `main`

## Phase 1: Schema Migrations
- [ ] Add `importants` table — polymorphic (entity_type, entity_id, voter_hash) with UNIQUE constraint (see docs/SCHEMA_MIGRATIONS.md)
- [ ] Add `topic_keywords` junction table — links topics to keywords (see docs/SCHEMA_MIGRATIONS.md)
- [ ] Add `quote_datetime` column to `quotes` table (TEXT, nullable)
- [ ] Add `importants_count` column to `quotes`, `articles`, `persons`, `topics` tables (INTEGER DEFAULT 0)
- [ ] Add `share_count` column to `quotes`, `articles`, `persons`, `topics` tables (INTEGER DEFAULT 0)
- [ ] Add `view_count` column to `articles`, `persons`, `topics` tables (INTEGER DEFAULT 0)
- [ ] Add `trending_score` column to `quotes`, `articles`, `persons`, `topics` tables (REAL DEFAULT 0.0)
- [ ] Add `description` and `context` columns to `topics` table (TEXT, nullable)
- [ ] Add indexes for importants lookups and trending score ordering (see docs/SCHEMA_MIGRATIONS.md)
- [ ] Write unit tests for all new tables, columns, indexes, and constraints
- [ ] Verify all existing 214+ tests still pass with schema additions

## Phase 2: Important? Backend API
- [ ] Create `src/routes/importants.js` with POST `/api/importants/toggle` endpoint (see docs/IMPORTANTS_API.md)
- [ ] Add GET `/api/importants/status` endpoint — batch check important status for current voter
- [ ] Implement `getVoterHash(req)` using IP+UA hash (reuse pattern from votes.js)
- [ ] Implement importants_count increment/decrement on toggle in entity tables
- [ ] Emit Socket.IO `important_update` event on toggle
- [ ] Mount importants routes in `src/index.js`
- [ ] Remove old votes route mount from `src/index.js` (keep file for reference)
- [ ] Modify `src/routes/quotes.js` — replace `vote_score` with `importants_count` in GET responses
- [ ] Write integration tests for toggle, batch status, count sync, Socket.IO broadcast

## Phase 3: View & Share Tracking Backend
- [ ] Create `src/routes/tracking.js` with POST `/api/tracking/view` endpoint (see docs/VIEW_SHARE_TRACKING.md)
- [ ] Add POST `/api/tracking/share` endpoint — increment share_count on entity
- [ ] Mount tracking routes in `src/index.js`
- [ ] Write integration tests for view/share tracking endpoints

## Phase 4: Topics System Enhancement
- [ ] Add topic CRUD endpoints to `src/routes/admin.js` — create, update, delete topics with keywords (see docs/TOPICS_SYSTEM.md)
- [ ] Create `src/services/topicMaterializer.js` — populate `quote_topics` via keyword overlap between `topic_keywords` and `quote_keywords`
- [ ] Create `src/services/topicSuggester.js` — Gemini-based topic suggestion for uncategorized quotes
- [ ] Integrate topicMaterializer into `src/services/scheduler.js` — run after each fetch cycle
- [ ] Integrate topicSuggester into `src/services/scheduler.js` — run after materialization
- [ ] Add GET `/api/topics` and GET `/api/topics/:slug` public endpoints to a new `src/routes/topics.js`
- [ ] Write integration tests for topic CRUD, materialization, suggestion, and public endpoints

## Phase 5: Trending Score Calculation & Caching
- [ ] Create `src/services/trendingCalculator.js` — compute trending_score for quotes, articles, persons, topics (see docs/TRENDING_SYSTEM.md)
- [ ] Integrate trendingCalculator into `src/services/scheduler.js` — run after materializer
- [ ] Add recalculation trigger after important toggle in `src/routes/importants.js`
- [ ] Add recalculation trigger after share event in `src/routes/tracking.js`
- [ ] Add GET `/api/analytics/trending-topics` endpoint — paginated, sorted by trending_score
- [ ] Add GET `/api/analytics/trending-sources` endpoint — articles sorted by trending_score
- [ ] Add GET `/api/analytics/trending-quotes` endpoint — quote of day/week/month + recent sorted list
- [ ] Add GET `/api/analytics/all-sources` endpoint — all articles with quotes, newest first
- [ ] Write integration tests for trending calculation, caching, and all 4 tab endpoints

## Phase 6: Frontend — Homepage Tabs & Quote Block
- [ ] Create `public/js/important.js` — reusable Important? button component (see docs/HOMEPAGE_REDESIGN.md)
- [ ] Replace vote.js script tag with important.js in `public/index.html`
- [ ] Rewrite `public/js/home.js` — 4-tab system (Trending Topics, Trending Sources, Trending Quotes, All)
- [ ] Implement tab bar UI — all 4 tabs visible in portrait and landscape
- [ ] Implement Trending Topics tab content — topic cards with 3 quotes each, sort toggle
- [ ] Implement Trending Sources tab content — source cards with 3 quotes each, sort toggle
- [ ] Implement Trending Quotes tab content — Quote of Day/Week/Month + recent quotes list
- [ ] Implement All tab content — all sources with quotes, newest first
- [ ] Rewrite `buildQuoteEntryHtml()` — new layout per docs/HOMEPAGE_REDESIGN.md wireframe
- [ ] Add share buttons with share count display to quote blocks
- [ ] Add view tracking — fire POST `/api/tracking/view` when quote/topic/source enters viewport
- [ ] Write frontend unit tests for important component, tab switching, quote block rendering

## Phase 7: Frontend — Topic Page, Source Page, CSS Polish
- [ ] Add `/topic/:slug` route to `public/js/app.js` — renders topic page (see docs/HOMEPAGE_REDESIGN.md)
- [ ] Create topic page rendering function — full quote list with Important? and share
- [ ] Update `public/js/article.js` — rename labels "Article" to "Source", add Important? button
- [ ] Update `public/js/author.js` — replace vote controls with Important? button
- [ ] Update `public/js/quote.js` — replace vote controls with Important? button, add QuoteDateTime
- [ ] Add all new CSS to end of `public/css/styles.css` — tabs, quote block layout, important button, topic cards
- [ ] Write frontend unit tests for topic page rendering and updated pages

## Phase 8: Integration, Cleanup & Deployment
- [ ] Remove vote UI references from all frontend files (home, quote, author, article)
- [ ] Run full test suite — ALL tests pass
- [ ] Manual verification: homepage 4 tabs load correctly, Important? toggles work, trending scores update
- [ ] Verify Socket.IO broadcasts for important_update events
- [ ] Final commit: `phase-8: integration verification complete`
