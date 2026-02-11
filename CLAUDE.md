# QuoteLog02 — AI-Powered News Quote Extraction App

## Stack
- **Backend:** Node.js + Express (ESM modules, `"type": "module"`)
- **Database:** SQLite (WAL mode, better-sqlite3), Pinecone (sparse vectors)
- **AI:** Gemini 2.5 Flash (text extraction only)
- **Real-time:** Socket.IO
- **Frontend:** Vanilla JS SPA (no framework), CSS custom properties for theming
- **Testing:** Vitest (`npx vitest run`), 122+ tests, `fileParallelism: false`
- **Deploy:** Railway (Docker, volume at /app/data)

## Code Style
- ESM imports everywhere (`import/export`, no `require`)
- Vanilla JS frontend — no React/Vue/Angular; DOM manipulation via template literals
- API wrapper in `public/js/api.js` — use `api.get()`, `api.post()`, `api.patch()`, `api.delete()`
- Toast notifications via `showToast(message, type)` — never use `alert()`
- HTML escaping via `escapeHtml()` for all user-generated content
- `showConfirmToast(message, onConfirm)` for destructive actions

## Architecture
- **Backend routes:** `src/routes/*.js` (auth, quotes, articles, sources, authors, admin, review, settings, analytics, votes, logs)
- **Database:** `src/config/database.js` — migrations via `ALTER TABLE ADD COLUMN` with `PRAGMA table_info` guard
- **Frontend SPA:** `public/js/app.js` (router), page modules: `home.js`, `settings.js`, `review.js`, `author.js`, `article.js`, `quote.js`, `analytics.js`, `login.js`
- **Styles:** `public/css/styles.css` (single file, CSS custom properties)
- **Admin detection:** Backend `isAdminRequest(req)` for non-blocking check; `requireAdmin` middleware for protected routes
- **Frontend admin:** Global `isAdmin` variable set by `checkAuth()` on page load

## Testing — MANDATORY
- Run `npx vitest run` after every code change
- Unit tests: `tests/unit/*.test.js`
- Integration tests: `tests/integration/*.test.js`
- Tests share SQLite — `fileParallelism: false` is critical
- Write tests FIRST, then implement

## Verification — Run Before Declaring Done
```bash
npx vitest run
```
ALL tests must pass. No skipping, no `.skip`, no `--bail`.

## Git
- One commit per task: `git add -A && git commit -m "phase-N: description"`
- Never force push. Never amend published commits.

## Sensitive Areas — Extra Caution
- `src/config/database.js` — migration pattern must use column-existence checks
- `public/js/app.js` — SPA router, auth state, Socket.IO — changes cascade everywhere
- Admin auth cookie (`auth_token`) — JWT, HTTP-only, 7-day expiry

## When Stuck
- Check existing patterns in adjacent files before inventing new ones
- Read the test files for usage examples
- Add `BLOCKED` note to PROGRESS.md and move on

## Known Mistakes to Avoid
- `better-sqlite3` `db.backup()` is ASYNC — must await
- Pinecone index is SPARSE — never send dense vectors
- `showToast()` not `alert()` — alerts are banned
- DOM event delegation: use `onclick` attributes in template literals (existing pattern)
- Settings page sections use `id="settings-section-*"` with toggle visibility
