# QuoteLog02 — Two-Environment Deployment Pipeline

## 0. Orient (Do This Every Iteration)

Read these files to understand current state:
- `CLAUDE.md` — project standards (code style, testing, architecture, deploy checklist)
- `MAIN_PRODUCTION_PROMPT.md/PROGRESS.md` — current phase and task status (YOU update this file)
- `MAIN_PRODUCTION_PROMPT.md/docs/*.md` — detailed specs for each concern

Check git log for what was done in previous iterations:
- `git log --oneline -20`

## 1. Determine Current Task

Read `MAIN_PRODUCTION_PROMPT.md/PROGRESS.md` to find the current phase and the next unchecked task.
- If the current task is already complete (checkbox checked), move to the next.
- If all tasks in a phase are complete, advance to the next phase.
- If ALL phases are complete, output: <promise>ALL_PHASES_COMPLETE</promise>

## 2. Execute the Current Task

Follow the spec in the relevant `MAIN_PRODUCTION_PROMPT.md/docs/*.md` file for the current phase.

For EVERY task:
1. Implement the code change
2. Run verification: `npm test`
3. If tests fail, fix the code (not the tests)
4. When green, commit: `git add -A && git commit -m "phase-N: task description"`

**IMPORTANT CONSTRAINTS:**
- This project uses ESM modules (`"type": "module"`). All imports use `import`/`export`.
- Windows development: `git push` may hang. Use MCP `push_files` as fallback.
- `package-lock.json` MUST be committed after any dependency changes.
- Do NOT modify `CLAUDE.md` — it already exists with project-level instructions.
- Railway CLI commands with paths starting with `/` need `MSYS_NO_PATHCONV=1` prefix on Windows.
- The existing `.ralph/` directory is from a previous loop — ignore it entirely.

## 3. Update Progress

After committing, update `MAIN_PRODUCTION_PROMPT.md/PROGRESS.md`:
- Check off the completed task: `- [x] Task description`
- If the phase is done, mark it complete with ✅
- Update "Current Phase", "Last Updated", "Last Commit"
- Save the file

## 4. Assess Completion

- If there are more tasks remaining: continue to the next task in this iteration if context allows, otherwise exit cleanly (Ralph will re-invoke you)
- If ALL phases and tasks are done: output <promise>ALL_PHASES_COMPLETE</promise>

## 5. If Stuck

- If a task fails after 3 attempts in this iteration, add a note to `MAIN_PRODUCTION_PROMPT.md/PROGRESS.md` under the task: `⚠️ BLOCKED: [reason]`
- Move to the next task if possible
- If all remaining tasks are blocked, output: `⚠️ ALL REMAINING TASKS BLOCKED — human intervention needed`
- NEVER output <promise>ALL_PHASES_COMPLETE</promise> unless EVERY task is genuinely done and verified

## Rules — Non-Negotiable

- **Read PROGRESS.md first, every iteration.** It is your memory.
- **One logical commit per task.** Not per iteration, not per file.
- **Never modify tests to make them pass.** Fix the underlying code.
- **Never skip verification.** Run `npm test` after every task.
- **Never output the completion promise unless all work is done.**
- **Reference docs/*.md for detailed specs** — don't guess at configuration or commands.
- **Follow CLAUDE.md** for all project conventions (ESM, deploy checklist, Pinecone rules, etc.)
