# ZET — Product Requirements Document (PRD)

**Product:** ZET — Full-stack task & project management platform with AI assistance, time tracking, Microsoft Teams ingestion, and an embedded MCP server.
**Audience:** Product, Engineering, QA, Security.
**Status:** Living document — describes the system as currently implemented.
**Last updated:** 2026-06-22.

---

## 1. Overview

### 1.1 Summary
ZET is a multi-role project management application. Teams organize work as **Projects → Sections → Tasks**, track effort with both a live **task timer** and a manual **timesheet**, collaborate via **comments, checklists and attachments**, and visualize progress through **dashboards and reports**. An **AI assistant** (chat agent + document/audio task extraction) accelerates task creation, and a **Microsoft Teams integration** turns meeting transcripts into structured scrum notes. The same business logic is exposed to AI clients through an **embedded MCP server** secured by OAuth 2.1 personal access tokens.

### 1.2 Goals
- Single source of truth for who is doing what, by when, on which project.
- Frictionless capture of work — typed, spoken, uploaded, or pulled from Teams.
- Accurate per-user / per-project / per-day time accounting.
- Role-appropriate visibility and control (admin / manager / employee).
- Programmatic access for AI agents without bypassing permission rules.

### 1.3 Tech stack
- **Frontend:** React 18 + TypeScript, Vite (dev port 8080), Zustand (single global store), TanStack Query, Shadcn/Radix UI, Tailwind CSS, React Router 6, dnd-kit (drag-and-drop), React Hook Form + Zod.
- **Backend:** FastAPI, SQLAlchemy 2.0, SQLite (`backend/data/taskmanager.db`), PyJWT + Passlib, MSAL (Microsoft), httpx, FastMCP.
- **AI:** LangChain with **Groq** (primary) and **Ollama** (local/cloud fallback); Groq Whisper for transcription.
- **Realtime:** WebSocket version-bus (`/sync/ws`) with `/sync/version` polling fallback; optional Redis for multi-worker version counters.

### 1.4 Architecture (strict layering — mandatory)
```
routes/    → HTTP only: parse input, call ONE logic function, return
logic/     → all business logic, validation, permissions, audit, notifications, transaction boundaries
crud/      → every SQLAlchemy/SQL query (one module per table/domain)
database/  → ORM models + connection
main.py    → FastAPI app, CORS, route + MCP mounting
```
Data flow: `UI → Zustand store → API client (lib/api.ts) → routes → logic → crud → SQLite`.
The MCP server (`mcp_app.py`) calls the **logic** layer directly, inheriting all permission/visibility rules.

---

## 2. Personas & Roles

| Role | In-app powers | Visibility | Console |
|------|---------------|------------|---------|
| **admin** | Everything managers can do **plus** the standalone `/admin` console; role changes; user lifecycle. | ALL projects & tasks. | Yes (`/admin`). |
| **manager** | Create projects, manage sections/members, approve tasks, move any task, see team timesheets/reports. | Only projects they are a member of. | No. |
| **employee** | Own work only: work assigned tasks, log time, comment, upload, manage own kanban/profile. | Only projects they belong to. | No. |

- Admin role is granted **only** from the admin console.
- "Managerial" actions (create project, assign members, AI extraction, approvals) require `manager` or `admin`.

---

## 3. Authentication & Account Management

### 3.1 Description
Email/password and Microsoft (Entra/Azure AD) sign-in, issuing an application JWT stored in `localStorage`. On load, the app restores the session from the JWT.

### 3.2 Functional requirements
- **FR-AUTH-1** Register with name, email, password, optional role → returns JWT + user.
- **FR-AUTH-2** Login with email/password, optional `remember_me` (controls token lifetime).
- **FR-AUTH-3** Microsoft sign-in: `POST /auth/microsoft { id_token, remember_me?, role?, jobTitle?, experienceMonths? }`. Token validated against Microsoft JWKS for the configured tenant; app JWT issued. "Log in / Sign up with Microsoft" buttons appear only when `VITE_MICROSOFT_CLIENT_ID` is set.
- **FR-AUTH-4** Passwords hashed with Passlib; never returned.
- **FR-AUTH-5** `GET /users/me` returns the current profile; `PATCH /users/me` updates name/avatar; `POST /users/me/password` changes password (verifies current).
- **FR-AUTH-6** Protected routes require a valid Bearer JWT; manager-only pages gated client-side (`ProtectedRoute managerOnly`) and server-side.

