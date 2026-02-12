# QuoteLog02 — Admin Edit Capabilities Branch

AI-powered news quote extraction app. This branch adds comprehensive admin CRUD UI throughout the application.

## Stack
- **Backend:** Node.js + Express (ESM modules, `"type": "module"`)
- **Database:** SQLite (WAL mode, better-sqlite3), Pinecone (sparse vectors)
- **AI:** Gemini 2.5 Flash (text extraction only — NOT for embeddings)
- **Real-time:** Socket.IO
- **Frontend:** Vanilla JS SPA (no framework), CSS custom properties
- **Testing:** Vitest (`npx vitest run`), 122+ tests, `fileParallelism: false`
- **Deploy:** Railway (Docker, volume at /app/data)

## Code Style
- ESM imports everywhere (`import/export`, no `require`)
- Vanilla JS frontend — no React/Vue/Angular; DOM manipulation via template literals
- API wrapper: `API.get()`, `API.post()`, `API.patch()`, `API.delete()` (public/js/api.js)
- Toast notifications: `showToast(message, type)` — never use `alert()`
- HTML escaping: `escapeHtml()` for all user-generated content
- Destructive actions: `showConfirmToast(message, onConfirm)`
- Edit pattern: `prompt()` dialogs for inline edits (existing pattern — do NOT introduce modals)

## Architecture
- **Backend routes:** `src/routes/*.js` (auth, quotes, articles, sources, authors, admin, review, settings, analytics, importants, tracking, logs)
- **Database:** `src/config/database.js` — migrations via `ALTER TABLE ADD COLUMN` with `PRAGMA table_info` guard
- **Frontend SPA:** `public/js/app.js` (router), pages: `home.js`, `settings.js`, `review.js`, `author.js`, `article.js`, `quote.js`, `analytics.js`
- **Styles:** `public/css/styles.css` (single file, CSS custom properties)
- **Admin detection:** Backend `isAdminRequest(req)` non-blocking; `requireAdmin` middleware for protected routes
- **Frontend admin:** Global `isAdmin` variable set by `checkAuth()` on page load
- **Important system:** Polymorphic `importants` table, `renderImportantButton()` in `public/js/important.js`

## Testing — MANDATORY
- Run `npx vitest run` after EVERY code change
- Unit tests: `tests/unit/*.test.js`
- Integration tests: `tests/integration/*.test.js`
- Tests share SQLite — `fileParallelism: false` is critical
- Write tests FIRST, then implement
- Auth helper: `tests/helpers/auth.js` provides `getAuthCookie()`

## Visual Verification — MANDATORY for UI Changes
- Use Puppeteer to verify UI changes at `https://whattheysaid.news/`
- Login credentials: Username `jakob@karlsmark.com`, Password `Ferret@00`
- Take screenshots to confirm layout, buttons, and interactions render correctly

## Git
- One commit per task: `git add -A && git commit -m "phase-N: description"`
- Branch: `AdminEditCapabilitiesChanges` off `main`
- Never force push. Never amend published commits.

## Sensitive Areas
- `src/config/database.js` — migration pattern must use column-existence checks
- `public/js/app.js` — SPA router, auth state, Socket.IO — changes cascade everywhere
- `public/js/home.js` — Quote block rendering, trending tabs — core UI file
- `public/js/important.js` — Important button shared across all pages
- Admin auth cookie (`auth_token`) — JWT, HTTP-only, 7-day expiry

## Known Mistakes to Avoid
- `better-sqlite3` `db.backup()` is ASYNC — must await
- Pinecone index is SPARSE — never send dense vectors
- `showToast()` not `alert()` — alerts are banned
- DOM event delegation: use `onclick` attributes in template literals (existing pattern)
- Settings page sections use `id="settings-section-*"` with toggle visibility
- Frontend functions are global scope (no module system) — avoid name collisions
- `escapeHtml()` all user content rendered in template literals
- Cache-bust: bump `?v=N` on script/css tags in `public/index.html` after changes

## When Stuck
- Check existing patterns in adjacent files before inventing new ones
- Read test files for usage examples
- Add `BLOCKED` note to PROGRESS.md and move on
