---
description: List my ZET tasks (optionally filter by a project)
argument-hint: "[project name (optional)]"
allowed-tools: mcp__zet__list_my_tasks, mcp__zet__list_project_tasks
---

Show the user's ZET tasks.

- If `$ARGUMENTS` is empty, call `list_my_tasks`.
- If `$ARGUMENTS` names a project, call `list_project_tasks` with that project.

Render as a compact table: title, status, priority, due date. Group by status (Backlog → In Progress → In Review → Done). If there are none, say so plainly. Don't invent fields the tool didn't return.