### 3.3 Config
`MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (backend); `VITE_MICROSOFT_CLIENT_ID`, `VITE_MICROSOFT_TENANT_ID` (frontend). Tenant defaults to `common` (multi-tenant) unless a directory tenant id is supplied.

### 3.4 Endpoints
`POST /auth/login`, `POST /auth/register`, `POST /auth/microsoft`, `GET /users/me`, `PATCH /users/me`, `POST /users/me/password`, `GET /users`.

---

## 4. Admin Console

### 4.1 Description
A separate admin surface (`/admin`, login at `/admin/login`) for tenant administration, distinct from the in-app experience.

### 4.2 Functional requirements
- **FR-ADM-1** Admin login via password **or** Microsoft (`POST /admin/login`, `POST /admin/login/microsoft`) returns an admin-scoped token.
- **FR-ADM-2** List all users and all projects (`GET /admin/users`, `GET /admin/projects`).
- **FR-ADM-3** Change a user's role (`PATCH /admin/users/{id}/role`) — only path to grant `admin`.
- **FR-ADM-4** Reset a user's password (`POST /admin/users/{id}/password`).
- **FR-ADM-5** Set a user's project memberships in bulk (`PUT /admin/users/{id}/projects`).
- **FR-ADM-6** Deactivate / reactivate a user (`POST .../deactivate`, `.../activate`).
- **FR-ADM-7** Delete a user (`POST /admin/users/{id}/delete`, with confirmation body).
- **FR-ADM-8** View the audit log (`GET /admin/audit?limit=`).
- **FR-ADM-9** Change the admin password (`POST /admin/password`).
- **FR-ADM-10** All admin data endpoints require `require_admin`.

---

## 5. Projects & Sections

### 5.1 Description
Projects are the top-level work container; each has ordered **Sections**, **Members**, and visual **appearance** (accent color, project image, background image).

### 5.2 Functional requirements
- **FR-PRJ-1** List projects — visibility-scoped: admin → all; manager/employee → projects they are a member of (`GET /projects`).
- **FR-PRJ-2** Create a project (manager/admin) with name + description (`POST /projects`). Creator becomes a member.
- **FR-PRJ-3** Add / delete sections (`POST /projects/{id}/sections`, `DELETE /projects/{id}/sections/{sectionId}`).
- **FR-PRJ-4** Set appearance (`PATCH /projects/{id}/appearance`) and upload media (`POST /projects/{id}/media`) — background or project image, with optional accent color.
- **FR-PRJ-5** Add / remove members (`POST /projects/{id}/members`, `DELETE /projects/{id}/members/{userId}`).
- **FR-PRJ-6** Delete a project (`DELETE /projects/{id}`) — cascades sections, members, and project-scoped data.
- **FR-PRJ-7** Member list of a project bounds who can be assigned tasks and who can log timesheet rows against it.

### 5.3 Data model
`projects(id, name, description, accent/appearance fields)`, `project_members(project_id, user_id)`, `sections(id, name, project_id)`.

### 5.4 UI
`ManageProjectsOverview` (grid of projects + stats), `ProjectDetailPage` (per-project analytics: hours/day trend, hours per section, member contribution, section drill-down), `ProjectSectionPicker`.

---

## 6. Tasks — Lifecycle & Board

### 6.1 Description
Tasks belong to a **section within a project**, support **multiple ordered assignees**, priority, due date, estimate, tags, and move through a board state machine.

### 6.2 Board state machine
Columns: **backlog → in_progress → testing → in_review → done**, plus terminal **completed** (manager-approved).
- `backlog` — not started.
- `in_progress` — actively being worked.
- `testing` — verifying against the task spec.
- `in_review` — work done, awaiting approval.
- `done` — board-complete; ends any active timer.
- `completed` — manager-approved; **read-only** (cannot be edited, moved, or reassigned).

Kanban columns are **user-customizable** (see §7), so labels/order may vary per user; the underlying status keys drive logic.

### 6.3 Functional requirements
- **FR-TSK-1** List tasks visible to the user (`GET /tasks`); cheap `GET /tasks/version` for change polling.
- **FR-TSK-2** Create a task (`POST /tasks`) with title, description, priority, due date, estimate, tags, project, section, assignees. New tasks start in `backlog`, `approved_by_manager=false`.
- **FR-TSK-3** Patch a task (`PATCH /tasks/{id}`) — fields incl. status, assignees, priority, etc.
- **FR-TSK-4** Start a task (`POST /tasks/{id}/start`) → moves to `in_progress`.
- **FR-TSK-5** Move a task on the board (`POST /tasks/{id}/move`). Permitted to the task's own actors (creator/assignee per board rules) or any manager/admin. Moving to `done` stops active work sessions.
- **FR-TSK-6** Approve a task (`POST /tasks/{id}/approve`, manager/admin) → `completed`, stamps `completed_at`.
- **FR-TSK-7** Reopen a completed task to backlog (`POST /tasks/{id}/reopen-to-backlog`) — allowed to creator, an assignee, or a manager; clears `completed_at` and approval flag.
- **FR-TSK-8** Delete a task (`DELETE /tasks/{id}`).
- **FR-TSK-9** **Completed tasks are immutable**: cannot be reassigned, moved back to an active state, moved on the board, or otherwise changed (returns 400).
- **FR-TSK-10** Multi-assignee via `task_assignees(task_id, user_id, position)` preserving order.

### 6.4 UI
`MyTasksPage` (board + list), `CreateTaskModal`, `TaskDetailModal` (full task: description, assignees, time, comments, checklist, attachments), `TaskSuggest` (typeahead), drag-and-drop board (dnd-kit), optional "mascot" agents for drag interactions.

---

## 7. Kanban Columns (per-user)

### 7.1 Description
Each user customizes their own board columns (label + order) stored in `kanban_columns`.

### 7.2 Functional requirements
- **FR-KAN-1** List columns (`GET /kanban/columns`).
- **FR-KAN-2** Add column (`POST /kanban/columns`).
- **FR-KAN-3** Rename column (`PATCH /kanban/columns/{id}`).
- **FR-KAN-4** Delete column (`DELETE /kanban/columns/{id}`) — returns updated set; guards against removing required states.
- **FR-KAN-5** Reorder columns (`PUT /kanban/columns/reorder`).

---

## 8. Time Tracking

Two complementary mechanisms, both per-user, per-date.

### 8.1 Task timer (live)
- **FR-TIME-1** Start a timer on a task (`POST /tasks/{id}/timer/start`).
- **FR-TIME-2** Stop a timer (`POST /tasks/{id}/timer/stop`, body carries client tz offset). On stop, elapsed seconds (if ≥ minimum) are written to `task_time_logs(task_id, user_id, log_date, seconds)` and the running record cleared.
- **FR-TIME-3** Stopping also **best-effort mirrors** a timesheet row (project/section from the task, wall-clock times in the user's zone). If the mirror fails validation it is skipped — `task_time_logs` remains the source of truth.
- **FR-TIME-4** List active timers (`GET /tasks/timers/active`).
- **FR-TIME-5** Manual time log on a task (`POST /tasks/{id}/log-time`) adds seconds for a date.

### 8.2 Manual timesheet
- **FR-TS-1** List own entries in a range (`GET /timesheet/entries?start&end`).
- **FR-TS-2** Create an entry (`POST /timesheet/entries`): work date, project, section, description, time_from/time_to (→ seconds), billable flag.
- **FR-TS-3** Patch / delete an entry (`PATCH /timesheet/entries/{id}`, `DELETE /timesheet/entries/{id}`); delete a whole day (`DELETE /timesheet/day-entries/{work_date}`).
- **FR-TS-4** Manager views: a user's entries (`GET /timesheet/users/{userId}/entries`), all team entries (`GET /timesheet/entries/all`, visibility-scoped), a project's entries (`GET /timesheet/projects/{projectId}/entries`).
- **FR-TS-5 (validation)** Entries are validated: section must belong to the project; the user must be a project member; **work date may not be in the future** (rejected with tolerance for time zones ahead of UTC).
- **FR-TS-6** UI date picker prevents selecting future dates; weekly views and totals exclude future days.

### 8.3 Data model
`task_time_logs(task_id, user_id, log_date, seconds)` (unique per task+date+user); `timesheet_entries(id, user_id, work_date, project_id, section_id, description, time_from, time_to, seconds, billable, created_at)`; `task_timer_runs` (active runs).

---

## 9. Task Collaboration

### 9.1 Feedback / comments
- **FR-FB-1** List comments on a task (`GET /tasks/{id}/feedback`).
- **FR-FB-2** Create / edit / delete comments (`POST`, `PATCH /.../{feedbackId}`, `DELETE /.../{feedbackId}`).
- Data: `task_feedback(task_id, user_id, message, ...)`.

### 9.2 Checklists
- **FR-CL-1** List items (`GET /checklists?taskId=`).
- **FR-CL-2** Create item with title + priority (`POST /checklists`).
- **FR-CL-3** Patch item — toggle done, rename, reprioritize (`PATCH /checklists/{id}`).
- **FR-CL-4** Delete item (`DELETE /checklists/{id}`).
- Data: `task_checklists(...)`.

### 9.3 Attachments
- **FR-AT-1** List attachments for a task (`GET /attachments?taskId=`).
- **FR-AT-2** Upload a file (`POST /attachments`, multipart).
- **FR-AT-3** Download (`GET /attachments/{id}/download`, returns FileResponse).
- **FR-AT-4** Delete (`DELETE /attachments/{id}`).
- Data: `task_attachments(...)`.

---

## 10. Notifications

### 10.1 Description
In-app notifications surfaced via a bell (`NotificationBell`). Generated by the logic layer on relevant events (e.g. assignment, approval).

### 10.2 Functional requirements
- **FR-NOT-1** List notifications (`GET /notifications`).
- **FR-NOT-2** Unread count (`GET /notifications/unread-count`).
- **FR-NOT-3** Mark one read (`POST /notifications/{id}/read`); mark all read (`POST /notifications/read-all`).
- Data: `notifications(user_id, message, read, created_at, ...)`. `notify_users` fans a message to multiple recipients.

---

## 11. Audit Log

- **FR-AUD-1** Logic-layer audit entries recorded for sensitive actions.
- **FR-AUD-2** In-app audit view (`GET /audit`) and admin audit view (`GET /admin/audit?limit=`).
- **FR-AUD-3** `AuditPage` renders the trail.
- Data: `audit_logs(...)`.

---

## 12. Dashboard & Reports

### 12.1 Dashboard
`DashboardPage` — at-a-glance personal/team overview (active tasks, recent activity, time summaries).

### 12.2 Time report
`TimeReportPage` — range-filtered timesheet reporting; "no time logged" guidance; manager/team scoping.

### 12.3 Calendar
`CalendarPage` with `CalendarView` (month) and `CalendarWeekView` (week) — tasks/work plotted by date.

### 12.4 Users management
`UsersPage` (manager/admin) lists team members; `UserDetailPage` shows a member's weekly logged-hours bar chart (by project), per-project daily-hours trend, status distribution, completed/in-flight tasks, and project-membership management. Charts exclude future-dated data.

---

## 13. Meeting Notes & Scrum

### 13.1 Description
Per-day scrum / minutes-of-meeting captured as raw text or audio, parsed by AI into a clean per-person breakdown.

### 13.2 Functional requirements
- **FR-MN-1** List days with summaries (`GET /meeting-notes`) and a specific day (`GET /meeting-notes/day/{date}`).
- **FR-MN-2** Create a scrum for a day (`POST /meeting-notes/day/{date}`) from notes → parsed into structured per-person items.
- **FR-MN-3** Transcribe dropped audio to text (`POST /meeting-notes/transcribe`) for review before saving.
- **FR-MN-4** Update a scrum (`PUT /meeting-notes/scrum/{id}`), re-parse it (`POST /.../reparse`), delete it (`DELETE /.../{id}`).
- Data: `scrums(...)`.
- UI: `MeetingNotesPage`.

---

## 14. Microsoft Teams Transcript Import

### 14.1 Description
Pull Teams online-meeting transcripts via Microsoft Graph (app-only) and convert them into scrum/meeting notes.

### 14.2 Functional requirements
- **FR-TEAMS-1** Status (`GET /integrations/teams/status`) reports whether Graph is configured.
- **FR-TEAMS-2** Import a single meeting by join URL + organizer email (`POST /integrations/teams/import`): resolve organizer → find meeting → list transcripts → download VTT → parse → store as scrum.
- **FR-TEAMS-3** Sync all not-yet-imported transcripts for an organizer (`POST /integrations/teams/sync`, since date).
- **FR-TEAMS-4** Manager/admin only; the set of readable organizers is bounded by Azure policy.

### 14.3 External requirements (Azure)
- Graph **application** permission `OnlineMeetingTranscript.Read.All`, admin-consented.
- A Teams **application-access-policy** (`New/Grant-CsApplicationAccessPolicy`, PowerShell) granting the app access to the organizer's meetings — there is **no Graph API / portal equivalent**; this is a one-time setup.
- Backend env: `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` (client-credentials flow).
- 403s map to an actionable message naming both the permission and the policy.

### 14.4 Data model
`teams_transcript_imports(...)` tracks imported transcripts to avoid duplicates.

---

## 15. AI Assistant

### 15.1 Providers
LangChain with **Groq** primary (`GROQ_MODEL`/`GROQ_AGENT_MODEL`/`GROQ_STRICT_MODEL`) and automatic **Ollama** fallback (local `http://localhost:11434` or Ollama Cloud with `OLLAMA_API_KEY`; disable with `AI_OLLAMA_FALLBACK=0`). Transcription via Groq Whisper. Structured outputs use Pydantic schemas; a strict constrained-decoding path guarantees valid JSON with a lenient fallback.

