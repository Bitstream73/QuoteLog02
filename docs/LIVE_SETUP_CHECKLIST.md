# LIVE Environment Setup Checklist

Step-by-step instructions for creating the Railway LIVE service.

**Prerequisites:**
- Railway CLI installed and authenticated (`railway whoami`)
- Access to GitHub repo settings (Bitstream73/QuoteLog02)
- `live` branch exists on remote (`git branch -r | grep live`)

---

## 1. Create the LIVE Service on Railway

```bash
cd "E:\Github Repos\QuoteLog02"

# Link to Railway project (if not already linked)
railway link b802bd44-d0ce-4d37-a337-07d4ca6f4f77

# Create new service
railway service create QuoteLog02-Live
```

Note the service ID from the output — you'll need it for GitHub secrets.

## 2. Create and Attach Volume

Via Railway Dashboard:
1. Go to https://railway.app/project/b802bd44-d0ce-4d37-a337-07d4ca6f4f77
2. Click on QuoteLog02-Live service
3. Settings > Volumes > Add Volume
4. Name: `quotelog02-live-volume`
5. Mount path: `/app/data`

## 3. Set Environment Variables

```bash
# Switch to LIVE service context
railway service QuoteLog02-Live

# Set all variables (MSYS_NO_PATHCONV=1 prevents Windows path mangling)
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

**CRITICAL:** `PINECONE_NAMESPACE` must be `quotes-live` (not `quotes`) to prevent data cross-contamination with Development.

**CRITICAL:** `JWT_SECRET` must differ from Development so Dev auth tokens don't work on LIVE.

## 4. Generate Railway Domain

```bash
railway domain
```

Note the generated URL and update `APP_URL`:

```bash
MSYS_NO_PATHCONV=1 railway variables set APP_URL=https://<generated-domain>
```

## 5. Add GitHub Secret

1. Go to https://github.com/Bitstream73/QuoteLog02/settings/secrets/actions
2. Add new repository secret:
   - Name: `RAILWAY_SERVICE_ID_LIVE`
   - Value: the LIVE service ID from step 1

## 6. Deploy LIVE Branch

```bash
git checkout live
railway up --detach
```

Note the deployment ID from the output URL.

## 7. Verify Deployment

```bash
# Wait ~40s, then check build logs
railway logs --build --lines 50 <deployment-id>

# Wait ~15s more, then check runtime logs
railway logs --lines 20 <deployment-id>
```

Verify health endpoint responds:
```
https://<live-url>/api/health
# Expected: {"status":"healthy"}
```

## 8. Import Data from Development

See [DATA_MIGRATION.md](../MAIN_PRODUCTION_PROMPT/docs/DATA_MIGRATION.md) for full instructions.

Quick summary:
1. Export JSON from Development (Settings > Database > Export JSON)
2. Log in to LIVE admin
3. Import JSON to LIVE (Settings > Database > Import JSON)
4. Verify row counts match

---

## Post-Setup: Promoting Code to LIVE

After setup is complete, the promotion workflow is:

```bash
# From main branch
git checkout live
git merge main
git push origin live
```

This triggers CI tests and auto-deploys to the LIVE Railway service.

**Never push directly to `live`.** Always merge from `main`.
