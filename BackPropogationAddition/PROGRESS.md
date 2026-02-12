# Build Progress

## Current Status
- **Current Phase:** 7
- **Last Updated:** 2026-02-12
- **Last Commit:** phase-6: add historical sources frontend settings section with provider rows, toggles, and tests

## Phase 0: Prerequisites ✅
- [x] Existing codebase functional with passing tests
- [x] SQLite database schema stable
- [x] Gemini API key configured for quote extraction
- [x] All existing RSS fetching and quote extraction working

## Phase 1: Database Schema ✅
- [x] Add `historical_sources` table to `src/config/database.js` `initializeTables()` with seed data for 5 default providers (see docs/DATABASE.md)
- [x] Add `historical_source_id` column to `articles` table with migration guard (see docs/DATABASE.md)
- [x] Add `prefetched_text` column to `articles` table with migration guard (see docs/DATABASE.md)
- [x] Add default settings `historical_fetch_enabled` and `historical_articles_per_source_per_cycle` to settings seed (see docs/DATABASE.md)
- [x] Write unit tests in `tests/unit/historical-schema.test.js` verifying new table, columns, and settings exist
- [x] Run `npx vitest run` -- verify all existing tests still pass with schema additions

## Phase 2: Historical Provider Framework ✅
- [x] Create `src/services/historical/providerInterface.js` -- base class that all providers extend (see docs/HISTORICAL_SOURCES.md)
- [x] Create `src/services/historical/index.js` -- provider registry with `getEnabledProviders()`, `getProviderByKey()`, `getAllProviders()` (see docs/HISTORICAL_SOURCES.md)
- [x] Create `src/services/historicalFetcher.js` -- orchestrator that iterates enabled providers, fetches articles, inserts into articles table (see docs/SCHEDULER.md)
- [x] Write unit tests for provider registry and orchestrator with mock providers

## Phase 3: Historical Source Providers ✅
- [x] Create `src/services/historical/wikiquoteProvider.js` -- fetches quotes from Wikiquote via MediaWiki API (see docs/HISTORICAL_SOURCES.md)
- [x] Create `src/services/historical/chroniclingAmericaProvider.js` -- fetches historical newspaper pages from Library of Congress API (see docs/HISTORICAL_SOURCES.md)
- [x] Create `src/services/historical/waybackProvider.js` -- fetches historical snapshots via Wayback Machine CDX API (see docs/HISTORICAL_SOURCES.md)
- [x] Create `src/services/historical/govInfoProvider.js` -- fetches Congressional Record speeches via GovInfo API (see docs/HISTORICAL_SOURCES.md)
- [x] Create `src/services/historical/presidencyProjectProvider.js` -- fetches presidential speeches from American Presidency Project (see docs/HISTORICAL_SOURCES.md)
- [x] Write unit tests for each provider with mocked HTTP responses in `tests/unit/historical-providers.test.js`

## Phase 4: Scheduler Integration ✅
- [x] Modify `src/services/scheduler.js` to add Phase 1.5 (historical fetch) between RSS discovery and article processing (see docs/SCHEDULER.md)
- [x] Add `historical_fetch_enabled` setting check -- skip historical phase if disabled
- [x] Update Phase 2 pending query from JOIN to LEFT JOIN to include historical articles (see docs/SCHEDULER.md)
- [x] Modify `processArticle` in `src/services/articleFetcher.js` to check `prefetched_text` before URL extraction
- [x] Write integration tests verifying scheduler calls historical fetcher and historical articles get processed

## Phase 5: Backend API Routes ✅
- [x] Create `src/routes/historicalSources.js` with GET `/api/historical-sources` (see docs/API.md)
- [x] Add PATCH `/api/historical-sources/:key` for toggling providers, admin only (see docs/API.md)
- [x] Add POST `/api/historical-sources/:key/test` for testing provider connections, admin only (see docs/API.md)
- [x] Add GET `/api/historical-sources/stats` for fetch statistics (see docs/API.md)
- [x] Mount routes in `src/index.js`: `app.use('/api/historical-sources', historicalSourcesRouter)`
- [x] Write integration tests in `tests/integration/historical-sources.test.js` for all endpoints

## Phase 6: Frontend -- Historical Sources Settings Section ✅
- [x] Add "Historical Sources" settings section to `public/js/settings.js` with enable toggle and per-cycle limit (see docs/API.md)
- [x] Render provider rows with name, description, status dot, enabled toggle, and Test button
- [x] Wire toggle to PATCH and test button to POST endpoints with showToast feedback
- [x] Add CSS for `.historical-source-row`, `.status-dot`, `.status-dot-working/failed/disabled` at end of `public/css/styles.css`
- [x] Write frontend tests in `tests/unit/historical-frontend.test.js`

## Phase 7: Integration Testing & Verification
- [ ] Run full test suite: `npx vitest run` -- all tests pass
- [ ] Verify historical sources section renders in settings page
- [ ] Verify scheduler runs historical phase without breaking RSS phase
- [ ] Final commit: `phase-7: integration verification complete`