### 15.2 Conversational agent (`POST /ai/chat`)
- **FR-AI-1** Agentic tool-calling loop (capped at 8 iterations). Tools: create_project, create_section, create_task, add_member_to_project, list_projects, list_users. Manager-only tools enforced at the tool layer.
- **FR-AI-2** Returns a message plus structured `actions`, `proposals`, and `cards`; system prompt injects the caller's name/role, today's date, the visible users and projects.
- UI: `AIPage`, `TaskSuggest`, agent components.

### 15.3 Task extraction (`POST /ai/extract-tasks`, `POST /ai/parse-source`)
- **FR-AI-3** Accepts typed text, an uploaded document (**.pdf**, **.docx** incl. tables, plain text), or audio (transcribed). `parse-source` returns the resolved text for review before extraction.
- **FR-AI-4** Manager/admin only. Reads the entire input, breaks it into multiple concrete tasks, and assigns each.
- **FR-AI-5 (assignment rules)** Assignee must be a **member of the task's project**; an **explicitly named** owner in the input always wins over heuristics; a **named project** in the input is used exactly; only unassigned work falls back to best-fit by role + experience.
- **FR-AI-6** `.docx` extraction walks the document body in order and renders table rows pipe-delimited so assignee/project/week columns are not lost.

### 15.4 Other AI utilities
- **FR-AI-7** Generate a task description from title/context (`POST /ai/generate-description`).
- **FR-AI-8** Summarize a task's comment thread (`POST /ai/summarize-task/{taskId}`).
- **FR-AI-9** Parse a natural-language day summary into structured timesheet rows with project/section resolution, time inference, gap detection, and confidence (`POST /ai/parse-timesheet`).
- **FR-AI-10** End-of-day standup recap (`GET /ai/summarize-day`).
- **FR-AI-11** Parse free-form text into structured task objects (`POST /ai/parse-task`).
- **FR-AI-12** AI health (`GET /ai/health`).

