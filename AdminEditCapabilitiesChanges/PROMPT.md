# QuoteLog02 Admin Edit Capabilities — Autonomous Build

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `AdminEditCapabilitiesChanges/CLAUDE.md` — project standards (code style, testing, architecture)
- `AdminEditCapabilitiesChanges/PROGRESS.md` — current phase and task status (YOU update this file)
- `AdminEditCapabilitiesChanges/docs/*.md` — detailed specs for features

Check git log for what was done in previous iterations:
```bash
git log --oneline -20
```

## 1. Determine Current Task

Read `AdminEditCapabilitiesChanges/PROGRESS.md` to find the current phase and the next unchecked task.
- If the current task is already complete (checkbox checked), move to the next.
- If all tasks in a phase are complete, advance to the next phase.
- If ALL phases are complete, output: <promise>ALL_PHASES_COMPLETE</promise>

## 2. Execute the Current Task

Follow the spec in the relevant `AdminEditCapabilitiesChanges/docs/*.md` file for the current phase.

**Spec file mapping:**
- Phase 1 → `docs/SUPER-IMPORTANT.md`
- Phase 2-3 → `docs/KEYWORD-TOPIC-CRUD.md`
- Phase 4, 6-10 → `docs/ADMIN-QUOTE-BLOCK.md`
- Phase 5, 11 → `docs/REVIEW-SETTINGS-UI.md`
- Phase 12-13 → Use CLAUDE.md patterns + existing CSS conventions

For EVERY task:
1. Read the task description in PROGRESS.md carefully — it specifies exact files and functions
2. Write or update tests FIRST (Vitest for backend/logic, Puppeteer for visual)
3. Implement the code change
4. Run verification: `npx vitest run`
5. If tests fail, fix the code (NOT the tests)
6. When green, commit: `git add -A && git commit -m "phase-N: task description"`

**For visual UI tasks (Phases 6-12):**
- After tests pass, also verify with Puppeteer at `https://whattheysaid.news/`
- Login: Username `jakob@karlsmark.com`, Password `Ferret@00`
- Take a screenshot to confirm the UI renders correctly
- If the visual result doesn't match the spec, fix the code and re-verify

## 3. Update Progress

After committing, update `AdminEditCapabilitiesChanges/PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- Update "Current Phase" and "Last Updated" fields
- Update "Last Commit" with the commit hash
- Save the file

## 4. Assess Completion

- If there are more tasks remaining: continue to the next task in this iteration if context allows, otherwise exit cleanly (Ralph will re-invoke you)
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- If a task fails after 3 attempts in this iteration, add a note to PROGRESS.md: `BLOCKED: [reason]`
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
- **Using Puppeteer, visually verify features that have a visual component work correctly.**
- **Use existing patterns:** `prompt()` for edits, `onclick` in template literals, `API.*` wrapper, `showToast()`, `escapeHtml()`.
- **Do NOT edit root CLAUDE.md or create files outside the project structure.** Only modify `src/`, `public/`, `tests/`, and `AdminEditCapabilitiesChanges/PROGRESS.md`.
- **All source files are in the project root** (`E:\Github Repos\QuoteLog02\`), NOT in the AdminEditCapabilitiesChanges folder.
- **Bump cache version** in `public/index.html` `?v=` params after modifying any JS/CSS files.
