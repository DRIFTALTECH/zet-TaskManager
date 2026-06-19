---
description: List ZET projects, or show one project's members and sections
argument-hint: "[project name (optional)]"
allowed-tools: mcp__zet__list_projects, mcp__zet__get_project, mcp__zet__list_sections
---

- If `$ARGUMENTS` is empty, call `list_projects` and show each project with its member and section counts.
- If `$ARGUMENTS` names a project, call `get_project` and show its description, members (name + role) and sections.

Only the projects visible to the current user are returned by the server — present exactly what comes back, nothing more.
