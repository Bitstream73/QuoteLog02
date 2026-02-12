# Prompt Compiler for Ralph Loop (Claude Code Plugin)

You are a **prompt architect**. Your job is to take the user's raw, unstructured instructions and compile them into a production-ready autonomous development loop using the Ralph Wiggum plugin for Claude Code.

**Ralph is not slash commands.** Ralph re-feeds the SAME prompt every iteration. Claude must read files to know where it left off. Progress persists in the filesystem and git history — not in conversation context. Your output must be designed for this loop mechanic.

---

## THE USER'S INSTRUCTIONS

Everything inside the `<!-- TODO -->` block below is the user's raw input. It may be messy, incomplete, contradictory, or overly ambitious. Your job is to restructure it — not to execute it.

<!-- TODO START -->

Create an upvote system, similar to reddit that allows people to upvote and downvote articles. It should appear along with quotes everywhere quotes are displayed.
Create an analytics modal and add it to the header menu for users and admins that shows metadata about quotes: things like quotes/day, author with most quotes for the day, most upvoted quote per day/week/year, most popular topic/keyword(s) for the day/week/month/year and any other metrics that would be valuable to know and share. the goal is to expose insights about quotes, quote authors and popular topics.

<!-- TODO END -->

---

## YOUR OUTPUT

You will produce a set of files. Create ALL of them as real files. These files are designed to be used with:

```bash
/ralph-loop "Read PROMPT.md and execute the current task" --max-iterations 50 --completion-promise "ALL_PHASES_COMPLETE"
```

---

### File 1: `CLAUDE.md` (Project Brain — Always Loaded by Claude Code)

Claude Code reads this automatically at session start. Keep it **under 100 lines** (~2.5k tokens). Same rules as the standard prompt compiler:

```
# [Project Name]

[One-line description]

## Stack
## Code Style
## Architecture
## Testing — MANDATORY
## Verification — Run Before Declaring Done
## Git
## Sensitive Areas — Extra Caution
## When Stuck
## Known Mistakes to Avoid
```

**CLAUDE.md is NOT the Ralph prompt.** It's project-level context that applies regardless of how Claude is invoked. Don't put Ralph-specific instructions here.

---

### File 2: `PROMPT.md` (The Ralph Loop Prompt — Re-Fed Every Iteration)

This is the most critical file. Ralph feeds it to Claude at the START of every iteration. Claude has no memory of previous iterations — only what's in files and git history. Design accordingly.

**Structure:**

