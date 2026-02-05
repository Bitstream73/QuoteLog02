# Agent Build & Test Commands

## Test Command
```bash
npm test
```

## Install Dependencies
```bash
npm install
```

## Regenerate Lockfile
```bash
npm install --package-lock-only
```

## Start Dev Server (manual verification)
```bash
npm run dev
```

## Lint/Format
No linter configured. Just ensure code works and tests pass.

## Project Type
Node.js ESM (`"type": "module"` in package.json). Always use `import`/`export`, never `require()`.

## Key Constraints
- All 59+ existing tests must continue to pass after changes
- Use `bcryptjs` (pure JS), NOT `bcrypt` (native C++ — breaks in Alpine Docker)
- Use `cookie-parser` for cookie parsing
- Never use `require()` — ESM only
- Commit with conventional commit message format
