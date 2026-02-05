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
3. **Check Railway build logs after deploy** - Always verify the build succeeds by running `railway logs --build --lines 50 <deployment-id>`. Do not assume a deploy succeeded just because `railway up` returned a URL.
4. **If dependencies changed**, run `npm install --package-lock-only` to regenerate `package-lock.json`, then commit it.

## Testing

```bash
npm test                          # Run all tests
npm test -- --coverage            # With coverage report
npm test -- path/to/test.spec.ts  # Specific file
```

## Deployment

```bash
# Deploy to Railway
railway up --detach

# Check build logs (ALWAYS do this after deploy)
railway logs --build --lines 50 <deployment-id>

# Check runtime logs
railway logs --lines 50 <deployment-id>
```

## Known Issues (Windows)

- `git push` can hang waiting for credentials - use `timeout 30 git push` or MCP `push_files` as fallback
- `NUL` is a reserved Windows device name - it's in `.gitignore` to prevent deploy issues
- Windows curl has TLS issues (exit code 35) - use WebFetch tool instead

## Commit Messages

Use conventional commits: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `style:`, `chore:`

## AI Models

- Always use the latest model versions
- Gemini model: `gemini-2.5-flash` (text), `text-embedding-004` (embeddings)
- Never fall back to older model versions as a fix
