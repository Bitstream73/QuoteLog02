# QuoteLog02 — Split Into Public + Admin Versions

## Project Goal

Split the existing QuoteLog02 single-page application into **two access tiers** within the same deployment:

1. **Public-facing version** — Read-only quote browsing. No settings, no review queue, no logs. This is what unauthenticated visitors see.
2. **Admin version** — Full current functionality behind a login wall. Only the admin user (`jakob@karlsmark.com`) can access settings, review ambiguous items, and view logs.

## Core Principles

- **Single deployment** — Do NOT create two separate apps. One Express server, one SQLite database, one Railway deployment.
- **ESM modules** — The project uses `"type": "module"`. All new files MUST use ESM `import`/`export`. Never use `require()`.
- **Minimal dependencies** — Use `jsonwebtoken` for JWT, `bcryptjs` (pure JS, no native build) for password hashing, and `resend` for password reset emails.
- **No over-engineering** — Simple JWT auth in httpOnly cookies. No sessions table, no refresh tokens, no OAuth. One admin user seeded on startup.
- **Preserve existing tests** — All 59 existing Vitest tests must continue to pass. New auth features need their own tests.
- **Follow CLAUDE.md** — Obey all instructions in the project's `CLAUDE.md`, especially the pre-deploy checklist (package-lock.json), ESM requirements, and Pinecone conventions.

## What "Public" Means

The public version is the current app minus:
- The **Settings** page (nav link + route + all settings/sources CRUD)
- The **Review** page (nav link + badge + route + all review actions)
- The **Logs** viewer (embedded in settings, plus all log API endpoints)
- Any write operations on sources (POST/PATCH/DELETE `/api/sources`)

Public users CAN:
- Browse quotes (home feed, pagination, real-time new quote updates)
- View individual quote details
- View author profiles and their quotes
- See the list of news sources (read-only GET `/api/sources`)

## What "Admin" Means

The admin version is the current full app, accessible after logging in:
- Login credentials: email `jakob@karlsmark.com`, password `Ferret@00`
- Password stored bcrypt-hashed in SQLite `admin_users` table
- JWT issued on login, stored in httpOnly secure cookie
- Password reset via Resend email API to `jakob@karlsmark.com`

## Authentication Flow

1. User navigates to `/login` → sees login form
2. POST `/api/auth/login` with `{ email, password }` → server validates, returns JWT in httpOnly cookie
3. All subsequent requests include cookie automatically
4. Admin API routes check for valid JWT via `requireAdmin` middleware → 401 if missing/invalid
5. Frontend checks `GET /api/auth/me` on load → sets `isAdmin` flag → conditionally shows nav items
6. Logout clears the cookie

## Password Reset Flow

1. User clicks "Forgot password?" on login page
2. Enters email → POST `/api/auth/forgot-password` → server generates time-limited token, sends email via Resend
3. Email contains link to `/reset-password?token=xxx`
4. User enters new password → POST `/api/auth/reset-password` with `{ token, password }`
5. Server validates token, updates bcrypt hash, invalidates token

## Environment Variables (New)

- `JWT_SECRET` — Secret for signing JWTs (required in production, auto-generated in dev)
- `RESEND_API_KEY` — API key for Resend email service
- `APP_URL` — Base URL for password reset links (e.g., `https://quotelog02-production.up.railway.app`)

## Success Criteria

1. Unauthenticated users see quotes, authors, and source list — no settings, review, or logs
2. Admin can log in and access full functionality
3. Admin API routes return 401 without valid JWT
4. Password reset email is sent and works end-to-end
5. All existing tests pass
6. New auth tests cover login, logout, protected routes, and password reset
7. `npm test` passes with zero failures
8. App deploys successfully to Railway