---

## 16. Embedded MCP Server

### 16.1 Description
A FastMCP server embedded in the backend, mounted at `/mcp` on the same process/port. Tools call the **logic** layer (never the DB), inheriting all permission/visibility rules. Names resolve to IDs automatically; ambiguous names return candidates.

### 16.2 Auth (OAuth 2.1)
- Dynamic Client Registration (DCR); user authorizes via `/oauth/consent` (email/password or Microsoft).
- Issued access token = a ZET **personal access token** (`personal_access_tokens`); the same PAT works directly as `Authorization: Bearer`.
- Discovery metadata at `/.well-known/oauth-protected-resource/mcp` and `/.well-known/oauth-authorization-server/mcp`.
- Users generate/connect tokens from **Settings → Developer settings** (`GET/POST/DELETE /tokens`).
- Consent UI: `GET /oauth/consent`, `POST /oauth/consent`, `POST /oauth/consent/microsoft`, `GET /oauth/msal-callback`.

### 16.3 MCP tools (complete list)
`whoami`, `find_employees`, `list_projects`, `get_project`, `assign_user_to_project`, `remove_user_from_project`, `list_sections`, `create_section`, `get_timesheet`, `log_work`, `update_timesheet_entry`, `delete_timesheet_entry`, `list_my_tasks`, `list_project_tasks`, `create_task`, `move_task`, `get_task`, `update_task`, `add_task_comment`, `list_task_comments`, `add_checklist_item`, `set_checklist_item`, `list_checklist`, `upload_task_attachment`, `start_timer`, `stop_timer`, `add_scrum`.

