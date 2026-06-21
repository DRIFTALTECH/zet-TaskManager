---
description: Pick up a ZET task and work it end-to-end — plan, confirm, build, test, log, close
argument-hint: "[task title/id, or 'first' / blank to choose]"
allowed-tools: mcp__zet__whoami, mcp__zet__list_my_tasks, mcp__zet__get_task, mcp__zet__update_task, mcp__zet__add_task_comment, mcp__zet__list_task_comments, mcp__zet__add_checklist_item, mcp__zet__set_checklist_item, mcp__zet__list_checklist, mcp__zet__upload_task_attachment, mcp__zet__move_task, mcp__zet__start_timer, mcp__zet__stop_timer, mcp__zet__log_work, Read, Edit, Write, Bash, Grep, Glob
---

Work on a ZET task end-to-end. Target: `$ARGUMENTS`

You are driving a real task through the ZET task manager while doing the actual engineering work in this repo. ZET is the system of record — read the task from it, do the work here, and write every step back to it so the user can follow along in the app.

## 1. Pick the task
- If `$ARGUMENTS` is a task id or title, use it.
- If it's empty or "first", call `list_my_tasks`, show them, and pick the first open one (skip `done`/`completed`). If it's ambiguous, ask which.
- Call `get_task` for the chosen task to load the FULL context: description, existing checklist, comments, attachments. Read the description carefully — that's the spec.

## 2. Plan, then STOP for confirmation
- Work out a concrete plan: the files/areas you'll touch and the steps you'll take.
- Post it with `add_task_comment` (prefix it `**Plan (Claude):**`).
- Then **stop and ask the user to confirm** before changing anything. Do not proceed until they say go. If they amend the plan, update the comment.

## 3. Set up the work (after confirmation)
- `move_task` → `in_progress`.
- `start_timer` so the time is tracked automatically.
- Add each plan step as a checklist item with `add_checklist_item` (short, action-style: "Reproduce", "Fix redirect", "Add test", "Run tests").

## 4. Execute, ticking steps as you go
- Do the real work in the repo (Read/Grep/Glob to investigate; Edit/Write to change code). Match the surrounding code style.
- As you finish each step, `set_checklist_item(done=true)` for it — the user watches them tick off live.
- If you discover new steps, add them with `add_checklist_item`. Keep the checklist honest.

## 5. Test
- Run the project's tests / typecheck / lint via Bash (e.g. `npm test`, `npm run lint`, `tsc --noEmit`, `pytest` — whatever the repo uses).
- If something fails, fix it and re-run. Don't claim success on a failing build — report it.

## 6. Record what changed + attach evidence
- `upload_task_attachment`:
  - `plan.md` — the final plan.
  - `changes.diff` — the actual diff (`git diff` output).
  - `test-output.txt` — the test/lint run output (trimmed).
- `add_task_comment` with a `**Done (Claude):**` summary: what changed, which files, test result. Optionally `update_task` to refine the description if the scope shifted (don't overwrite the original spec wholesale).

## 7. Close out
- `stop_timer` (logs the elapsed time to the timesheet). If the timer didn't capture meaningful time, fall back to `log_work` with a sensible range.
- `move_task` → `in_review` (default) or `done` if the user asked you to fully close it.
- Report a short recap to the user with the task's new status.

## Rules
- Confirmation gate in step 2 is mandatory — never edit code before the user approves the plan.
- Relay permission errors plainly (board moves are assignee-only; comments need project membership) and stop.
- Never fabricate results. Tests must actually pass before you say they do.
- Keep ZET in sync at every step — the user should be able to reconstruct what you did from the task's checklist, comments, and attachments alone.