```markdown
# [Project Name] — Autonomous Build

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `CLAUDE.md` — project standards (code style, testing, architecture)
- `PROGRESS.md` — current phase and task status (YOU update this file)
- `docs/*.md` — detailed specs for cross-cutting concerns

Check git log for what was done in previous iterations:
- `git log --oneline -20`

## 1. Determine Current Task

Read `PROGRESS.md` to find the current phase and the next unchecked task.
- If the current task is already complete (checkbox checked), move to the next.
- If all tasks in a phase are complete, advance to the next phase.
- If ALL phases are complete, output: <promise>ALL_PHASES_COMPLETE</promise>

## 2. Execute the Current Task

Follow the spec in the relevant `docs/*.md` file for the current phase.

For EVERY task:
1. Write or update tests FIRST
2. Implement the code
3. Run verification: [INSERT VERIFICATION COMMAND, e.g., `npx vitest run`]
4. If tests fail, fix the code (not the tests)
5. When green, commit: `git add -A && git commit -m "phase-N: task description"`

## 3. Update Progress

After committing, update `PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- If the phase is done, mark it complete
- Save the file

## 4. Assess Completion

- If there are more tasks remaining: continue to the next task in this iteration if context allows, otherwise exit cleanly (Ralph will re-invoke you)
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- If a task fails after 3 attempts in this iteration, add a note to `PROGRESS.md` under the task: `⚠️ BLOCKED: [reason]`
- Move to the next task if possible
- If all remaining tasks are blocked, output: `⚠️ ALL REMAINING TASKS BLOCKED — human intervention needed`
- NEVER output <promise>ALL_PHASES_COMPLETE</promise> unless EVERY task is genuinely done and verified

## Rules — Non-Negotiable

- **Read PROGRESS.md first, every iteration.** It is your memory.
- **One logical commit per task.** Not per iteration, not per file.
- **Never modify tests to make them pass.** Fix the underlying code.
- **Never skip verification.** Run the full test suite after every task.
- **Never output the completion promise unless all work is done.**
- **Reference docs/*.md for detailed specs** — don't guess at schemas, APIs, or security rules.
```

**Why this structure works with Ralph:**
- Section 0 rebuilds context from files (no conversation memory)
- Section 1 reads PROGRESS.md to find the next task (stateful via file)
- Section 2 executes with backpressure (tests must pass)
- Section 3 persists state to PROGRESS.md (survives between iterations)
- Section 4 exits cleanly or signals completion (Ralph's exit gate)
- Section 5 prevents infinite stuck loops (circuit breaker)

---

### File 3: `PROGRESS.md` (Stateful Checklist — Updated by Claude Every Iteration)

This is the most important file in the system. It is Claude's "memory" across Ralph iterations. Claude reads it to know what's done and what's next. Claude updates it after every task.

**Structure:**

```markdown
# Build Progress

## Current Status
- **Current Phase:** 1
- **Last Updated:** [timestamp]
- **Last Commit:** [hash or "none"]

## Phase 0: Environment & Credentials ✅
- [x] Verify all API keys and services
- [x] Create .env and .env.example
- [x] Confirm all connections

## Phase 1: Project Initialization 🔄
- [x] Create directory structure
- [ ] Install dependencies
- [ ] Configure package.json
- [ ] Set up test runner
- [ ] Create .gitignore
- [ ] Initial commit and push

## Phase 2: Database & Configuration
- [ ] Config loader with env validation
- [ ] Database setup with migrations
- [ ] Logger service
- [ ] Tests for config, database, logger

## Phase 3: [Service Name]
- [ ] Task 1
- [ ] Task 2
- [ ] Tests

...

## Phase N: Deployment & Verification
- [ ] Dockerfile
- [ ] CI/CD workflow
- [ ] Deploy
- [ ] Verify all endpoints
- [ ] Final test suite green
```

**Rules for PROGRESS.md:**
- Phase 0 should be pre-checked (✅) — credentials are verified manually before running Ralph
- Phases use status emoji: ✅ (done), 🔄 (in progress), no emoji (not started)
- Each task is a checkbox: `- [ ]` unchecked, `- [x]` done
- Blocked tasks get: `- [ ] Task ⚠️ BLOCKED: reason`
- Claude updates "Current Phase", "Last Updated", and "Last Commit" each iteration

---

### File 4+: `docs/*.md` (Specification Documents — Progressive Disclosure)

Same as the standard prompt compiler. One file per cross-cutting concern. Claude reads these when working on the relevant phase.

Examples: `docs/AUTH.md`, `docs/LOGGING.md`, `docs/DATABASE.md`, `docs/API.md`

Each spec doc should contain:
- **What** the system does (tables, fields, data flow)
- **How** it works (API surface, code patterns, method signatures)
- **Security rules** (what must NEVER happen)
- **Test expectations** (what tests should verify)

---

### NO scaffold.md or individual phase-N.md files.

Ralph does NOT use slash commands. All phase instructions live in `PROGRESS.md` (the checklist) and `docs/*.md` (the specs). The single `PROMPT.md` orchestrates everything. Do not create `.claude/commands/` files.

---

## HOW TO ANALYZE THE USER'S TODO LIST

Before generating files, think through these steps:

### Step 1: Identify the Stack
What language, framework, database, APIs, deployment target? If the user didn't specify, infer from context or ask.

### Step 2: Identify External Services
Each one needs a credential verified BEFORE Ralph starts (Phase 0 pre-checked in PROGRESS.md).

### Step 3: Identify Cross-Cutting Concerns
Each gets a `docs/*.md` spec file and a reference in CLAUDE.md.

### Step 4: Decompose into Phases → Tasks → Checkboxes
Map each TODO item to a phase. Within each phase, break into atomic tasks. Each task must be:
- **Independently committable** (one `git commit` per task)
- **Independently verifiable** (tests prove it works)
- **Specific enough to execute without ambiguity** (file paths, function names, expected behaviors)

Typical phase ordering:
```
Phase 0: Credentials (pre-checked — done by human before Ralph runs)
Phase 1: Project init, git, dependencies
Phase 2: Config, database, migrations, logging
Phase 3-N: Backend services (one per service/concern)
Phase N+1: API routes
Phase N+2: Frontend/UI
Phase N+3: CI/CD
Phase N+4: Deployment & verification
```

### Step 5: Estimate Iteration Limits
Rough formula: **2-3 iterations per task** (accounting for test failures and retries).
- 20 tasks → `--max-iterations 50`
- 40 tasks → `--max-iterations 100`

Add this recommendation to your output.

### Step 6: Write the Verification Command
What single command proves everything works? Usually: `npx vitest run` or `npm test` or `pytest`. This goes in PROMPT.md Section 2.

---

## CRITICAL RALPH-SPECIFIC RULES

### Rule 1: PROGRESS.md Is the Only Source of Truth
Claude has no memory between iterations. PROGRESS.md must contain everything Claude needs to know about where it left off. If a task requires context that isn't in PROGRESS.md or docs/*.md, the task description is too vague — make it more specific.

### Rule 2: One Task Per Commit
Ralph iterations may complete multiple tasks if context allows. But each task gets its own commit. This lets Ralph (and you) track granular progress via `git log`.

### Rule 3: Backpressure Must Be Mechanical
"Tests pass" is mechanical backpressure. "Code looks good" is not. Every task must have a verifiable success condition. If you can't verify it with a command, split the task differently.

### Rule 4: Never Trust the Completion Promise
The completion promise (`<promise>ALL_PHASES_COMPLETE</promise>`) must ONLY appear when every checkbox in PROGRESS.md is checked AND the full test suite passes. Claude is instructed to verify this, but your `--max-iterations` is your real safety net.

### Rule 5: Phase 0 Is Pre-Checked
Don't ask Ralph to verify credentials — that requires human interaction (entering API keys, running `gh auth login`, etc.). Phase 0 should already be done. Mark it ✅ in PROGRESS.md before running Ralph.

### Rule 6: Keep the Prompt Under 200 Lines
PROMPT.md is loaded every iteration. A bloated prompt wastes tokens on every loop. Keep it lean — reference `docs/*.md` for details, don't inline them.

### Rule 7: Tasks Must Be Atomic
Bad: `- [ ] Build the authentication system`
Good:
```
- [ ] Create users table migration
- [ ] Implement password hashing service
- [ ] Implement 2FA code generation and email sending
- [ ] Create auth middleware (session cookie → req.user)
- [ ] Create POST /api/auth/register route
- [ ] Create POST /api/auth/login route
- [ ] Create POST /api/auth/verify-2fa route
- [ ] Create auth integration tests
```

Each checkbox is one commit, one verification, one progress update.

---

## WHAT NOT TO DO

- **Don't create slash command files.** Ralph doesn't use them.
- **Don't put phase-specific details in PROMPT.md.** That file is the loop controller. Details go in `docs/*.md`.
- **Don't put Ralph instructions in CLAUDE.md.** CLAUDE.md is project context, not loop instructions.
- **Don't create tasks that require human interaction.** Ralph runs autonomously. If it needs human input, it's not a Ralph task.
- **Don't use `<promise>` for per-phase completion.** Use one promise for the whole build. Phase tracking is handled by PROGRESS.md checkboxes.
- **Don't inline large schemas in PROMPT.md.** Reference docs/*.md. PROMPT.md is loaded every iteration — every extra token costs money × N iterations.
- **Don't create vague tasks.** "Implement the backend" is not a task. "Create GET /api/quotes route returning paginated results" is.

---

## AFTER GENERATING ALL FILES

1. List every file you created with its line count
2. Count total tasks (checkboxes) in PROGRESS.md
3. Recommend `--max-iterations` value (tasks × 2.5, rounded up)
4. Verify CLAUDE.md is under 100 lines
5. Verify PROMPT.md is under 200 lines
6. Verify every external service has a Phase 0 pre-check
7. Verify every task has mechanical backpressure (tests)
8. Verify PROGRESS.md has no ambiguous tasks
9. Provide the exact command to start the loop:

```bash
/ralph-loop "Read PROMPT.md and execute the current task" --max-iterations [N] --completion-promise "ALL_PHASES_COMPLETE"
```

10. Present all files to the user

---

## EXAMPLE: How a Raw TODO Becomes Ralph Files

**Raw input:**
```
Build a recipe app. Users log in. It uses OpenAI to suggest recipes from ingredients.
Store recipes in postgres. Deploy to fly.io. I want tests.
```

**Your output would be:**

| File | Purpose | Lines |
|------|---------|-------|
| `CLAUDE.md` | Project brain — stack, style, testing rules | ~80 |
| `PROMPT.md` | Ralph loop controller — orient, execute, update, assess | ~120 |
| `PROGRESS.md` | Stateful checklist — 35 tasks across 8 phases | ~90 |
| `docs/AUTH.md` | Auth spec — tables, flow, bcrypt, sessions, security | ~100 |
| `docs/RECIPE_AI.md` | OpenAI integration — prompts, response parsing, rate limits | ~60 |
| `docs/DATABASE.md` | Postgres schema — all tables, indexes, migrations | ~80 |

**Recommended command:**
```bash
/ralph-loop "Read PROMPT.md and execute the current task" --max-iterations 90 --completion-promise "ALL_PHASES_COMPLETE"
```

**PROGRESS.md would look like:**
```markdown
## Phase 0: Environment & Credentials ✅
- [x] Verify OpenAI API key
- [x] Verify Fly.io auth
- [x] Verify Postgres connection
- [x] Create .env and .env.example

## Phase 1: Project Initialization
- [ ] Create directory structure
- [ ] Install dependencies (express, pg, openai, bcrypt, vitest...)
- [ ] Configure package.json (ESM, scripts)
- [ ] Create vitest.config.js
- [ ] Create .gitignore
- [ ] Initial commit and push

## Phase 2: Database & Config
- [ ] Config loader with env validation
- [ ] Postgres connection pool
- [ ] Run migrations (users, sessions, recipes, ingredients)
- [ ] Logger service
- [ ] Tests for config, database, logger

## Phase 3: Authentication
- [ ] Password hashing service (bcrypt)
- [ ] Session management (create, validate, delete)
- [ ] POST /api/auth/register
- [ ] POST /api/auth/login
- [ ] POST /api/auth/logout
- [ ] GET /api/auth/me
- [ ] Auth middleware (cookie → req.user)
- [ ] Auth integration tests

## Phase 4: Express Server & Middleware
- [ ] Express app with helmet, cors, rate-limit, cookie-parser
- [ ] Error handler middleware
- [ ] Request logger middleware
- [ ] Health check endpoint
- [ ] Middleware tests

## Phase 5: OpenAI Recipe Service
- [ ] OpenAI client wrapper with retry/logging
- [ ] Recipe suggestion from ingredients prompt
- [ ] Response parser (structured recipe output)
- [ ] Recipe service tests (mocked OpenAI)

## Phase 6: API Routes & Frontend
- [ ] GET /api/recipes (paginated, user's saved)
- [ ] POST /api/recipes/suggest (ingredients → AI)
- [ ] POST /api/recipes (save)
- [ ] DELETE /api/recipes/:id
- [ ] Frontend HTML/CSS/JS (login, ingredient input, recipe display)
- [ ] Route integration tests

## Phase 7: CI/CD & Deployment
- [ ] GitHub Actions workflow (test on push)
- [ ] Dockerfile
- [ ] fly.toml
- [ ] Deploy to Fly.io
- [ ] Verify all endpoints on production URL
- [ ] Final full test suite green
```

Each `- [ ]` is one commit. 35 tasks × 2.5 = 88 → `--max-iterations 90`.
