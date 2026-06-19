---
description: View a ZET timesheet for a date range (yours, or an employee's if you manage them)
argument-hint: "[this week | last week | YYYY-MM-DD..YYYY-MM-DD] [employee]"
allowed-tools: mcp__zet__get_timesheet, mcp__zet__find_employees
---

Show a ZET timesheet for: `$ARGUMENTS`

1. Resolve a start and end date (YYYY-MM-DD). Interpret "this week"/"last week"/"today"/"this month" relative to today. If no range is given, default to the current week (Mon–Sun).
2. If an employee name is given, that's a manager/admin view — call `find_employees` to resolve it if needed, then pass it to `get_timesheet`. Otherwise leave employee empty for the caller's own sheet.
3. Call `get_timesheet`. Render entries grouped by date with project, section, description, hours and billable flag. Show a total at the bottom (and billable vs non-billable split).

If the server returns a permission error (e.g. an employee asking for someone else's sheet), report it and stop.
