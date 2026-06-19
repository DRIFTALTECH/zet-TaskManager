---
description: Create a ZET task from a natural-language description
argument-hint: "<what to do> [in <project>]"
allowed-tools: mcp__zet__list_projects, mcp__zet__list_sections, mcp__zet__create_task, mcp__zet__find_employees
---

Create a ZET task from: `$ARGUMENTS`

Steps:
1. Work out the project. If the request names one, use it. If not, call `list_projects` and ask the user which project (don't guess when ambiguous).
2. Call `list_sections` for that project and pick the section that best fits; reuse an existing one rather than creating a new section.
3. Parse a title, and if present a priority (Urgent/High/Medium/Low), due date (YYYY-MM-DD) and assignees from the text. If assignees are named, resolve them with `find_employees` first. Default the assignee to the current user.
4. Call `create_task`. Confirm back with the created task's title, project, section, assignees and due date.

If the user lacks access (server returns a permission error), report it plainly and stop.
