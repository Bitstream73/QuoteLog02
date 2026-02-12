# QuoteLog02 Admin Changes — Autonomous Build

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `CLAUDE.md` — project standards (code style, testing, architecture)
- `PROGRESS.md` — current phase and task status (YOU update this file)
- `docs/TOP_STORIES.md` — Top Stories feature spec (database, API, UI)
- `docs/ADMIN_EDITING.md` — Inline admin editing spec
- `docs/SETTINGS_REORG.md` — Settings reorganization spec (move quote mgmt, move news sources)

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
1. Write or update tests FIRST (in `tests/unit/` or `tests/integration/`)
2. Implement the code
3. Run verification: `npx vitest run`
4. If tests fail, fix the code (not the tests)
5. When green, commit: `git add -A && git commit -m "phase-N: task description"`

**Important implementation notes:**
- Database migrations go in `src/config/database.js` `initializeTables()` using the existing `ALTER TABLE ADD COLUMN` pattern with `PRAGMA table_info` guard
- Frontend changes go in the appropriate `public/js/*.js` file
- CSS changes go in `public/css/styles.css`
- New API routes go in existing `src/routes/*.js` files — do NOT create new route files
- Use `escapeHtml()` for all user content in HTML templates
- Use `showToast()` for notifications — NEVER `alert()`
- Admin-only UI: wrap in `if (isAdmin)` checks (global var set by `checkAuth()`)

## 3. Update Progress

After committing, update `PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- Update "Last Updated" and "Last Commit"
- If the phase is done, mark it complete with checkmark emoji
- Save the file

## 4. Assess Completion

- If there are more tasks remaining: continue to the next task in this iteration if context allows, otherwise exit cleanly (Ralph will re-invoke you)
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- If a task fails after 3 attempts in this iteration, add a note to `PROGRESS.md` under the task: `BLOCKED: [reason]`
- Move to the next task if possible
- If all remaining tasks are blocked, output: `ALL REMAINING TASKS BLOCKED — human intervention needed`
- NEVER output <promise>ALL_PHASES_COMPLETE</promise> unless EVERY task is genuinely done and verified

## Rules — Non-Negotiable

- **Read PROGRESS.md first, every iteration.** It is your memory.
- **One logical commit per task.** Not per iteration, not per file.
- **Never modify tests to make them pass.** Fix the underlying code.
- **Never skip verification.** Run `npx vitest run` after every task.
- **Never output the completion promise unless all work is done.**
- **Reference docs/*.md for detailed specs** — don't guess at schemas, APIs, or UI layouts.
- **Preserve existing functionality.** These are additive changes to an existing app.
