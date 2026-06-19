---
description: Post a ZET daily scrum / standup from raw notes
argument-hint: "[date] <notes...>"
allowed-tools: mcp__zet__add_scrum
---

Post a ZET daily scrum from: `$ARGUMENTS`

1. Parse an optional date (YYYY-MM-DD; default today) and the rest as the raw notes.
2. Call `add_scrum` with the date and notes. The server AI-parses the notes into a per-person breakdown — don't pre-format them, pass them as written.
3. Show the returned breakdown back to the user so they can confirm it captured everyone correctly.