### 16.4 Working model (for AI clients)
The board is a state machine (backlog → in_progress → testing → in_review → done); clients move tasks to signal progress, keep ZET in sync automatically (timer, checklist, comments), and call `whoami` first since manager/admin tools fail for employees.

### 16.5 Personal access tokens
- **FR-PAT-1** List own tokens (`GET /tokens`).
- **FR-PAT-2** Create a token — secret shown once (`POST /tokens`).
- **FR-PAT-3** Revoke a token (`DELETE /tokens/{id}`).
- Data: `oauth_clients`, `oauth_grants`, `personal_access_tokens`.

### 16.6 ZET Claude Code plugin
`zet-plugin/` packages the MCP server as a Claude Code plugin (marketplace manifest + `.mcp.json`) so it can be connected from Claude Code.

---

## 17. Realtime Sync

- **FR-RT-1** A version bus tracks counters for `tasks`, `projects`, `users`, bumped on every relevant write.
- **FR-RT-2** WebSocket fan-out (`/sync/ws?token=`) pushes new versions to connected clients for live updates.
- **FR-RT-3** Polling fallback (`GET /sync/version`, plus `/tasks/version`) for clients without a socket.
- **FR-RT-4** Optional `REDIS_URL` shares version counters across workers.

---

## 18. Settings & Personalization

