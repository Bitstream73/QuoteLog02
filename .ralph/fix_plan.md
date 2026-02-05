# Fix Plan — Public/Admin Split

## Phase 1: Dependencies & Configuration

- [ ] Install new dependencies: `npm install jsonwebtoken bcryptjs resend`
- [ ] Regenerate `package-lock.json` and verify it exists
- [ ] Add new config keys to `src/config/index.js`: `jwtSecret`, `resendApiKey`, `appUrl`, `adminEmail`

## Phase 2: Database Schema — Admin Users & Password Reset Tokens

- [ ] Add `admin_users` table to `src/config/database.js` `initializeTables()`: columns `id`, `email` (UNIQUE), `password_hash`, `created_at`, `updated_at`
- [ ] Add `password_reset_tokens` table: columns `id`, `email`, `token` (UNIQUE), `expires_at`, `used` (INTEGER DEFAULT 0), `created_at`
- [ ] Add seed logic in `initializeTables()`: insert default admin user `jakob@karlsmark.com` with bcrypt hash of `Ferret@00` (use `bcryptjs.hashSync` with cost 12) — use `INSERT OR IGNORE` so it only seeds once
- [ ] Verify: run `npm test` — all 59 existing tests still pass after schema changes

## Phase 3: Auth Middleware

- [ ] Create `src/middleware/auth.js` exporting `requireAdmin` middleware function
- [ ] `requireAdmin` reads JWT from cookie named `auth_token` (use `req.cookies` — need `cookie-parser` middleware OR manually parse `req.headers.cookie`)
- [ ] Actually: use `cookie-parser` package — `npm install cookie-parser` and add to `src/index.js` middleware stack after body parsing
- [ ] `requireAdmin` verifies JWT with `jsonwebtoken.verify(token, config.jwtSecret)` — if valid, attach `req.admin = decoded` and call `next()`; if invalid/missing, return `res.status(401).json({ error: 'Authentication required' })`
- [ ] Verify: run `npm test` — all tests still pass

## Phase 4: Auth Routes

