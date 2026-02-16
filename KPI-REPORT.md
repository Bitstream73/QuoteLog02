# QuoteLog02 — Codebase KPI Report

**Date:** 2026-02-15
**Scope:** Full codebase audit — metrics, security, testing, architecture

---

## 1. Codebase KPIs

| Metric | Value |
|--------|-------|
| **Total Lines of Code** | ~34,190 |
| Backend (src/) | 10,578 lines across 58 files |
| Frontend (public/js/) | 6,425 lines across 16 modules |
| Styles (public/css/) | 6,252 lines across 2 files |
| Tests (tests/) | 10,935 lines across 53 files |
| **Test-to-Code Ratio** | **0.64:1** (10,935 test / 17,003 app) |
| **Route Files** | 18 |
| **API Endpoints** | 90+ |
| **Service Files** | 21 |
| **Database Tables** | 28 |
| **Database Indexes** | 25+ |
| **Production Dependencies** | 27 |
| **Dev Dependencies** | 5 |
| **Test Cases (estimated)** | 300+ across 122+ test groups |
| **Route Coverage** | 56% (10 of 18 routes have integration tests) |
| **Service Coverage** | 43% (10 of 23 services have tests) |
| **Middleware Coverage** | 100% (5 of 5) |
| **Schema/Migration Coverage** | Excellent |
| **Frontend Test Coverage** | Static checks only; no DOM/E2E |

---

## 2. Security Vulnerabilities

### CRITICAL

#### 2.1 SQL Table Name Interpolation
- **Files:** `src/routes/importants.js:35,52,59,64,114`, `src/routes/tracking.js:49-52,60,79-80`
- **Issue:** Table names injected via template literals (`SELECT id FROM ${tableName}`). Whitelisted via `VALID_TYPES.includes()`, but if that gate is ever bypassed or extended without care, it opens direct SQL injection.
- **Recommendation:** Add strict assertion guards and consider separate query objects per entity type.

### HIGH

#### 2.2 No Brute Force Protection on Login
- **File:** `src/routes/auth.js:12-24`
- **Issue:** `/api/auth/login` has no rate limiter. Attackers can attempt unlimited credential combinations.
- **Recommendation:** Apply a strict rate limiter (e.g., 5 attempts per 15 minutes per IP).

#### 2.3 JWT Secret Falls Back to Random Bytes
- **File:** `src/config/index.js:30`
- **Issue:** `jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex')` — if env var is unset, every restart invalidates all sessions, and multi-instance deploys have mismatched secrets.
- **Recommendation:** Fail startup if `JWT_SECRET` is not set in production.

#### 2.4 CORS Accepts All Origins
- **File:** `src/index.js:55,201`
- **Issue:** `app.use(cors())` and Socket.IO `cors: { origin: '*' }` allow any website to make authenticated requests.
- **Recommendation:** Whitelist specific trusted origins.

#### 2.5 Hardcoded Admin Credentials in Source
- **File:** `src/config/database.js:660-663`
- **Issue:** Default admin email (`jakob@karlsmark.com`) and password (`Ferret@00`) hardcoded in migration seed. Even though hashed, the plaintext is visible in source.
- **Recommendation:** Source from environment variables (`INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD`).

### MEDIUM

#### 2.6 Content Security Policy Disabled
- **File:** `src/index.js:51-54`
- **Issue:** Helmet runs with `contentSecurityPolicy: false` and `crossOriginEmbedderPolicy: false`.
- **Recommendation:** Enable CSP with `defaultSrc: ["'self'"]` and appropriate directives.

#### 2.7 No CSRF Protection
- **Issue:** No CSRF tokens on any state-changing endpoint. Combined with open CORS, any site can POST to the API using a victim's cookies.
- **Recommendation:** Implement CSRF token middleware or switch to `sameSite: 'strict'` cookies + origin checking.

#### 2.8 Weak Password Policy
- **File:** `src/routes/auth.js:104-105`
- **Issue:** Only enforces `password.length >= 8`. No uppercase, number, or special character requirements.

#### 2.9 No Session Invalidation on Password Change
- **File:** `src/routes/auth.js`
- **Issue:** When password is reset, existing JWT tokens remain valid for up to 7 days. A compromised session survives password changes.
- **Recommendation:** Track a `password_changed_at` timestamp and validate it against token `iat`.

