# QuoteLog02 - Claude Code Guidelines

## Project Overview

QuoteLog02 is an AI-powered news quote extraction app. Node.js/Express backend, SQLite + Pinecone, Gemini AI, Socket.IO, PWA frontend.

## Tech Stack

- **Runtime**: Node.js 20 (ESM modules - `"type": "module"`)
- **Backend**: Express, better-sqlite3 (WAL mode), Socket.IO
- **AI**: Gemini 2.5 Flash (text extraction), text-embedding-004 (embeddings)
- **Vector DB**: Pinecone (sparse vectors, pinecone-sparse-english-v0)
- **Testing**: Vitest (57 tests across 10 test files)
- **Deploy**: Railway (Dockerfile multi-stage build with node:20-alpine)

## Pre-Deploy Checklist (CRITICAL)

Before every deploy, verify ALL of the following:

1. **`package-lock.json` exists and is committed** - The Dockerfile uses `npm ci` which REQUIRES `package-lock.json`. Without it, the build fails. After any `npm install` that changes dependencies, regenerate and commit the lockfile.
2. **Run `npm test`** - All tests must pass before deploying.
3. **If dependencies changed**, run `npm install --package-lock-only` to regenerate `package-lock.json`, then commit it.

## Post-Deploy Verification (CRITICAL)

After every `railway up`, you MUST verify BOTH of these:

1. **Check build logs** - `railway logs --build --lines 50 <deployment-id>` — confirm the Docker image built successfully. Look for "Build time:" at the end.
2. **Check runtime logs** - `railway logs --lines 20 <deployment-id>` — confirm the app actually started and is serving requests. Look for "Server running on port 3000" with NO errors after it. A successful build does NOT guarantee a successful deploy — runtime import errors, missing env vars, or crash loops will only show here.
3. **Hit the health endpoint** - Verify `https://quotelog02-production.up.railway.app/api/health` returns `{"status":"healthy"}`.

**Common runtime failure**: ESM import errors (e.g., `does not provide an export named 'default'`). These won't show in build logs — only in runtime logs.

## Testing

```bash
npm test                          # Run all tests
npm test -- --coverage            # With coverage report
npm test -- path/to/test.spec.ts  # Specific file
```

## Deployment

```bash
# 1. Deploy to Railway
railway up --detach
# Note the deployment ID from the output URL

# 2. Wait ~40s, then check build logs
railway logs --build --lines 50 <deployment-id>

# 3. Wait ~15s more, then check runtime logs
railway logs --lines 20 <deployment-id>

# 4. Verify health endpoint
# Use WebFetch tool on: https://quotelog02-production.up.railway.app/api/health
```

## Known Issues (Windows)

- `git push` can hang waiting for credentials - use `timeout 30 git push` or MCP `push_files` as fallback
- `NUL` is a reserved Windows device name - it's in `.gitignore` to prevent deploy issues
- Windows curl has TLS issues (exit code 35) - use WebFetch tool instead

## MCP push_files Pitfalls (CRITICAL)

- **push_files replaces the ENTIRE file** — you must include the complete file content, not just the changed lines. Pushing a partial file will truncate/destroy the rest of it.
- When pushing in batches, verify ALL modified files were included across all batches. Easy to miss files.
- After MCP push, always `git fetch origin && git reset --hard origin/main` to sync local.

## Commit Messages

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `style:`, `chore:`

## AI Models

- Always use the latest model versions
- Gemini model: `gemini-2.5-flash` (text), `text-embedding-004` (embeddings)
- Never fall back to older model versions as a fix
