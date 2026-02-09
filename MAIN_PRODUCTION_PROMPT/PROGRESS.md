# Build Progress — Two-Environment Pipeline

## Current Status
- **Current Phase:** 5
- **Last Updated:** 2026-02-09
- **Last Commit:** 3673b52 phase-4: add LIVE setup checklist documentation

## Phase 0: Prerequisites ✅
- [x] Railway CLI authenticated (`railway whoami`)
- [x] GitHub repo access (Bitstream73/QuoteLog02)
- [x] Current `main` branch builds and deploys successfully
- [x] All tests pass on main (`npm test`)
- [x] Railway project ID known: b802bd44-d0ce-4d37-a337-07d4ca6f4f77
- [x] Existing GitHub secrets: RAILWAY_TOKEN, RAILWAY_SERVICE_ID

## Phase 1: Pinecone Namespace Configuration ✅
- [x] Add `pineconeNamespace` to config loader (`src/config/index.js`) — reads `PINECONE_NAMESPACE` env var, defaults to `'quotes'`
- [x] Update `embedQuote()` in `src/services/vectorDb.js` — replace hardcoded `idx.namespace('quotes')` on line 38 with `idx.namespace(config.pineconeNamespace)`
- [x] Update `queryQuotes()` in `src/services/vectorDb.js` — replace hardcoded `idx.namespace('quotes')` on line 67 with `idx.namespace(config.pineconeNamespace)`
- [x] Add `PINECONE_NAMESPACE=quotes` to `.env.example`
- [x] Run `npm test` — all tests pass (no behavioral change, default is `'quotes'`)

## Phase 2: CI/CD Workflow Updates ✅
- [x] Update `.github/workflows/ci.yml` — add `live` to push branches and PR branches triggers
- [x] Create `.github/workflows/deploy-live.yml` — triggers on push to `live`, deploys using `secrets.RAILWAY_SERVICE_ID_LIVE` (see `docs/CI_CD.md` for exact content)
- [x] Add clarifying comment to `.github/workflows/deploy.yml` — note this is Development (main branch) only

## Phase 3: Create `live` Branch ✅
- [x] Create `live` branch from current `main`: `git branch live`
- [x] Push `live` branch to origin
- [x] Verify both branches exist on remote: `git branch -r`

## Phase 4: Documentation ✅
- [x] Create `MAIN_PRODUCTION_PROMPT/docs/ENVIRONMENTS.md` — environment architecture, Railway setup commands, env var reference (pre-existing spec)
- [x] Create `MAIN_PRODUCTION_PROMPT/docs/CI_CD.md` — GitHub Actions workflow docs and secrets reference (pre-existing spec)
- [x] Create `MAIN_PRODUCTION_PROMPT/docs/DATA_MIGRATION.md` — database copy procedure and Pinecone namespace notes (pre-existing spec)
- [x] Create `docs/LIVE_SETUP_CHECKLIST.md` in project root — step-by-step human instructions for Railway LIVE service creation

## Phase 5: Final Verification
- [ ] Verify `package-lock.json` is current (`npm install --package-lock-only` if needed)
- [ ] Run `npm test` — full suite passes
- [ ] Verify `live` branch exists on remote
- [ ] Verify all changes committed and pushed