#### 2.10 Authenticated Users Bypass Rate Limiting
- **File:** `src/middleware/rateLimiter.js`
- **Issue:** `skip: (req) => { jwt.verify(...); return true; }` — any valid JWT bypasses all rate limits.
- **Recommendation:** Never skip rate limiting for destructive or sensitive operations.

#### 2.11 Socket.IO Has No Authentication
- **File:** `src/index.js:200-209`
- **Issue:** Any client can connect to Socket.IO and receive real-time events without authentication.

---

## 3. Test Coverage Gaps

### Untested Routes (0% coverage)

| Route File | Endpoints | Risk |
|------------|-----------|------|
| `articles.js` | `GET /:id` | Core page — users view articles with quotes |
| `authors.js` | `GET /`, `GET /:id`, `PATCH /:id`, `GET /:id/quotes` | Core page — public-facing author profiles |
| `votes.js` | `POST /quotes/:id/vote`, `GET /quotes/:id/votes` | Legacy but possibly still mounted |

### Untested Services (critical business logic)

| Service File | Functions | Risk |
|--------------|-----------|------|
| `quoteDeduplicator.js` | `insertAndDeduplicateQuote`, `storeTopicsAndKeywords` | **CRITICAL** — core data quality gate |
| `nameDisambiguator.js` | `resolvePersonId` | **CRITICAL** — person entity resolution |
| `articleFetcher.js` | `fetchArticlesFromSource`, `processArticle` | **HIGH** — entire ingestion pipeline |
| `trendingCalculator.js` | `calculateTrendingScores` | **HIGH** — analytics depends on this |
| `rssFeedDiscovery.js` | `discoverRssFeed` | **MEDIUM** — new source onboarding |
| `topicSuggester.js` | `suggestTopics` | **MEDIUM** — AI feature |
| `topicMaterializer.js` | `materializeTrendingTopics` | **MEDIUM** — topic aggregation |
| `historicalFetcher.js` | `fetchHistoricalQuotes` | **MEDIUM** — historical pipeline |
| `personPhoto.js` | `fetchAndStoreHeadshot` | **LOW** — cosmetic feature |

### Untested Critical Paths

1. **End-to-end quote pipeline** — No test covers: RSS fetch → article parse → Gemini extraction → deduplication → person disambiguation → database insert.
2. **Concurrent database operations** — `fileParallelism: false` avoids this in tests, but production runs concurrent requests against shared SQLite.
3. **Socket.IO event delivery** — Events are emitted but never verified to reach connected clients.
4. **Settings CRUD** — Admin settings panel (GET/PUT/PATCH) has no integration tests.
5. **Source management** — POST (create), PATCH (update), DELETE (remove) are untested.
6. **Admin backfill operations** — headshots, keywords, pinecone backfill are untested.

### Missed Test Opportunities (would prevent real failures)

| Test | What It Would Catch |
|------|-------------------|
| Deduplication with unicode quotes (smart quotes, em-dashes) | Quote variants treated as unique instead of merged |
| Name disambiguation with titles ("Dr. Smith" vs "Smith") | Duplicate person records for the same individual |
| Article fetch with malformed HTML/encoding | Crashes in the ingestion pipeline |
| Gemini API returning unexpected format | Unhandled exceptions in quote extraction |
| Concurrent important toggles (same entity) | Race condition in count increment |
| Backup of large database (>100MB) | Timeout or memory issues in async backup |
| Trending score calculation with zero-data edge case | Division by zero or NaN scores |
| Settings update with invalid JSON values | Corrupted settings table |
| Source deletion while scheduler is running | Orphaned articles or failed fetches |
| Login with SQL-like characters in email field | Edge case in auth query |
| Rate limiter with clock skew | Incorrect window calculations |
| Password reset with expired token | Token validation edge case |

---

## 4. Performance Issues

### N+1 Query Patterns

| Location | Issue | Impact |
|----------|-------|--------|
| `src/routes/search.js:139-158` | Noteworthy items: 3 correlated subqueries per row | 30 extra queries for 10 items |
| `src/routes/analytics.js:66-73` | Trending topics: same MAX subquery executed 3× per topic in CASE | 300+ queries for 100 topics |
| `src/routes/admin.js:243-249` | Topics list: 2 COUNT subqueries per topic row | 200 queries for 100 topics |
| `src/routes/authors.js:166` | Vote score subquery per quote in author detail | 50+ queries per page |
| `src/routes/admin.js:292-300` | Loop-based keyword insert: 3 queries per keyword | 30 queries for 10 keywords |

