---
description: "Manager/admin: add or remove an employee on a ZET project"
argument-hint: "add|remove <employee> to|from <project>"
allowed-tools: mcp__zet__find_employees, mcp__zet__list_projects, mcp__zet__assign_user_to_project, mcp__zet__remove_user_from_project
---

Manage ZET project membership per: `$ARGUMENTS`

1. Parse the intent: add or remove, which employee, which project.
2. Resolve the employee with `find_employees` and the project with `list_projects` if either is ambiguous.
3. Call `assign_user_to_project` (add) or `remove_user_from_project` (remove). Confirm the result.

These tools are manager/admin only. If the caller is an employee the tools won't even be available, or the call will be blocked — in that case say membership changes require a manager and stop.
