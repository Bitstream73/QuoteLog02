# QuoteLog02 — Site Topic Focus Overhaul

Replacing upvote/downvote with "Important?" system, adding 4-tab homepage (Trending Topics, Trending Sources, Trending Quotes, All), enhanced Topics with keyword-based population, and cached trending scores.

## Stack
- **Backend:** Node.js 20, Express, ESM modules (`"type": "module"`)
- **Database:** SQLite (better-sqlite3, WAL mode), Pinecone (sparse vectors)
- **Frontend:** Vanilla JS SPA, custom router (no framework)
- **Real-time:** Socket.IO
- **AI:** Gemini 2.5 Flash (quote extraction + topic suggestion)
- **Testing:** Vitest (`fileParallelism: false` — shared SQLite)
- **Deploy:** Railway with Docker, volume at /app/data

## Code Style
- ESM imports (`import`/`export`, no `require`)
- Route handlers: `async (req, res) => { try/catch -> res.json or res.status }`
- Database: synchronous better-sqlite3 queries via `getDb()`
- Frontend: vanilla JS, no build step, `onclick` attributes in template literals
- CSS custom properties for theming, new styles appended at END of `styles.css`
- Toast notifications via `showToast()` — never `alert()`
- HTML escaping via `escapeHtml()` for all user content

## Architecture
- `src/routes/*.js` — Express route modules mounted in `src/index.js`
- `src/config/database.js` — Schema + migrations via `ALTER TABLE ADD COLUMN` with `PRAGMA table_info` guard
- `src/services/*.js` — Business logic (scheduler, topicMaterializer, trendingCalculator, topicSuggester)
- `public/js/*.js` — SPA pages loaded by `app.js` router
- `public/css/styles.css` — All styles, mobile-responsive
- Admin auth via JWT cookie; public users are anonymous
- Socket.IO broadcasts from server to all clients

## Testing — MANDATORY
- Run: `npx vitest run` from project root
- Unit tests: `tests/unit/*.test.js`
- Integration tests: `tests/integration/*.test.js`
- NEVER modify existing tests to pass — fix the code
- New features MUST have tests before implementation
- Use `supertest` for API endpoint tests

## Verification — Run Before Declaring Done
```bash
npx vitest run
```
ALL tests must pass. No skipping, no `.skip`, no `--bail`.

## Git
- One commit per task: `git add -A && git commit -m "phase-N: description"`
- Do NOT push — local commits only (push handled separately)
- Never force push. Never amend published commits.

## Sensitive Areas — Extra Caution
- `src/config/database.js` — migrations must use column-existence checks (`PRAGMA table_info`)
- `public/js/home.js` — Complete rewrite for 4-tab system; high-risk file
- `public/js/app.js` — SPA router, auth state, Socket.IO — changes cascade everywhere
- `src/services/scheduler.js` — Must integrate materializer + trending calculator post-fetch

## When Stuck
- Check existing patterns in adjacent files before inventing new ones
- Read test files for usage examples
- Check `PROGRESS.md` for blocked task notes from prior iterations
- `git log --oneline -20` to see what was done previously
- Add `BLOCKED: reason` note to PROGRESS.md and move on

## Known Mistakes to Avoid
- `better-sqlite3` `db.backup()` is ASYNC — must await
- Pinecone index is SPARSE — never send dense vectors
- `showToast()` not `alert()` — alerts are banned
- Vitest `fileParallelism: false` is required — do not change
- Sources table `domain` is NOT UNIQUE — multiple feeds per domain
- Font stack: Playfair Display (headings), Source Serif 4 (body), Inter (UI)
- `importants` table is polymorphic (`entity_type` + `entity_id`) — not quote-only
- Trending scores cached in columns — recalculated after fetch cycles, not on every page load
