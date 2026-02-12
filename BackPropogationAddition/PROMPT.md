# Historical Quote Backfill -- Autonomous Build

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `BackPropogationAddition/CLAUDE.md` -- project standards (code style, testing, architecture)
- `BackPropogationAddition/PROGRESS.md` -- current phase and task status (YOU update this file)
- `BackPropogationAddition/docs/*.md` -- detailed specs for each subsystem

Check git log for what was done in previous iterations:
- `git log --oneline -20`

**IMPORTANT:** This is a feature addition to an EXISTING app at the project root. All new code must integrate with the existing codebase. Read existing files before modifying them. Match existing patterns exactly.

## 1. Determine Current Task

Read `BackPropogationAddition/PROGRESS.md` to find the current phase and the next unchecked task.
- If the current task is already complete (checkbox checked), move to the next.
- If all tasks in a phase are complete, advance to the next phase.
- If ALL phases are complete, output: <promise>ALL_PHASES_COMPLETE</promise>

## 2. Execute the Current Task

Follow the spec in the relevant `BackPropogationAddition/docs/*.md` file for the current task.

For EVERY task:
1. Write or update tests FIRST (in `tests/unit/` or `tests/integration/`)
2. Implement the code in the existing codebase files
3. Run verification: `npx vitest run`
4. If tests fail, fix the code (not the tests)
5. When green, commit: `git add -A && git commit -m "phase-N: task description"`

**Key integration points:**
- Database schema: modify `src/config/database.js` `initializeTables()` using `ALTER TABLE ADD COLUMN` + `PRAGMA table_info` guard
- New service files: create in `src/services/historical/`
- New route file: create `src/routes/historicalSources.js`, mount in `src/index.js`
- Settings UI: modify `public/js/settings.js` to add Historical Sources section
- Scheduler: modify `src/services/scheduler.js` to call historical fetcher after RSS phase
- Styles: append new CSS at END of `public/css/styles.css`

**Phase-to-doc mapping:**
| Phase | Spec Document |
|-------|---------------|
| 1 (Schema) | `docs/DATABASE.md` |
| 2 (Provider framework) | `docs/HISTORICAL_SOURCES.md` |
| 3 (Providers) | `docs/HISTORICAL_SOURCES.md` |
| 4 (Scheduler) | `docs/SCHEDULER.md` |
| 5 (API routes) | `docs/API.md` |
| 6 (Frontend) | `docs/API.md` + existing settings.js patterns |
| 7 (Tests) | All docs |

## 3. Update Progress

After committing, update `BackPropogationAddition/PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- If the phase is done, mark it complete with checkmark emoji
- Update "Current Phase", "Last Updated", and "Last Commit"
- Save the file

## 4. Assess Completion

- If there are more tasks remaining: continue to the next task in this iteration if context allows, otherwise exit cleanly (Ralph will re-invoke you)
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- If a task fails after 3 attempts in this iteration, add a note to `BackPropogationAddition/PROGRESS.md` under the task: `BLOCKED: [reason]`
- Move to the next task if possible
- If all remaining tasks are blocked, output: `All remaining tasks blocked -- human intervention needed`
- NEVER output <promise>ALL_PHASES_COMPLETE</promise> unless EVERY task is genuinely done and verified

## Rules -- Non-Negotiable

- **Read PROGRESS.md first, every iteration.** It is your memory.
- **One logical commit per task.** Not per iteration, not per file.
- **Never modify existing tests to make them pass.** Fix the underlying code.
- **Never skip verification.** Run `npx vitest run` after every task.
- **Never output the completion promise unless all work is done.**
- **Reference docs/*.md for detailed specs** -- don't guess at schemas, APIs, or UI.
- **Match existing code patterns** -- read the file before modifying it.
- **New CSS goes at the END of styles.css** -- never reorganize existing styles.
- **All new routes follow the existing try/catch + res.json pattern.**
- **Historical articles go into the existing `articles` table** -- use `historical_source_id` to distinguish.
- **All doc paths are relative to `BackPropogationAddition/`.**
- **Preserve all existing functionality.** The RSS fetch cycle must continue working unchanged.
