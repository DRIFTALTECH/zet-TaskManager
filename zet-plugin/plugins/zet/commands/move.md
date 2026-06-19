---
description: Move a ZET task to another status / kanban column
argument-hint: "<task title or id> to <backlog|in_progress|in_review|done>"
allowed-tools: mcp__zet__list_my_tasks, mcp__zet__list_project_tasks, mcp__zet__move_task
---

Move a ZET task per: `$ARGUMENTS`

1. Identify the target status: one of `backlog`, `in_progress`, `in_review`, `done`. Map natural phrasing ("done", "in review", "start") to the right value.
2. If the user gave a task id, use it. Otherwise call `list_my_tasks` (or `list_project_tasks` if a project is named) to resolve the title to an id; if more than one matches, ask which.
3. Call `move_task` with the id and status. Confirm the new status.

Board moves are restricted to task assignees server-side — if you get a permission error, relay it and stop.