- [ ] Create `src/routes/auth.js` with Router
- [ ] `POST /api/auth/login`: validate `{ email, password }` body, look up user in `admin_users` by email, `bcryptjs.compareSync(password, row.password_hash)`, if match generate JWT with `{ id: row.id, email: row.email }` expiring in 7 days, set as httpOnly cookie `auth_token` with `SameSite=Lax`, `Secure` in production, `Path=/`, respond `{ success: true, email: row.email }`
- [ ] `POST /api/auth/logout`: clear the `auth_token` cookie, respond `{ success: true }`
- [ ] `GET /api/auth/me`: if valid JWT cookie exists return `{ authenticated: true, email }`, else return `{ authenticated: false }`
- [ ] `POST /api/auth/forgot-password`: validate email matches an admin user, generate crypto random token (32 bytes hex), store in `password_reset_tokens` with 1-hour expiry, send email via Resend with reset link `${config.appUrl}/reset-password?token=${token}`, respond `{ success: true }` (always, even if email not found — prevent enumeration)
- [ ] `POST /api/auth/reset-password`: validate `{ token, password }`, look up token in DB where `used = 0` and `expires_at > datetime('now')`, if valid: hash new password with bcryptjs, update `admin_users.password_hash`, mark token `used = 1`, respond `{ success: true }`
- [ ] Create `src/services/email.js`: export `sendPasswordResetEmail(to, resetUrl)` function using Resend SDK — from address `noreply@quotelog.app` (or Resend's default domain), subject "Password Reset - Quote Log", HTML body with reset link
- [ ] Mount auth routes in `src/index.js`: `import authRouter from './routes/auth.js'` and `app.use('/api/auth', authRouter)`
- [ ] Add `cookie-parser` to middleware stack in `src/index.js`: `import cookieParser from 'cookie-parser'` then `app.use(cookieParser())` after body parsing
- [ ] Verify: run `npm test` — all tests still pass

## Phase 5: Protect Admin API Routes

- [ ] In `src/routes/settings.js`: import `requireAdmin` and add as middleware to ALL routes: `router.get('/', requireAdmin, ...)`, `router.put('/', requireAdmin, ...)`, `router.patch('/', requireAdmin, ...)`
- [ ] In `src/routes/review.js`: import `requireAdmin` and add as middleware to ALL routes (stats, list, merge, reject, skip, batch)
- [ ] In `src/routes/logs.js`: import `requireAdmin` and add as middleware to ALL routes (list, stats, export, delete)
- [ ] In `src/routes/sources.js`: import `requireAdmin` and add ONLY to write routes: `router.post('/', requireAdmin, ...)`, `router.patch('/:id', requireAdmin, ...)`, `router.delete('/:id', requireAdmin, ...)` — leave `router.get('/')` public
- [ ] Verify: run `npm test` — fix any tests that now get 401 errors by adding auth setup to those test files (create JWT and set cookie in test requests)

## Phase 6: Frontend — Login & Password Reset Pages

- [ ] Create `public/js/login.js` with `renderLogin()` function that generates login form HTML into `#content`: email input, password input, submit button, "Forgot password?" link, error message area. On submit: POST `/api/auth/login`, on success: `navigate(null, '/')`, on error: show error message
- [ ] Create `public/js/resetPassword.js` with two states: (a) `renderForgotPassword()` — email input + submit → POST `/api/auth/forgot-password` → show "Check your email" message; (b) `renderResetPassword(token)` — new password + confirm password inputs → POST `/api/auth/reset-password` → show success + link to login
- [ ] Add login/reset page styles to `public/css/styles.css`: centered card layout, consistent with newspaper theme, form inputs styled like existing settings form
- [ ] Add both script tags to `public/index.html`: `<script src="/js/login.js"></script>` and `<script src="/js/resetPassword.js"></script>` before `app.js`

## Phase 7: Frontend — Conditional Navigation & Routing

- [ ] In `public/js/app.js`: add `let isAdmin = false;` state variable at top
- [ ] Add `async function checkAuth()` that calls `GET /api/auth/me` and sets `isAdmin = result.authenticated`
- [ ] Update `route()` function: add cases for `/login`, `/forgot-password`, `/reset-password` paths; for `/settings` and `/review` paths, redirect to `/login` if `!isAdmin`
- [ ] Add `function updateNav()` that shows/hides nav links based on `isAdmin`: hide Review + Settings links when not admin, show Login link when not admin, show Logout link when admin
- [ ] Update nav HTML in `public/index.html`: add `id` attributes to Review and Settings nav links so JS can target them; add Login/Logout links (initially hidden) with appropriate ids
- [ ] Call `checkAuth()` then `updateNav()` on DOMContentLoaded before calling `route()`
- [ ] Add `async function logout()`: POST `/api/auth/logout`, set `isAdmin = false`, call `updateNav()`, navigate to `/`
- [ ] Update `updateReviewBadgeAsync()`: skip the API call if `!isAdmin` (it will return 401 anyway)
- [ ] In `public/js/api.js`: add global 401 handler — if any API response is 401, set `isAdmin = false`, call `updateNav()`, and `navigate(null, '/login')`

## Phase 8: Testing

- [ ] Create `tests/auth.spec.js` with tests for:
  - POST `/api/auth/login` with correct credentials returns 200 + sets cookie
  - POST `/api/auth/login` with wrong password returns 401
  - POST `/api/auth/login` with unknown email returns 401
  - GET `/api/auth/me` with valid cookie returns `{ authenticated: true }`
  - GET `/api/auth/me` without cookie returns `{ authenticated: false }`
  - POST `/api/auth/logout` clears cookie
  - POST `/api/auth/forgot-password` returns 200 (mock Resend)
  - POST `/api/auth/reset-password` with valid token changes password
  - POST `/api/auth/reset-password` with expired/used token returns 400
- [ ] Create `tests/admin-routes.spec.js` with tests for:
  - GET `/api/settings` without auth returns 401
  - GET `/api/settings` with valid auth cookie returns 200
  - GET `/api/review` without auth returns 401
  - GET `/api/logs` without auth returns 401
  - POST `/api/sources` without auth returns 401
  - GET `/api/sources` without auth returns 200 (still public)
  - GET `/api/quotes` without auth returns 200 (still public)
  - GET `/api/authors` without auth returns 200 (still public)
- [ ] Fix any existing tests that now fail due to auth requirements — add helper function to generate valid auth cookie for test requests
- [ ] Run full test suite: `npm test` — ALL tests must pass, zero failures

## Phase 9: Final Verification & Cleanup

- [ ] Verify `package-lock.json` is up to date: `npm install --package-lock-only` if needed
- [ ] Run `npm test` one final time — confirm zero failures
- [ ] Manually trace the complete flow: unauthenticated user sees only quotes/authors; login works; admin sees full nav; logout hides admin features
- [ ] Check that no secrets are hardcoded (password only in seed, not in route logic)
- [ ] Commit all changes with message: `feat: split site into public and admin versions with JWT auth and Resend password reset`