- **FR-SET-1** Profile: update name + avatar; change password.
- **FR-SET-2** Theme: dark/light toggle (persisted in store).
- **FR-SET-3** Optional "mascot" agent animations toggle.
- **FR-SET-4** Developer settings: manage personal access tokens / MCP connection.
- UI: `SettingsPage`, `SettingsModal`. App-wide settings table: `app_settings`.

---

## 19. Global Search

- **FR-SRCH-1** Global search modal (`GlobalSearchModal`) over tasks/projects/users; store holds the query.

---

## 20. Navigation & Shell

- App shell: `AppNavbar`, `AppSidebar`, `MobileNav`, `NavLink`, `UserAvatar`, brand assets.
- Route map (`App.tsx`): `/` Dashboard, `/tasks`, `/timesheet`, `/calendar`, `/meeting-notes`, `/reports`, `/users` + `/users/:userId` (manager), `/manage` + `/manage/:projectId` (manager), `/settings`, `/ai`, `/admin/login`, `/admin`, `/login`, `/signup`, `*` → redirect.

---

## 21. Data Model (tables)

`users`, `app_settings`, `projects`, `project_members`, `sections`, `tasks`, `task_assignees`, `task_timer_runs`, `task_time_logs`, `kanban_columns`, `timesheet_entries`, `task_feedback`, `task_checklists`, `task_attachments`, `audit_logs`, `notifications`, `oauth_clients`, `oauth_grants`, `personal_access_tokens`, `scrums`, `teams_transcript_imports`.

---

## 22. Non-functional Requirements

- **Security:** every SQL query confined to `crud/`; permissions enforced in `logic/` and reused by MCP; passwords hashed; JWT bearer auth; Microsoft tokens validated against JWKS; OAuth 2.1 for programmatic access. CORS configurable via `CORS_ORIGINS` (all origins allowed by default in dev).
- **Visibility correctness:** project/task/timesheet/report data must respect role scoping (admin all; manager/employee membership-scoped).
- **Data integrity:** no future-dated time entries; completed tasks immutable; unique constraints on time logs; section-belongs-to-project validation.
- **Performance:** SQL-side filtering (no fetch-all-then-filter); lightweight `version` endpoints for cheap change detection.
- **Resilience:** AI calls fall back Groq → Ollama; strict-decoding falls back to lenient; Teams/Graph failures surface actionable messages.
- **Config (env):** `APP_ENV`, `CORS_ORIGINS`, `MICROSOFT_*`, `GROQ_*`, `OLLAMA_*`, `AI_OLLAMA_FALLBACK`, `REDIS_URL`, `VITE_API_URL`, `VITE_MICROSOFT_*`.

---

## 23. Out of Scope / Known Constraints

- Teams transcript import requires the one-time PowerShell application-access-policy (no portal/API alternative) for the app-only flow; a delegated-auth alternative would remove it but is not implemented.
- SQLite single-file DB (suitable for the current scale; not multi-tenant-sharded).
- Timer→timesheet mirroring is best-effort; `task_time_logs` is authoritative for hours.
