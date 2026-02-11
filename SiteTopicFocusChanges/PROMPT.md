# Site Topic Focus Overhaul — Autonomous Build

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `SiteTopicFocusChanges/CLAUDE.md` — project standards (code style, testing, architecture)
- `SiteTopicFocusChanges/PROGRESS.md` — current phase and task status (YOU update this file)
- `SiteTopicFocusChanges/docs/*.md` — detailed specs for each subsystem

Check git log for what was done in previous iterations:
- `git log --oneline -20`

**IMPORTANT:** This is a feature overhaul of an EXISTING app. All new code must integrate with the existing codebase at `E:\Github Repos\QuoteLog02`. Read existing files before modifying them. Match existing patterns exactly.

## 1. Determine Current Task

Read `SiteTopicFocusChanges/PROGRESS.md` to find the current phase and the next unchecked task.
- If the current task is already complete (checkbox checked), move to the next.
- If all tasks in a phase are complete, advance to the next phase.
- If ALL phases are complete, output: <promise>ALL_PHASES_COMPLETE</promise>

## 2. Execute the Current Task

Follow the spec in the relevant `SiteTopicFocusChanges/docs/*.md` file for the current task.

For EVERY task:
1. Write or update tests FIRST (in `tests/unit/` or `tests/integration/`)
2. Implement the code in the existing codebase files
3. Run verification: `npx vitest run`
4. If tests fail, fix the code (not the tests)
5. When green, commit: `git add -A && git commit -m "phase-N: task description"`

**Key integration points:**
- Database schema: modify `src/config/database.js` (add tables/columns in `initializeDatabase()`)
- New routes: create files in `src/routes/`, mount in `src/index.js`
- Existing routes: modify `src/routes/quotes.js`, `articles.js`, `authors.js` to replace vote fields
- Frontend pages: modify `public/js/home.js`, `quote.js`, `author.js`, `article.js`
- New frontend: create `public/js/important.js`
- New services: create in `src/services/` (topicMaterializer, trendingCalculator, topicSuggester)
- Styles: append to `public/css/styles.css`
- Scheduler: modify `src/services/scheduler.js` to call materializer + trending calculator

**Phase-to-doc mapping:**
| Phase | Spec Document |
|-------|---------------|
| 1 (Schema) | `docs/SCHEMA_MIGRATIONS.md` |
| 2 (Importants API) | `docs/IMPORTANTS_API.md` |
| 3 (View/Share) | `docs/VIEW_SHARE_TRACKING.md` |
| 4 (Topics) | `docs/TOPICS_SYSTEM.md` |
| 5 (Trending) | `docs/TRENDING_SYSTEM.md` |
| 6-7 (Frontend) | `docs/HOMEPAGE_REDESIGN.md` |

## 3. Update Progress

After committing, update `SiteTopicFocusChanges/PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- If the phase is done, mark it complete with checkmark emoji
- Update "Current Phase", "Last Updated", and "Last Commit"
- Save the file

## 4. Assess Completion

- If there are more tasks remaining: continue to the next task in this iteration if context allows, otherwise exit cleanly (Ralph will re-invoke you)
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- If a task fails after 3 attempts in this iteration, add a note to `SiteTopicFocusChanges/PROGRESS.md` under the task: `BLOCKED: [reason]`
- Move to the next task if possible
- If all remaining tasks are blocked, output: `All remaining tasks blocked — human intervention needed`
- NEVER output <promise>ALL_PHASES_COMPLETE</promise> unless EVERY task is genuinely done and verified

## Rules — Non-Negotiable

- **Read PROGRESS.md first, every iteration.** It is your memory.
- **One logical commit per task.** Not per iteration, not per file.
- **Never modify existing tests to make them pass.** Fix the underlying code.
- **Never skip verification.** Run `npx vitest run` after every task.
- **Never output the completion promise unless all work is done.**
- **Reference docs/*.md for detailed specs** — don't guess at schemas, APIs, or UI.
- **Match existing code patterns** — read the file before modifying it.
- **New CSS goes at the END of styles.css** — never reorganize existing styles.
- **All new routes follow the existing try/catch + res.json pattern.**
- **Important? uses voter_hash** (IP+UA hash) — same anonymous dedup pattern as votes.
- **"Articles" stays as the DB table name** — only frontend labels change to "Sources."
- **All doc paths are relative to `SiteTopicFocusChanges/`** — e.g., `SiteTopicFocusChanges/docs/SCHEMA_MIGRATIONS.md`.
