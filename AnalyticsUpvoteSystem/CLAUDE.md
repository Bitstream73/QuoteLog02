# QuoteLog02 — Upvote & Analytics Feature

AI-powered news quote app gaining Reddit-style voting and an insights analytics modal.

## Stack
- **Backend:** Node.js 20, Express, ESM modules (`"type": "module"`)
- **Database:** SQLite (better-sqlite3, WAL mode), Pinecone (sparse vectors)
- **Frontend:** Vanilla JS SPA, custom router (no framework)
- **Real-time:** Socket.IO
- **AI:** Gemini 2.5 Flash (quote extraction only)
- **Testing:** Vitest (`fileParallelism: false` — shared SQLite)
- **Deploy:** Railway with Docker, volume at /app/data

## Code Style
- ESM imports (`import`/`export`, no `require`)
- Single quotes, 2-space indent, semicolons
- Route handlers: async (req, res) => { try/catch → res.json or res.status }
- Database: synchronous better-sqlite3 queries via `getDb()`
- Frontend: vanilla JS, no build step, newspaper editorial theme
- CSS: BEM-ish naming, CSS custom properties for theming

## Architecture
- `src/routes/*.js` — Express route modules mounted in `src/index.js`
- `src/config/database.js` — Schema creation, `getDb()` singleton
- `public/js/*.js` — SPA pages loaded by `app.js` router
- `public/css/styles.css` — All styles, mobile-responsive
- Quotes display in article groups on homepage (`home.js`)
- Quotes also appear on `/quote/:id`, `/author/:id`, `/article/:id` pages
- Admin auth via session cookie; public users are anonymous
- Socket.IO broadcasts from server to all clients

## Testing — MANDATORY
- Run: `npx vitest run` from project root
- Unit tests: `tests/unit/*.test.js`
- Integration tests: `tests/integration/*.test.js`
- Test DB: `./tests/integration-test.db` (cleaned per run)
- NEVER modify existing tests to pass — fix the code
- New features MUST have tests before implementation
- Use `supertest` for API endpoint tests

## Verification — Run Before Declaring Done
1. `npx vitest run` — all 122+ tests pass
2. Manual: new vote endpoints return correct data
3. Manual: analytics endpoints return correct aggregates
4. Verify vote UI renders on home, quote, author, article pages
5. Verify analytics modal opens/closes from header

## Git
- One commit per task: `git add -A && git commit -m "phase-N: description"`
- Commit message format: `phase-N: lowercase imperative description`
- Do NOT push — local commits only

## Sensitive Areas — Extra Caution
- `src/config/database.js` — Schema changes must be additive (new tables/columns only)
- `public/js/home.js` — Complex rendering logic, 770+ lines, test carefully
- `public/js/quote.js`, `author.js`, `article.js` — Quote display in multiple places
- `src/routes/quotes.js` — Main API, must not break existing query patterns
- `public/css/styles.css` — 2100+ lines, add new styles at end, respect theme vars

## When Stuck
- Read existing route/page code to match patterns exactly
- Check `PROGRESS.md` for blocked task notes from prior iterations
- SQLite schema in `src/config/database.js` — search for `CREATE TABLE`
- Frontend rendering in `public/js/home.js` — search for `renderQuote`
- If a task fails 3 times, mark it BLOCKED in PROGRESS.md and move on

## Known Mistakes to Avoid
- Do NOT use `db.backup()` without await — it returns a Promise
- Do NOT add UNIQUE constraint on sources.domain — multiple feeds per domain
- Vitest `fileParallelism: false` is required — do not change
- Vote deduplication: use voter_hash (IP+UA hash), NOT cookies (anonymous users)
- Analytics queries: use SQLite date functions, NOT JS date math on full result sets
- Add new CSS at END of styles.css — do not reorganize existing rules
- Font stack: Playfair Display (headings), Source Serif 4 (body), Inter (UI)
