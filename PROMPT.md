# QuoteLog02 — Swipeable Peppered Quotes Scroll Build

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `CLAUDE.md` — project standards (ESM, Vitest, SQLite patterns, code style)
- `PROGRESS.md` — current phase and task status (YOU update this file)
- Relevant `docs/*.md` for the current phase (see mapping in Section 2)

Check git log for previous work:
```
git log --oneline -20
```

Key conventions (from CLAUDE.md — do NOT duplicate here, just reminders):
- ESM imports. Vanilla JS frontend. Template literals + `onclick` handlers.
- `showToast()` not `alert()`. `escapeHtml()` for all user content.
- SQLite migrations: `PRAGMA table_info` guard before `ALTER TABLE`.
- CSS: use existing custom properties (--bg-*, --text-*, --accent, --font-*, --space-*).
- Tests: Vitest with `fileParallelism: false`.

## 1. Determine Current Task

Read `PROGRESS.md`. Find the current phase (marked 🔄) and the next unchecked `- [ ]` task.
- If the task is already checked `- [x]`, move to the next unchecked task.
- If all tasks in a phase are complete, mark it ✅ and advance to the next phase.
- If ALL phases are complete, output: <promise>ALL_PHASES_COMPLETE</promise>

## 2. Execute the Current Task

Reference the spec doc for the current phase:

| Phase | Doc File |
|-------|----------|
| 1 | `docs/SCHEMA.md` |
| 2 | `docs/SETTINGS_TABS.md` |
| 3–4 | `docs/CARD_CONFIGS.md` |
| 5–6 | `docs/HOMEPAGE_SWIPE.md` |
| 7–8 | `docs/NOTEWORTHY_CARDS.md` |
| 9 | `docs/PEPPERING.md` |
| 10 | All docs (integration) |

For EVERY task:
1. Write or update tests FIRST (in `tests/`)
2. Implement the code
3. Run verification: `npx vitest run`
4. If tests fail, fix the **code** (not the tests)
5. When green, commit: `git add -A && git commit -m "phase-N: task description"`

## 3. Update Progress

After committing, update `PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- Update "Current Phase", "Last Updated", and "Last Commit"
- Save the file

## 4. Assess Completion

- If more tasks remain: continue to the next task if context allows, otherwise exit cleanly
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- After 3 failed attempts in this iteration: add `⚠️ BLOCKED: [reason]` to PROGRESS.md under the task
- Move to the next task if possible
- If all remaining tasks are blocked: `⚠️ ALL REMAINING TASKS BLOCKED — human intervention needed`
- NEVER output <promise>ALL_PHASES_COMPLETE</promise> unless EVERY task is genuinely done and verified

## Rules — Non-Negotiable

- **Read PROGRESS.md first, every iteration.** It is your memory.
- **One logical commit per task.** Not per iteration, not per file.
- **Never modify tests to make them pass.** Fix the underlying code.
- **Never skip verification.** Run `npx vitest run` after every task.
- **Never output the completion promise unless all work is done.**
- **Reference docs/*.md for detailed specs** — don't guess at schemas, APIs, or UI patterns.
- **Follow existing patterns** in adjacent files before inventing new ones.
- **No frameworks.** Vanilla JS with template literals and onclick handlers.
- **Existing noteworthy_items table stays.** New card configs go in the NEW table.
- **Keep CSS in `public/css/styles.css`** — single file, use existing custom properties.
