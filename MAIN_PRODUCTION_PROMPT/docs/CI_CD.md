# CI/CD Pipeline

## Workflows

### ci.yml — Test Runner (Both Branches)

**Triggers:** push to `main`, `live`, `develop`; PRs to `main`, `live`

```yaml
on:
  push:
    branches: [main, live, develop]
  pull_request:
    branches: [main, live]
```

No other changes needed — the test job and build job remain identical.

### deploy.yml — Development Deploy (Existing, Minor Update)

**Triggers:** push to `main` only

```yaml
# Deploys Development environment (main branch)
# For LIVE deployment, see deploy-live.yml
on:
  push:
    branches: [main]
```

Uses `secrets.RAILWAY_SERVICE_ID` (existing secret).

### deploy-live.yml — LIVE Deploy (New File)

**Triggers:** push to `live` only

```yaml
name: Deploy LIVE to Railway

on:
  push:
    branches: [live]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Railway CLI
        run: npm install -g @railway/cli
      - name: Deploy to Railway LIVE
        run: railway up --service ${{ secrets.RAILWAY_SERVICE_ID_LIVE }}
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}
```

## GitHub Secrets Required

| Secret | Purpose | Used By |
|--------|---------|---------|
| `RAILWAY_TOKEN` | Railway API authentication | Both deploy workflows |
| `RAILWAY_SERVICE_ID` | Development service ID | `deploy.yml` |
| `RAILWAY_SERVICE_ID_LIVE` | LIVE service ID | `deploy-live.yml` |

## Branch Protection (Recommended)

Consider adding branch protection rules for `live`:
- Require PR reviews before merging
- Require status checks to pass (CI)
- Restrict who can push directly

This prevents accidental pushes to `live` that bypass Development testing.