### Missing Indexes

| Table | Suggested Index | Why |
|-------|----------------|-----|
| `importants` | `(entity_type, entity_id, voter_hash)` | Covers the toggle lookup query |
| `votes` | `(quote_id, voter_hash)` | Covers vote existence check |
| `quotes` | `(is_visible, person_id, created_at DESC)` | Covers author quote listing |

### Memory Concerns

| Location | Issue |
|----------|-------|
| `src/routes/tracking.js:18-32` | In-memory dedup Map grows unbounded below 10k entries; no periodic cleanup |
| `public/js/home.js:3-20` | Module-level caches (`_quoteTexts`, `_quoteMeta`, `_importantStatuses`) never cleared on navigation |

---

## 5. Code Quality / Missed Opportunities

### DRY Violations

| Pattern | Duplicated In | Fix |
|---------|--------------|-----|
| `isAdminRequest()` JWT verification | `quotes.js:13-22`, `articles.js:9-18`, `authors.js:9-18`, `search.js:8-17` | Extract to shared middleware |
| `getVoterHash()` IP+UA hashing | `votes.js:8-12`, `importants.js:12-16`, `tracking.js:11-15` | Extract to `src/utils/voterHash.js` |

### Inconsistencies

| Area | Issue |
|------|-------|
| Pagination limits | Varies between `20/50`, `50/200`, and uncapped across routes |
| Response envelopes | Some return `{ success, data }`, others return raw arrays/objects |
| Error responses | Mix of `err.message` leakage and generic `'Internal server error'` |
| Admin detection | Some routes use `isAdminRequest()`, others use `requireAdmin` middleware |

### Dead / Legacy Code

| Item | Status |
|------|--------|
| `src/routes/votes.js` | Legacy voting system — superseded by `importants.js` but still in codebase |
| `vote_score` subqueries | Reference `votes` table that may no longer be the canonical system |

### Missing Architectural Patterns

| Gap | Description |
|-----|-------------|
| No migration versioning | Migrations use `PRAGMA table_info` checks on every startup instead of a version table |
| No request validation library | Input validation is ad-hoc `if (!x)` checks instead of schema validation (e.g., Zod, Joi) |
| No centralized error codes | Error messages are freeform strings instead of typed codes |
| No API versioning | All endpoints are unversioned (`/api/quotes` not `/api/v1/quotes`) |
| No structured logging format | Logs use custom format instead of JSON structured logging |

---

## 6. Summary Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| **Architecture** | 7/10 | Clean separation, but duplicated patterns and no validation layer |
| **Security** | 4/10 | Open CORS, no CSRF, no login rate-limit, CSP disabled, hardcoded creds |
| **Test Coverage** | 6/10 | Good foundation (300+ tests), but critical pipelines untested |
| **Performance** | 6/10 | Functional, but N+1 queries and missing indexes will hurt at scale |
| **Code Quality** | 7/10 | Readable and consistent style, but DRY violations and dead code |
| **Observability** | 5/10 | Logger exists but gaps in error context, no structured format, silent catches |
| **Overall** | **5.8/10** | Solid MVP; needs hardening before production traffic scales |

---

## 7. Recommended Priority Actions

### Immediate (before next deploy)
1. Add login-specific rate limiter (5 attempts/15 min)
2. Require `JWT_SECRET` env var — fail on startup if missing
3. Restrict CORS to known origins
4. Move hardcoded admin credentials to env vars

### Short-term (next sprint)
5. Enable Content Security Policy in Helmet
6. Write tests for `quoteDeduplicator.js` and `nameDisambiguator.js`
7. Write integration tests for `articles.js` and `authors.js` routes
8. Extract `isAdminRequest()` and `getVoterHash()` to shared utilities
9. Add composite indexes for frequent query patterns

### Medium-term (next month)
10. Implement CSRF protection
11. Add session invalidation on password change
12. Refactor N+1 queries in analytics and search routes
13. Add input validation library (Zod) for route handlers
14. Write end-to-end test for the quote ingestion pipeline
15. Implement migration version tracking table
16. Remove or formally deprecate `votes.js`
