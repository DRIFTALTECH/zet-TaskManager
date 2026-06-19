---
description: Log work to your ZET timesheet from a plain-English sentence
argument-hint: "<what you did> [project] [date] [HH:MM-HH:MM]"
allowed-tools: mcp__zet__list_projects, mcp__zet__list_sections, mcp__zet__log_work, mcp__zet__whoami
---

Log a ZET timesheet entry from: `$ARGUMENTS`

Steps:
1. Parse the work description, project, date and time range. Default the date to today if unspecified. Default the time range only if the user gave a duration or none at all — otherwise ask.
2. Resolve the project (call `list_projects` if unclear).
3. A section is REQUIRED. Call `list_sections` and pick the best existing match. Only create a new section if the user clearly asks for one not in the list (`create_section_if_missing=true`).
4. Call `log_work` with date (YYYY-MM-DD), project, description, section, time_from and time_to (HH:MM 24h).
5. Confirm the saved entry: date, project, section, hours, and whether it's billable.

If `log_work` returns `needs_section`, show the `available_sections` and ask the user to pick one.
