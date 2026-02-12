# QuoteLog02 -- Historical Quote Backfill

Adding a parallel historical fetching system to backfill quotes from the past. Integrates with the existing fetch cycle, uses diverse source providers (Wikiquote, Chronicling America, Wayback Machine, GovInfo, American Presidency Project), and adds a Historical Sources settings section.

## Stack
- Same as parent: Node.js 20, Express, ESM, SQLite (better-sqlite3, WAL), Pinecone (sparse), Gemini 2.5 Flash, Socket.IO, Vanilla JS SPA
- No new dependencies beyond standard `node:` modules and existing packages

## Code Style
- ESM imports everywhere (`import`/`export`, no `require`)
- Each historical provider is a separate module in `src/services/historical/`
- Providers export a standard interface: `{ name, fetchArticles(limit, db, config), testConnection() }`
- All provider modules follow the existing `articleFetcher.js` rate-limiting pattern
- Frontend: vanilla JS template literals, `onclick` attributes, `showToast()`, `escapeHtml()`
- New CSS appended at END of `public/css/styles.css`

## Architecture
- `src/services/historical/` -- Provider modules (one per source)
- `src/services/historical/index.js` -- Provider registry, orchestrator
- `src/services/historicalFetcher.js` -- Integration point called from scheduler
- `src/routes/historicalSources.js` -- CRUD API for historical sources (admin only)
- `historical_sources` table -- Separate from RSS `sources` table
- Articles from historical sources use the SAME `articles` table (with `historical_source_id` column)
- Quote extraction reuses the existing Gemini pipeline (`quoteExtractor.js`)

## Testing -- MANDATORY
- `npx vitest run` after every change
- Unit tests: `tests/unit/historical-*.test.js`
- Integration tests: `tests/integration/historical-*.test.js`
- Tests FIRST, then implementation
- Never modify existing tests

## Verification
```
npx vitest run
```
ALL tests must pass.

## Git
- One commit per task: `git add -A && git commit -m "phase-N: description"`
- Never force push. Never amend published commits.

## Sensitive Areas
- `src/config/database.js` -- Migrations MUST use `PRAGMA table_info` guard
- `src/services/scheduler.js` -- Must NOT break existing RSS fetch cycle
- `src/index.js` -- Route mounting order matters
- Existing `articles` table -- New columns must not conflict with existing queries

## When Stuck
- Check existing patterns in `src/services/articleFetcher.js` and `src/routes/sources.js`
- Read test files for usage examples
- Add `BLOCKED: reason` note to PROGRESS.md and move on

## Known Mistakes to Avoid
- Historical providers MUST handle network errors gracefully (try/catch, consecutive_failures tracking)
- Wikiquote/Wikipedia content needs HTML stripping before Gemini extraction
- Wayback Machine CDX API returns CSV not JSON by default -- use `output=json`
- GovInfo requires a free API key from api.data.gov -- store as `GOVINFO_API_KEY` env var
- Chronicling America returns OCR text -- quality varies, set min text length threshold (500 chars)
- `articles.url` is UNIQUE -- historical articles must have unique URLs to avoid duplicates
- Rate limit all external APIs: max 1 request/second per provider
- Scheduler Phase 2 query uses `JOIN sources` -- must change to LEFT JOIN to include historical articles
- `prefetched_text` column needed for providers returning full text (Wikiquote, GovInfo, Presidency Project)
