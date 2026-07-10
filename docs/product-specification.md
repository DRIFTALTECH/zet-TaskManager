# ZET — Complete Product Specification

A detailed product document for building the ZET task management application from scratch. Everything described here exists in the current codebase — nothing is invented.

---

## Table of contents

1. [Product overview](#1-product-overview)
2. [User roles and access](#2-user-roles-and-access)
3. [Technology stack](#3-technology-stack)
4. [Application pages and navigation](#4-application-pages-and-navigation)
5. [Feature: Authentication](#5-feature-authentication)
6. [Feature: Dashboard / Kanban board](#6-feature-dashboard--kanban-board)
7. [Feature: Tasks](#7-feature-tasks)
8. [Feature: Task timer and time logging](#8-feature-task-timer-and-time-logging)
9. [Feature: Timesheet](#9-feature-timesheet)
10. [Feature: Timesheet approval workflow](#10-feature-timesheet-approval-workflow)
11. [Feature: Projects and sections](#11-feature-projects-and-sections)
12. [Feature: Clients](#12-feature-clients)
13. [Feature: Skills](#13-feature-skills)
14. [Feature: Meeting notes / Scrum](#14-feature-meeting-notes--scrum)
15. [Feature: Calendar view](#15-feature-calendar-view)
16. [Feature: Notifications](#16-feature-notifications)
17. [Feature: AI assistant (Zani)](#17-feature-ai-assistant-zani)
18. [Feature: AI task extraction](#18-feature-ai-task-extraction)
19. [Feature: AI insights](#19-feature-ai-insights)
20. [Feature: Forecast and deadline prediction](#20-feature-forecast-and-deadline-prediction)
21. [Feature: Smart task reassignment](#21-feature-smart-task-reassignment)
22. [Feature: Analytics and reports](#22-feature-analytics-and-reports)
23. [Feature: Admin console](#23-feature-admin-console)
24. [Feature: Settings](#24-feature-settings)
25. [Feature: MCP server (AI agent integration)](#25-feature-mcp-server-ai-agent-integration)
26. [Feature: Real-time sync](#26-feature-real-time-sync)
27. [Feature: Microsoft Teams integration](#27-feature-microsoft-teams-integration)
28. [Feature: Clockify integration](#28-feature-clockify-integration)
29. [Feature: Audit logging](#29-feature-audit-logging)
30. [Feature: Companion mascot agent](#30-feature-companion-mascot-agent)
31. [Database schema](#31-database-schema)
32. [API endpoint inventory](#32-api-endpoint-inventory)
33. [Environment configuration](#33-environment-configuration)
34. [Architecture rules](#34-architecture-rules)

---

## 1. Product overview

**ZET** is a full-stack task management and time-tracking application designed for teams with managers and employees. It provides:

- Kanban-based task management with multi-assignee support
- Per-task time tracking with live timers
- Manual timesheet with weekly submission/approval workflow
- AI-powered recommendations for task reassignment
- Deadline forecasting based on workload simulation
- LLM-powered insights, chat, and task extraction
- Meeting notes from scrum meetings and Teams transcripts
- Role-based access (employee, manager, admin)
- Real-time sync across browser tabs via WebSocket
- MCP protocol for external AI agent integration
- Microsoft sign-in (Entra ID / Azure AD)
- Standalone admin console for user/role management

**Target users:** Software teams, agencies, or services companies that need task assignment, time tracking, and manager oversight with AI assistance.

---

## 2. User roles and access

| Role | Access level |
|------|-------------|
| **Employee** | Own tasks, own timesheet, member projects only. Cannot create projects, assign members, or access analytics/forecast. No admin console. |
| **Manager** | All employee access + create projects, assign/remove members, approve tasks, approve timesheets, access analytics/forecast/reports, manage org structure. No admin console. |
| **Admin** | All manager access + standalone `/admin` console. Sees ALL projects and tasks regardless of membership. Can change user roles, reset passwords, deactivate/delete users. Admin role granted only from admin console. |

### Permission enforcement

- **Route level:** Bearer JWT required for all protected endpoints
- **Business level:** Logic layer checks role, project membership, task ownership
- **MCP level:** Employee role cannot call project membership tools

---

## 3. Technology stack

### Frontend

| Technology | Purpose |
|------------|---------|
| React 18 | UI framework |
| TypeScript | Type safety |
| Vite | Build tool and dev server (port 8080) |
| Zustand | Global state management (single store) |
| TanStack Query | Server state caching for analytics pages |
| Shadcn/ui + Radix UI | Component library |
| Tailwind CSS | Styling |
| React Router 6 | Client-side routing |
| dnd-kit | Drag-and-drop (kanban) |
| React Hook Form + Zod | Form validation |
| MSAL browser SDK | Microsoft sign-in |

### Backend

| Technology | Purpose |
|------------|---------|
| FastAPI | REST API framework (port 8000) |
| Python 3 | Language |
| SQLAlchemy 2.0 | ORM model definitions (schema metadata only) |
| db_wrapper | Database access layer (connection pooling, request scope) |
| SQLite | Development database |
| Aurora (AWS) | Production database |
| PyJWT | JWT creation/validation |
| Passlib (bcrypt) | Password hashing |
| FastMCP | Embedded MCP server |
| Groq SDK | Primary LLM provider |
| Ollama | Fallback local LLM |
| Sentry SDK | Error monitoring (optional) |
| Redis | Cross-worker realtime (optional) |

### Architecture pattern

```
Frontend: Pages → Zustand Store → API client → HTTP
Backend:  routes/ → logic/ → crud/ → Database
```

Strict three-layer separation. No SQL outside `crud/`. Routes call exactly one logic function. Logic owns business rules, validation, audit, notifications, and transactions.

---

## 4. Application pages and navigation

### Public pages (no auth required)

| Route | Page | Purpose |
|-------|------|---------|
| `/login` | LoginPage | Microsoft sign-in entry |
| `/signup` | SignUpPage | New user registration (role, job title, experience) |
| `/admin/login` | AdminLoginPage | Standalone admin authentication |

### Authenticated pages (all roles)

| Route | Page | Purpose |
|-------|------|---------|
| `/` | DashboardPage | Kanban board with customizable columns |
| `/tasks` | MyTasksPage | Personal task list grouped by project |
| `/timesheet` | TimesheetPage | Weekly timesheet entry + submission |
| `/calendar` | CalendarPage | Calendar view of timesheet entries |
| `/meeting-notes` | MeetingNotesPage | Scrum/MOM notes by day |
| `/ai` | AIPage | Zani AI chat and task extraction |
| `/settings` | SettingsPage | Profile, password, theme, PAT, audit |

### Manager-only pages

| Route | Page | Purpose |
|-------|------|---------|
| `/reports` | TimeReportPage | Time reports and client summary |
| `/reports/clients/:clientId` | ClientDetailPage | Single-client drill-down |
| `/users` | UsersPage | Member list, org tree, WIP tab |
| `/users/forecast` | WhatWillHappenNextPage | Deadline forecast and recommendations |
| `/users/:userId` | UserDetailPage | Employee profile, tasks, timesheet |
| `/manage` | ManageProjectsOverview | Project grid |
| `/manage/status` | ManageProjectsOverview | Delivery status view |
| `/manage/:projectId` | ProjectDetailPage | Per-project dashboard |
| `/overview` | OverviewPage | Team KPI dashboard |

### Admin page

| Route | Page | Purpose |
|-------|------|---------|
| `/admin` | AdminPage | User management, role changes, password resets |

### Navigation layout

- **Sidebar:** Collapsible, shows nav items based on role
- **Top navbar:** Date display, project filter dropdown, global search (Ctrl+K), notification bell, theme toggle, mobile nav
- **Global search:** Cmd/Ctrl+K modal searching tasks, projects, users from store

---

## 5. Feature: Authentication

### 5.1 Microsoft sign-in (primary)

- MSAL browser SDK handles redirect/popup
- Backend validates `id_token` via Microsoft JWKS (RS256)
- New users auto-created on first sign-in (directed to `/signup` for role selection)
- Returns JWT (`access_token`) stored in `localStorage` as `tm_token`
- "Remember me" option: 30 days vs 24 hours token expiry

### 5.2 Email/password login

- `POST /auth/login` with email + password
- Password verified via bcrypt
- Returns JWT + UserOut
- Endpoints exist but Microsoft sign-in is the primary UI path

### 5.3 Registration

- `POST /auth/register` with name, email, password, role, job_title, experience_months
- Creates user, returns JWT
- Microsoft sign-up redirects to `/signup` page for metadata input

### 5.4 Session restore

On page load:
1. Read `tm_token` from `localStorage`
2. Call `GET /users/me`
3. On success: fetch projects, tasks, users, kanban columns, active timers
4. On failure (401): clear token, redirect to `/login`

### 5.5 Personal access tokens (PAT)

- Users generate tokens from Settings (Developer section)
- Format: `zet_pat_<random>` (shown once, stored as bcrypt hash)
- Usable as `Authorization: Bearer zet_pat_...`
- Powers MCP integration and API scripting
- CRUD: create, list, revoke

### 5.6 Admin authentication

- Separate login form at `/admin/login`
- Supports email/password or Microsoft
- Issues admin-scoped JWT (`scope: "admin"`)
- Stored separately as `tm_admin_token`
- Master admin password configurable via environment

### 5.7 OAuth 2.1 (for MCP clients)

- Dynamic Client Registration (DCR)
- Consent page at `/oauth/consent`
- Supports email/password or Microsoft sign-in on consent page
- Issues PAT as OAuth access token
- Full OAuth 2.1 spec: authorize, token exchange, refresh

---

## 6. Feature: Dashboard / Kanban board

### What it does

- Default landing page (`/`)
- Displays tasks as cards organized in customizable kanban columns
- Drag-and-drop to move tasks between columns (changes task status)
- Global across all user's assigned projects

### Kanban columns

- **Global columns** (not per-user or per-project)
- Default columns seeded on app init
- Users can: add, rename, delete, reorder columns
- Column CRUD stored in `kanban_columns` table

### Task cards show

- Title, project name, priority badge, due date
- Assignee avatars
- Timer start/stop button
- Status chip

### Interactions

- **Drag card** → `POST /tasks/{id}/move` with new status
- **Click card** → Opens `TaskDetailModal`
- **Approve button** (manager) → `POST /tasks/{id}/approve`
- **Start timer** → `POST /tasks/{id}/timer/start`
- **Create task** → Opens `CreateTaskModal`

### Pan/scroll

- Figma-style pan scroll on the board via `KanbanBoardPan` component

---

## 7. Feature: Tasks

### 7.1 Task properties

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (UUID) | Unique identifier |
| `title` | string | Task name |
| `description` | string | Rich text description |
| `project_id` | FK | Parent project |
| `section_id` | FK | Section within project |
| `assigned_to` | FK | Legacy primary assignee |
| `assigned_by` | FK | Who assigned it |
| `created_by` | FK | Creator |
| `due_date` | string (ISO) | Deadline |
| `priority` | string | `Low`, `Medium`, `High`, `Critical` |
| `status` | string | Matches kanban column labels |
| `is_started` | boolean | Whether work has begun |
| `started_at` | string (ISO) | When started |
| `completed_at` | string (ISO) | When completed |
| `approved_by_manager` | boolean | Manager approval flag |
| `time_tracked` | int (seconds) | Total tracked time |
| `min_log_minutes` | int | Minimum duration for timer logs (default 1) |
| `tags_json` | JSON text | Tags array |
| `custom_fields_json` | JSON text | Custom key-value pairs |

### 7.2 Multi-assignee

- `task_assignees` table: `(task_id, user_id, position)`
- Position for ordering assignees
- Assignees set via `assigneeIds` array in create/patch

### 7.3 Task operations

| Operation | API | Who can |
|-----------|-----|---------|
| Create | `POST /tasks` | Any authenticated member of the project |
| Edit | `PATCH /tasks/{id}` | Assignees, managers |
| Delete | `DELETE /tasks/{id}` | Creator, managers |
| Start | `POST /tasks/{id}/start` | Assignees |
| Move (status change) | `POST /tasks/{id}/move` | Assignees, managers |
| Approve | `POST /tasks/{id}/approve` | Manager only |
| Reopen to backlog | `POST /tasks/{id}/reopen-to-backlog` | Manager |
| Log time manually | `POST /tasks/{id}/log-time` | Assignees |

### 7.4 Task sub-resources

#### Checklists (subtasks)

- Items with: title, priority (`Low`, `Medium`, `High`), is_done, position
- CRUD at `/tasks/{id}/checklists`
- Ordered by position
- Created by any task participant

#### Feedback (comments)

- Threaded comments on tasks
- CRUD at `/tasks/{id}/feedback`
- Supports `@mentions` → creates `task_mentioned` notifications
- Shows author name and timestamps

#### Attachments

- File upload to `/tasks/{id}/attachments`
- Stored on disk with UUID filename
- Download via `/tasks/{id}/attachments/{aid}/download`
- Content-type preserved, size tracked
- `X-Content-Type-Options: nosniff` header for security

### 7.5 Side effects on task actions

| Action | Audit log | Notifications |
|--------|-----------|---------------|
| Create | `task.created` | `task_assigned` to all assignees |
| Reassign | `task.updated` | `task_assigned` to new assignees |
| Move | `task.status_changed` | `task_status_changed` to stakeholders |
| Approve | `task.approved` | `task_approved` to assignees |
| Comment | — | `task_commented` + `task_mentioned` |

---

## 8. Feature: Task timer and time logging

### Live timer

- Start: `POST /tasks/{id}/timer/start` → creates `task_timer_runs` row with `started_at`
- Stop: `POST /tasks/{id}/timer/stop` → calculates elapsed seconds, deletes timer run
- Multiple active timers allowed (one per task per user)
- Active timers listed via `GET /tasks/timers/active`
- UI: play/stop button on each TaskCard

### On timer stop

1. Elapsed seconds added to `task_time_logs` (upsert by task+user+date)
2. `tasks.time_tracked` recomputed
3. Best-effort `timesheet_entries` row created (bridging timer to manual timesheet)

### Manual time log

- `POST /tasks/{id}/log-time` with `{ date, seconds }`
- Directly writes to `task_time_logs`
- Updates `tasks.time_tracked`

### Minimum persist duration

- Configurable via `PUT /tasks/timers/min-persist` (body: `{ minutes }`)
- Timer runs shorter than threshold are discarded on stop
- Stored in `app_settings` table

### Time log data model

- `task_time_logs`: one row per `(task_id, user_id, log_date)` — unique constraint
- Seconds are additive (multiple logs on same day accumulate)
- `TaskOut.timeLog` returns map: `{ "YYYY-MM-DD": seconds }`

---

## 9. Feature: Timesheet

### Purpose

Manual work log independent of tasks. Employees record what project/section they worked on, with time ranges.

### Entry fields

| Field | Description |
|-------|-------------|
| `work_date` | YYYY-MM-DD |
| `project_id` | Which project |
| `section_id` | Which section |
| `description` | What was done |
| `time_from` | Start time (HH:MM) |
| `time_to` | End time (HH:MM) |
| `seconds` | Computed duration |
| `billable` | Boolean (default true) |

### CRUD operations

| Action | API |
|--------|-----|
| List entries (date range) | `GET /timesheet/entries?start=&end=` |
| Create entry | `POST /timesheet/entries` |
| Edit entry | `PATCH /timesheet/entries/{id}` |
| Delete entry | `DELETE /timesheet/entries/{id}` |
| Delete all for a day | `DELETE /timesheet/day-entries/{work_date}` |

### Entry validation

- Time range must be valid
- Entries locked once the week is submitted (cannot edit submitted entries until reopened)

### Views

- **TimesheetPage:** Weekly grid, row-per-entry, total hours per day
- **CalendarPage:** Visual calendar with entry blocks
- **Reports (manager):** Team timesheet aggregation
- **Project detail (manager):** Entries for a specific project

### AI timesheet parsing

- Paste natural-language text describing work done
- `POST /ai/parse-timesheet` returns structured rows
- User confirms before entries are created

---

## 10. Feature: Timesheet approval workflow

### Lifecycle

```
Draft → Submitted → Approved
                  → Rejected → (editable again)
```

### Employee actions

| Action | API |
|--------|-----|
| Check week status | `GET /timesheet/submissions/status?week_start=` |
| Submit week | `POST /timesheet/submissions/{week_start}/submit` |

Submit creates a `timesheet_submissions` row with `status: submitted` and notifies the user's manager.

Optional: `dates` array in submit body to specify which days are included.

### Manager actions

| Action | API | Effect |
|--------|-----|--------|
| List submissions | `GET /timesheet/submissions?status=&user_id=` | Filter by status/user |
| List pending | `GET /timesheet/submissions/pending` | Awaiting review |
| Review details | `GET /timesheet/submissions/{id}/review` | Entries + metadata |
| Approve | `POST .../submissions/{id}/approve` | Status → approved |
| Reject | `POST .../submissions/{id}/reject` | Status → rejected, optional note |
| Reopen | `POST .../submissions/{id}/reopen` | Status back to draft (editable) |

### Notifications

| Event | Recipient | Type |
|-------|-----------|------|
| Submit | Manager | `timesheet_submitted` |
| Approve | Employee | `timesheet_approved` |
| Reject | Employee | `timesheet_rejected` |

### Locking rules

- Submitted/approved weeks: entries cannot be edited/deleted
- Rejected weeks: become editable again
- Reopened weeks: return to draft state

---

## 11. Feature: Projects and sections

### Projects

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `name` | Project name |
| `description` | Optional description |
| `client_id` | FK to clients table (optional) |
| `created_by` | User who created it |
| `background_image` | Custom background (uploaded media) |
| `accent_color` | UI accent color |
| `project_image` | Project thumbnail |

### Operations

| Action | API | Who |
|--------|-----|-----|
| List projects (visible) | `GET /projects` | All (filtered by membership/role) |
| Create project | `POST /projects` | Manager/admin |
| Delete project | `DELETE /projects/{id}` | Manager/admin |
| Set client | `PATCH /projects/{id}/client` | Manager |
| Set appearance | `PATCH /projects/{id}/appearance` | Manager |
| Upload media | `POST /projects/{id}/media` | Manager |

### Sections

- Sub-divisions within a project (e.g. "Frontend", "Backend", "Design")
- Tasks and timesheet entries reference a section
- Add: `POST /projects/{id}/sections`
- Delete: `DELETE /projects/{id}/sections/{section_id}` (blocked if tasks exist)

### Members

- `project_members` table: `(project_id, user_id)`
- Add member: `POST /projects/{id}/members`
- Remove member: `DELETE /projects/{id}/members/{user_id}`
- Only managers can manage membership
- Employees see only projects they are members of

### Visibility rules

| Role | Sees |
|------|------|
| Employee | Only member projects |
| Manager | Only member projects |
| Admin | ALL projects |

---

## 12. Feature: Clients

- Clients are organizations that projects belong to
- Fields: `id`, `name`, `created_at`
- One client can have many projects
- Restricts delete if projects exist (`ON DELETE RESTRICT`)
- API: `GET /clients`, `POST /clients`
- Case-insensitive deduplication on create (get-or-create pattern)
- Used in reports for client-level time aggregation

---

## 13. Feature: Skills

### Skills catalog

- Global list of skills (e.g. "React", "Python", "Design")
- API: `GET /skills`, `POST /skills` (get-or-create)

### User skills

- Each user can have multiple skills (`user_skills` table)
- Set by manager: `PATCH /users/{id}/skills` with `{ skillIds: [] }`
- Used by AI recommendation engine for task-person matching

### Task skills

- Each task can be tagged with required skills (`task_skills` table)
- Used by forecast/recommendation engine to score skill match

---

## 14. Feature: Meeting notes / Scrum

### What it does

- Daily meeting notes (scrums/MOMs) organized by date
- Each day can have multiple scrum notes with ordering (position)
- Notes stored as raw text + optional parsed JSON

### Scrum entry fields

| Field | Description |
|-------|-------------|
| `work_date` | YYYY-MM-DD |
| `title` | Note title (default "Scrum") |
| `position` | Order within the day |
| `raw_text` | Plain text content |
| `parsed_json` | Structured parsed output (JSON) |
| `parse_status` | `empty`, `ok`, `failed` |

### Operations

| Action | API |
|--------|-----|
| List date range | `GET /meeting-notes?start=&end=` |
| List for day | `GET /meeting-notes/day/{work_date}` |
| Create | `POST /meeting-notes/day/{work_date}` |
| Update | `PUT /meeting-notes/scrum/{id}` |
| Re-parse | `POST /meeting-notes/scrum/{id}/reparse` |
| Delete | `DELETE /meeting-notes/scrum/{id}` |
| Transcribe audio | `POST /meeting-notes/transcribe` (multipart file) |

### Parsing

- Raw meeting text can be parsed into structured data (attendees, action items, decisions)
- LLM-based parsing via AI subsystem
- Re-parse available if parsing fails or content changes

### Audio transcription

- Upload audio file → transcribed to text via AI
- Result returned for user to save as scrum note

---

## 15. Feature: Calendar view

- Visual calendar showing timesheet entries as time blocks
- Supports creating/editing entries directly on the calendar
- Weekly view available
- Shows submission status per week
- Entry creation from calendar respects same validation as timesheet page

---

## 16. Feature: Notifications

### In-app only (no email)

Notifications are stored in database and consumed via UI polling.

### Notification types

| Type | Trigger | Recipient |
|------|---------|-----------|
| `task_assigned` | Task create/reassign | New assignees |
| `task_status_changed` | Task moved | Task stakeholders |
| `task_approved` | Task approved | Assignees |
| `task_commented` | New comment | Task stakeholders |
| `task_mentioned` | `@mention` in comment | Mentioned users |
| `timesheet_submitted` | Week submitted | Manager |
| `timesheet_approved` | Submission approved | Employee |
| `timesheet_rejected` | Submission rejected | Employee |

### Notification fields

| Field | Description |
|-------|-------------|
| `user_id` | Recipient |
| `type` | Notification type string |
| `title` | Display title |
| `message` | Body text |
| `entity_type` | Related entity (e.g. "task") |
| `entity_id` | ID of related entity |
| `is_read` | Read status |
| `triggered_by` | User who caused it |
| `created_at` | Timestamp |

### API

| Action | Endpoint |
|--------|----------|
| List all | `GET /notifications` |
| Unread count | `GET /notifications/unread-count` |
| Mark one read | `POST /notifications/{id}/read` |
| Mark all read | `POST /notifications/read-all` |

### UI

- `NotificationBell` component in navbar
- Polls every 30 seconds
- Dropdown list with mark-read actions
- Click navigates to related entity

---

## 17. Feature: AI assistant (Zani)

### Chat interface

- Full-page at `/ai`
- Conversational AI with project/task context
- Can perform actions: create tasks, log time, answer questions
- Message history maintained in UI session

### API

```
POST /ai/chat
Body: { messages: [{role, content}], users?: [], projects?: [] }
Returns: { response, actions?: [] }
```

### Capabilities

- Answer questions about tasks, projects, timesheets
- Generate task descriptions
- Summarize tasks
- Create tasks via structured actions
- Context-aware (receives user/project data)

### Backend

- `ai/chains.py` handles conversation logic
- `ai/service.py` manages LLM calls (Groq primary, Ollama fallback)
- Structured output parsing for actions

---

## 18. Feature: AI task extraction

### What it does

- Extract structured tasks from unstructured text or files
- Available from AI page and Companion mascot

### API

| Endpoint | Input | Output |
|----------|-------|--------|
| `POST /ai/extract-tasks` | Text or file (multipart) | Array of extracted task objects |
| `POST /ai/parse-source` | Text or file | Resolved source text |
| `POST /ai/parse-task` | ParseTaskRequest | Parsed task structure |

### Flow

1. User pastes text or uploads file (meeting notes, email, etc.)
2. AI extracts structured tasks (title, description, assignee hints, priority)
3. User reviews and confirms
4. Tasks created via normal task creation flow

---

## 19. Feature: AI insights

### What it does

LLM-generated narrative insights for analytics pages. Turns numbers/data into plain-language advice.

### API

```
POST /insights/generate
Body: { scope: string, context: string }
Returns: InsightsResponse { scope, available, decision, why, evidence[], recommendation, fallbackUsed }
```

### Scopes

| Scope | Used on | Context data from |
|-------|---------|-------------------|
| `deadline_forecast` | ForecastPanel | forecast API response |
| `smart_task_reassignment` | ForecastPanel | reassignment API response |
| `overview_team_summary` | OverviewPage | overview API response |
| `team_structure` | UsersPage (org tab) | organization API response |
| `workload` | WipPage | WIP API response |
| `delivery_risk` | DeliveryPage | delivery risk API response |
| `employee_work` | WorkHistorySheet | performance API response |
| `timesheet_analytics` | TimesheetAnalyticsPanel | timesheet analytics response |

### UI pattern

- `useInsightGenerate` hook manages lazy/cached generation
- `AIInsightsPanel` component renders the insight
- Available on every analytics view

---

## 20. Feature: Forecast and deadline prediction

### What it does

Deterministic schedule simulation (no LLM) that predicts which tasks will be on-time, at-risk, or delayed.

### Algorithm

1. Load all active tasks visible to caller (RBAC filtered)
2. Build per-employee task queue ordered by priority and due date
3. Simulate sequential task completion for each employee
4. Calculate predicted completion date vs due date
5. Classify risk: `healthy`, `moderate`, `high`, `critical`
6. Predict status: `On Track`, `At Risk`, `Delayed`
7. Identify workload imbalances (heavy vs available employees)
8. Suggest reassignments

### API

```
GET /analytics/forecast
Returns: {
  asOf,
  summary: { totalTasks, healthy, moderate, high, critical, atRisk, reassignmentCount },
  prediction: { onTrackTasks, atRiskTasks, delayedTasks },
  workload: { heavy[], available[] },
  employees: [{ userId, name, tasks[], workloadStatus }],
  deadlines: [...],
  reassignments: [...]
}
```

### Access

Manager/admin only. Returns 403 for employees.

### UI

- `/users/forecast` page (`WhatWillHappenNextPage`)
- Embeds `ForecastPanel` component
- Shows deadline predictions + LLM insight overlay

---

## 21. Feature: Smart task reassignment

### What it does

Identifies at-risk/critical tasks and recommends optimal reassignment based on skills and availability.

### Scoring engine

```
Score = 50% skill match + 50% availability
```

- **Skill match:** Compares task's required skills (`task_skills`) with candidate's skills (`user_skills`)
- **Availability:** Based on current task load and workload status

### API

```
GET /analytics/smart-reassignment
Returns: {
  asOf,
  module: "smart_task_reassignment",
  summary: { highCriticalTasksReviewed, atRiskCount, recommendationCount },
  recommendations: [{
    taskId, taskTitle, currentOwner, recommendedOwner,
    whyBullets: string[],
    calculations: { skillMatch, availability, overall },
    score
  }]
}
```

### UI

- `RecommendationScoreCard` displays each recommendation
- Human-readable "why" bullets explain the suggestion
- `recommendationDisplay.ts` formats score/reasoning for display

---

## 22. Feature: Analytics and reports

### Overview dashboard (`/overview`)

- Team KPIs: total tasks, completion rate, time tracked
- Trend charts
- Needs-attention list (at-risk tasks)
- AI insight panel

### Organization tree

- `GET /analytics/organization?startDate=&endDate=`
- Hierarchical manager → employee tree
- Performance metrics per node

### Employee performance

- `GET /analytics/performance/{employee_id}?startDate=&endDate=`
- Individual metrics: tasks completed, hours logged, completion rate

### Work-in-progress (WIP)

- `GET /analytics/wip?startDate=&endDate=&managerId=`
- Current workload per employee
- Available in UsersPage WIP tab

### Delivery risk

- `GET /analytics/delivery-risk`
- Project-level risk assessment
- Used in ManageProjectsOverview status view

### Client hours

- `GET /analytics/clients?startDate=&endDate=`
- Time aggregated by client
- Manager/admin only

### Timesheet analytics

- `GET /analytics/timesheet-analytics?startDate=&endDate=&userId=`
- Utilization, billable hours, trends

### Time reports

- `TimeReportPage` at `/reports`
- Team time data, exportable
- Client summary panels

---

## 23. Feature: Admin console

### Access

Standalone at `/admin` with separate admin JWT token.

### Capabilities

| Action | API |
|--------|-----|
| List all users | `GET /admin/users` |
| List all projects | `GET /admin/projects` |
| Change user role | `PATCH /admin/users/{id}/role` |
| Reset password | `POST /admin/users/{id}/password` |
| Set user's projects | `PUT /admin/users/{id}/projects` |
| Set user's manager | `PATCH /admin/users/{id}/manager` |
| Deactivate user | `POST /admin/users/{id}/deactivate` |
| Activate user | `POST /admin/users/{id}/activate` |
| Delete user | `POST /admin/users/{id}/delete` (with optional reassignment) |
| View audit log | `GET /admin/audit` |
| Change admin password | `POST /admin/password` |

### User deletion

- Optional `reassign_to` parameter to transfer work before deletion
- Validates user has/doesn't have active work

---

## 24. Feature: Settings

### Profile

- Edit name, avatar
- Change password (current + new)

### Appearance

- Dark/light theme toggle (persisted in `localStorage`)
- Mascot on/off toggle

### Developer settings

- Personal access tokens (PAT) management
- Create, list, revoke tokens
- MCP connection instructions displayed

### Audit log view

- User's own audit history
- `GET /audit?limit=200`

### Clockify integration (UI exists but hidden)

- Connect/disconnect Clockify
- Sync settings
- Component exists (`ClockifyCard.tsx`) but import is commented out

---

## 25. Feature: MCP server (AI agent integration)

### What it does

Embedded Model Context Protocol server allowing external AI agents (Claude, Cursor, etc.) to interact with ZET programmatically.

### Transport

- HTTP at `/mcp/` (stateless)
- Same process as the REST API

### Authentication

- OAuth 2.1 with Dynamic Client Registration
- Or direct PAT as Bearer token
- `?token=` query param promoted to Bearer

### Available tools (27)

| Category | Tools |
|----------|-------|
| Identity | `whoami` |
| Users | `find_employees` |
| Projects | `list_projects`, `get_project`, `assign_user_to_project`, `remove_user_from_project`, `list_sections`, `create_section` |
| Tasks | `list_my_tasks`, `list_project_tasks`, `create_task`, `move_task`, `get_task`, `update_task` |
| Comments | `add_task_comment`, `list_task_comments` |
| Checklists | `add_checklist_item`, `set_checklist_item`, `list_checklist` |
| Attachments | `upload_task_attachment` |
| Timers | `start_timer`, `stop_timer` |
| Timesheet | `get_timesheet`, `log_work`, `update_timesheet_entry`, `delete_timesheet_entry` |
| Meeting notes | `add_scrum` |

### Role restrictions

- Employees cannot see/call: `assign_user_to_project`, `remove_user_from_project`
- All tools call `logic/` layer (inherit all business rules)

---

## 26. Feature: Real-time sync

### Mechanism

- WebSocket at `GET /sync/ws?token=<jwt>`
- Server bumps entity version counters on mutations (tasks, projects)
- Client receives version change → refetches stale data

### Fallback

- If WebSocket unavailable: polls `GET /sync/version` periodically
- Compares local version → refetches if behind

### Multi-worker support

- Optional Redis pub/sub (`REDIS_URL`) for fan-out across multiple backend workers
- Without Redis: realtime works within single process only

### Frontend hook

- `useLiveSync()` in `AppLayout`
- Manages connection lifecycle, reconnection, version comparison

---

## 27. Feature: Microsoft Teams integration

### What it does

Import meeting transcripts from Microsoft Teams into scrum notes.

### Requirements

- App-only Graph permissions: `OnlineMeetingTranscript.Read.All`
- Entra app registration with client secret
- Teams application-access-policy for target organizer

### API

| Endpoint | Purpose |
|----------|---------|
| `GET /integrations/teams/status` | Check if Graph is configured |
| `POST /integrations/teams/import` | Import a specific meeting transcript |
| `POST /integrations/teams/sync` | Sync recent transcripts |

### Flow

1. Backend authenticates to Graph API using client credentials
2. Fetches meeting transcript (VTT format)
3. Converts VTT to text
4. Creates scrum note from transcript content
5. Records import in `teams_transcript_imports` (prevents re-import)

### Alternative: Client-side VTT import

- Frontend can also acquire Graph token via MSAL
- Upload VTT file directly to create scrum

---

## 28. Feature: Clockify integration

### What it does

Sync time entries from Clockify into ZET (for teams migrating from Clockify).

### Status

Backend implementation complete; **UI component exists but is hidden** (commented out import in Settings).

### API (Manager/admin only)

| Endpoint | Purpose |
|----------|---------|
| `GET /clockify/status` | Current sync status |
| `GET /clockify/connection` | Connection details |
| `POST /clockify/connect` | Connect with API key + workspace ID |
| `POST /clockify/disconnect` | Remove connection |
| `POST /clockify/sync/incremental` | Sync new entries |
| `POST /clockify/sync/full` | Full re-sync |
| `PUT /clockify/auto-sync` | Enable/disable auto-sync |

---

## 29. Feature: Audit logging

### What gets logged

Every significant business action creates an `audit_logs` entry:

| Field | Description |
|-------|-------------|
| `user_id` | Who performed the action |
| `action` | Event type (e.g. `task.created`, `task.status_changed`, `project.created`) |
| `entity_type` | What was affected (task, project, user, etc.) |
| `entity_id` | ID of affected entity |
| `entity_name` | Human-readable name |
| `details` | JSON with change details |
| `created_at` | Timestamp |

### Access

| Consumer | API |
|----------|-----|
| User (own audit) | `GET /audit?limit=200` |
| Admin (all) | `GET /admin/audit?limit=200` |

### Automatic purging

Old audit logs are purged automatically (`logic/audit.purge_old_audit_logs`).

---

## 30. Feature: Companion mascot agent

### What it does

A floating AI mascot that appears on certain pages and provides contextual assistance.

### Behavior

| Route | Mascot | Capabilities |
|-------|--------|-------------|
| `/` (Dashboard) | Tasker | Start/stop timers, move tasks, daily summary |
| `/ai` | Zani | Full AI chat, task extraction |

### Interactions

- Responds to drag-drop events on kanban (mascot as drop target)
- Can trigger task timer start/stop
- Shows daily AI summary
- Opens notification panel
- Triggers task extraction modal

### Agent events

The store emits `agentEvent` on actions like:
- `createTask`, `updateTask` (assign/move), `moveTask`, `approveTask`
- `startTimer`, `stopTimer`

These drive mascot animations.

### Mascot toggle

- User can enable/disable mascots from Settings
- Persisted in `localStorage`

---

## 31. Database schema

27 tables organized in 6 domains. Full column definitions in [erd.md](./erd.md).

### Domain: Identity & auth (5 tables)

| Table | Purpose |
|-------|---------|
| `users` | User accounts (id, name, email, password_hash, role, manager_id, etc.) |
| `personal_access_tokens` | PATs for API/MCP access |
| `oauth_clients` | Registered OAuth clients (MCP) |
| `oauth_grants` | OAuth authorization codes and refresh tokens |
| `app_settings` | Key-value application config |

### Domain: Organization (7 tables)

| Table | Purpose |
|-------|---------|
| `clients` | Client organizations |
| `projects` | Projects (name, description, client, appearance) |
| `project_members` | User ↔ Project membership |
| `sections` | Sub-divisions within projects |
| `skills` | Global skills catalog |
| `user_skills` | User ↔ Skill mapping |
| `task_skills` | Task ↔ Required skill mapping |

### Domain: Work items (6 tables)

| Table | Purpose |
|-------|---------|
| `tasks` | Task records with full metadata |
| `task_assignees` | Multi-assignee with position ordering |
| `task_feedback` | Comment threads on tasks |
| `task_checklists` | Subtask checklist items |
| `task_attachments` | File attachments metadata |
| `kanban_columns` | Kanban board column definitions |

### Domain: Time tracking (4 tables)

| Table | Purpose |
|-------|---------|
| `task_time_logs` | Per-task per-user per-day seconds |
| `task_timer_runs` | Currently running timers |
| `timesheet_entries` | Manual timesheet work rows |
| `timesheet_submissions` | Weekly submission status |

### Domain: Collaboration (4 tables)

| Table | Purpose |
|-------|---------|
| `notifications` | In-app notification records |
| `audit_logs` | Activity audit trail |
| `scrums` | Meeting notes / scrum records |
| `teams_transcript_imports` | Imported Teams transcripts tracking |

### Key relationships

- `users.manager_id` → self-referential (org hierarchy)
- `projects.client_id` → `clients.id` (RESTRICT delete)
- All task sub-resources cascade-delete with parent task
- `timesheet_submissions` unique per (user_id, week_start)
- `task_time_logs` unique per (task_id, log_date, user_id)

---

## 32. API endpoint inventory

~130 REST endpoints + 1 WebSocket + 27 MCP tools.

### Endpoint count by prefix

| Prefix | Count | Auth |
|--------|-------|------|
| `/health` | 1 | None |
| `/auth` | 3 | None |
| `/auth/tokens` | 3 | Bearer |
| `/oauth` | 4 | None |
| `/.well-known` | 2 | None |
| `/admin` | 13 | Admin |
| `/users` | 5 | Bearer |
| `/clients` | 2 | Bearer |
| `/skills` | 2 | Bearer |
| `/projects` | 11 | Bearer |
| `/tasks` (core) | 14 | Bearer |
| `/tasks/{id}/checklists` | 4 | Bearer |
| `/tasks/{id}/attachments` | 4 | Bearer |
| `/kanban` | 5 | Bearer |
| `/timesheet` | 17 | Bearer |
| `/audit` | 1 | Bearer |
| `/notifications` | 4 | Bearer |
| `/sync` | 2 | Bearer/WS |
| `/meeting-notes` | 7 | Bearer |
| `/integrations/teams` | 3 | Bearer |
| `/analytics` | 11 | Bearer + role |
| `/clockify` | 7 | Bearer + manager |
| `/insights` | 1 | Bearer |
| `/ai` | 9 | Bearer (except health) |
| `/mcp` | 27 tools | OAuth/PAT |

---

## 33. Environment configuration

### Required in production

| Variable | Purpose |
|----------|---------|
| `TASKMANAGER_JWT_SECRET` | JWT signing key (min 32 chars) |
| `ADMIN_PASSWORD` | Master admin password (min 8 chars) |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `APP_ENV` | Set to `production` |

### Microsoft integration

| Variable | Purpose |
|----------|---------|
| `MICROSOFT_CLIENT_ID` | Entra app registration client ID |
| `MICROSOFT_CLIENT_SECRET` | For Graph API (Teams transcripts) |
| `MICROSOFT_TENANT_ID` | Tenant ID (required for Graph, optional for auth) |
| `VITE_MICROSOFT_CLIENT_ID` | Frontend MSAL (same as backend client ID) |
| `VITE_MICROSOFT_TENANT_ID` | Frontend tenant (defaults to "common") |

### AI providers

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | Primary LLM (Groq) |
| `OLLAMA_BASE_URL` | Fallback LLM URL |
| `OLLAMA_MODEL` | Ollama model name |

### Infrastructure

| Variable | Purpose |
|----------|---------|
| `REDIS_URL` | Redis for cross-worker realtime |
| `SENTRY_DSN` | Error monitoring |
| `ZET_TEST_SQLITE` | Use SQLite in dev/test |
| `VITE_API_URL` | Backend URL for frontend (default `http://127.0.0.1:8000`) |
| `LOG_LEVEL` | Logging level (default INFO) |
| `DB_SLOW_QUERY_MS` | Slow request threshold (default 200ms) |

### Production safety

- Missing/weak `TASKMANAGER_JWT_SECRET` → startup crash
- Missing `CORS_ORIGINS` → startup crash
- `ADMIN_PASSWORD` same as default → startup crash
- All enforced in `config.py` when `APP_ENV=production`

---

## 34. Architecture rules

These are non-negotiable constraints the codebase enforces:

1. **Every SQL/ORM query lives in `crud/`** — `routes/` and `logic/` must NEVER contain database operations
2. **`routes/` only trigger logic** — one logic function call, no business rules
3. **`logic/` holds all business logic** — validation, permissions, orchestration, audit, notifications, transaction commits
4. **One CRUD module per table/domain** — named for intent (`get_by_id`, `list_for_member`, `create`, `update`, `delete`)
5. **Filtering happens in SQL, not Python** — no fetch-everything-then-filter-in-loop
6. **MCP tools call `logic/`** — never DB or routes directly
7. **Frontend path alias** — `@/` maps to `./src/`
8. **Single Zustand store** — all global state in `appStore.ts`
9. **JWT + PAT dual auth** — both resolve to user_id via same dependency
10. **Audit and notifications are side effects in logic** — never in routes or crud

---

## Summary

ZET is a complete task management platform with:

- **30 features** documented above
- **27 database tables** across 6 domains
- **~130 REST endpoints** + WebSocket + 27 MCP tools
- **3 user roles** with enforced permissions
- **AI capabilities:** chat, task extraction, description generation, summarization, timesheet parsing, insights, forecasting, smart reassignment
- **Integrations:** Microsoft Entra, Microsoft Graph (Teams), Clockify, Groq, Ollama, Sentry, Redis
- **Real-time:** WebSocket with Redis fan-out option

To rebuild this application, implement each feature section above in order, respecting the architecture rules in section 34. The database schema in section 31 (detailed in [erd.md](./erd.md)) defines the data model. The API inventory in section 32 defines the contract between frontend and backend.
