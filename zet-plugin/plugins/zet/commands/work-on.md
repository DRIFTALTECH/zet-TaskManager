---
description: Pick up a ZET task and work it end-to-end — plan, confirm, build, test, log, close
argument-hint: "[task title/id, or 'first' / blank to choose]"
allowed-tools: mcp__zet__whoami, mcp__zet__list_my_tasks, mcp__zet__get_task, mcp__zet__update_task, mcp__zet__add_task_comment, mcp__zet__list_task_comments, mcp__zet__add_checklist_item, mcp__zet__set_checklist_item, mcp__zet__list_checklist, mcp__zet__upload_task_attachment, mcp__zet__move_task, mcp__zet__start_timer, mcp__zet__stop_timer, mcp__zet__log_work, Read, Edit, Write, Bash, Grep, Glob
---

Work on a ZET task end-to-end. Target: `$ARGUMENTS`

You are driving a real task through the ZET task manager while doing the actual engineering work in this repo. ZET is the system of record — read the task from it, do the work here, and write every step back to it so the user can follow along in the app.

**The board columns are a state machine — move the task to signal where it is:**
- `backlog` = not started · `in_progress` = actively working · `testing` = writing + running tests, fixing in a loop · `in_review` = done, waiting on the user · `done` = user confirmed.
- If the user moves a task back to `in_progress` (or asks for changes in chat), pick it up again from step 2.

## 1. Pick the task
- If `$ARGUMENTS` is a task id or title, use it.
- If it's empty or "first", call `list_my_tasks`, show them, and pick the first open one (skip `done`/`completed`). If it's ambiguous, ask which.
- Call `get_task` for the chosen task to load the FULL context: description, existing checklist, comments, attachments. Read the description carefully — that's the spec.

## 2. Start immediately — keep ZET in sync automatically
The moment you begin, **without asking**:
- `move_task` → `in_progress`
- `start_timer`
- post the plan with `add_task_comment` (prefix `**Plan (Claude):**`)
- add each step as a checklist item via `add_checklist_item` (short, action-style)

These ZET updates are your job — **never** present them as a choice or a menu ("sync to ZET / keep building"). Just do them.

## 3. The only confirmation gate
Pause for the user **only before making substantial CODE changes** to their repo — post the plan and get a quick "go". Writing a doc / analysis / research is the work itself: do it, don't ask first.

## 4. Execute, ticking steps as you go
- Do the real work in the repo (Read/Grep/Glob to investigate; Edit/Write to change code). Match the surrounding code style.
- As you finish each step, `set_checklist_item(done=true)` for it — the user watches them tick off live.
- If you discover new steps, add them with `add_checklist_item`. Keep the checklist honest.

## 5. Test (the Testing column = a loop)
If the task involves code:
- `move_task` → `testing`.
- Write **multiple** test scripts derived from the task's title & description (cover the happy path + edge cases), plus run the project's own suite / typecheck / lint via Bash (`npm test`, `npm run lint`, `tsc --noEmit`, `pytest` — whatever the repo uses).
- Run them for real. For every failure: fix it, re-run. **Loop** — keep iterating until everything passes. Post short progress comments as you go.
- Never claim success on a failing build — report it.

## 6. Record what changed + attach evidence (automatically, the moment it exists)
As soon as you have a deliverable, attach it — don't ask "should I sync this?":
- `upload_task_attachment`:
  - the doc/artifact you produced (e.g. `analysis.md`), and/or
  - `changes.diff` — the actual diff (`git diff` output), and
  - `test-output.txt` — the test/lint run output (trimmed).
- `add_task_comment` with a `**Done (Claude):**` summary: what changed, which files, test result. Optionally `update_task` to refine the description if scope shifted (don't overwrite the original spec wholesale).

## 7. Close out
- `stop_timer` (logs the elapsed time to the timesheet). If the timer didn't capture meaningful time, fall back to `log_work` with a sensible range.
- `move_task` → `in_review`.
- Then ask the user **only to review** the result — and whether to close it to `done`. Never offer a "sync to ZET vs keep building" menu; the sync is already complete.

## Rules
- Confirmation gate in step 2 is mandatory — never edit code before the user approves the plan.
- Relay permission errors plainly (board moves are assignee-only; comments need project membership) and stop.
- Never fabricate results. Tests must actually pass before you say they do.
- Keep ZET in sync at every step — the user should be able to reconstruct what you did from the task's checklist, comments, and attachments alone.
