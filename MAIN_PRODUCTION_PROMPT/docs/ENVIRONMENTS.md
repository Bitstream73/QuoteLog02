# Environment Architecture

## Overview

| Aspect | Development | LIVE |
|--------|------------|------|
| Git Branch | `main` | `live` |
| Railway Service | QuoteLog02 (existing) | QuoteLog02-Live (new) |
| URL | quotelog02-production.up.railway.app | [assigned by Railway on creation] |
| SQLite Database | Own volume (`quotelog02-volume`) | Own volume (`quotelog02-live-volume`) |
| Pinecone Namespace | `quotes` (default) | `quotes-live` |
| Deploy Workflow | `.github/workflows/deploy.yml` | `.github/workflows/deploy-live.yml` |
| GitHub Secret | `RAILWAY_SERVICE_ID` | `RAILWAY_SERVICE_ID_LIVE` |

## Promotion Workflow

```
main (Development) -----> deploy.yml -----> QuoteLog02 service
  |
  | git checkout live && git merge main && git push origin live
  v
live (LIVE) ------------> deploy-live.yml -> QuoteLog02-Live service
```

1. Develop features on `main` (or feature branches merged to `main`)
2. Push to `main` — CI runs tests, `deploy.yml` deploys to Development
3. Test on Development URL
4. When ready to promote: `git checkout live && git merge main && git push origin live`
5. CI runs tests on `live`, `deploy-live.yml` deploys to LIVE with LIVE's own env vars and database

**IMPORTANT:** Never push directly to `live`. Always merge from `main`.

## Environment Variables

Both environments use the same variable names. Values differ per service.

| Variable | Development Value | LIVE Value | Notes |
|----------|------------------|------------|-------|
| `NODE_ENV` | `production` | `production` | Both are production Railway deploys |
| `PORT` | `3000` | `3000` | Railway assigns port dynamically |
| `DATABASE_PATH` | `/app/data/database.sqlite` | `/app/data/database.sqlite` | Same path, different volumes |
| `GEMINI_API_KEY` | `<key>` | `<same key>` | Shared API key is fine |
| `PINECONE_API_KEY` | `<key>` | `<same key>` | Shared — same Pinecone project |
| `PINECONE_INDEX_HOST` | `<host>` | `<same host>` | Same index, different namespace |
| `PINECONE_NAMESPACE` | `quotes` | `quotes-live` | **CRITICAL: prevents cross-contamination** |
| `JWT_SECRET` | `<secret-1>` | `<secret-2>` | **MUST differ** — Dev tokens must not work on LIVE |
| `RESEND_API_KEY` | `<key>` | `<same key>` | Shared email service |
| `APP_URL` | `https://quotelog02-production.up.railway.app` | `https://<live-url>` | Used for password reset links |
| `ADMIN_EMAIL` | `jakob@karlsmark.com` | `jakob@karlsmark.com` | Same admin |

## Railway LIVE Service Setup (Human Steps)

These commands must be run by a human after Ralph completes the code changes.

### Step 1: Create the LIVE Service

```bash
# Navigate to project
cd "E:\Github Repos\QuoteLog02"

# Link to Railway project (if not already linked)
railway link b802bd44-d0ce-4d37-a337-07d4ca6f4f77

# Create new service
railway service create QuoteLog02-Live
```

### Step 2: Create and Attach Volume

Via Railway Dashboard (recommended):
1. Go to https://railway.app/project/b802bd44-d0ce-4d37-a337-07d4ca6f4f77
2. Click on QuoteLog02-Live service
3. Settings > Volumes > Add Volume
4. Name: `quotelog02-live-volume`
5. Mount path: `/app/data`

### Step 3: Set Environment Variables

```bash
# Switch to LIVE service context
railway service QuoteLog02-Live

# Set all variables (use MSYS_NO_PATHCONV=1 on Windows to prevent path mangling)
MSYS_NO_PATHCONV=1 railway variables set \
  NODE_ENV=production \
  PORT=3000 \
  DATABASE_PATH=/app/data/database.sqlite \
  GEMINI_API_KEY=<your-gemini-key> \
  PINECONE_API_KEY=<your-pinecone-key> \
  PINECONE_INDEX_HOST=<your-pinecone-host> \
  PINECONE_NAMESPACE=quotes-live \
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  RESEND_API_KEY=<your-resend-key> \
  APP_URL=https://<live-railway-domain> \
  ADMIN_EMAIL=jakob@karlsmark.com
```

### Step 4: Generate Railway Domain

```bash
railway domain
```

Note the generated URL — update `APP_URL` with it.

### Step 5: Add GitHub Secret

1. Go to https://github.com/Bitstream73/QuoteLog02/settings/secrets/actions
2. Add new secret: `RAILWAY_SERVICE_ID_LIVE` = the LIVE service ID from Railway

### Step 6: Deploy LIVE Branch

```bash
# Switch to live branch
git checkout live

# Deploy to LIVE service
railway up --detach
```

### Step 7: Verify

```bash
# Check build logs (note deployment ID from railway up output)
railway logs --build --lines 50 <deployment-id>

# Check runtime logs
railway logs --lines 20 <deployment-id>

# Hit health endpoint
# Use WebFetch on: https://<live-url>/api/health
```

### Step 8: Import Database (see DATA_MIGRATION.md)
