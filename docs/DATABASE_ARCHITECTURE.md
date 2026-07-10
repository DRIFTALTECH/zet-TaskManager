# ZET Database Architecture (reverse-engineered from code)

Reverse-engineered from implementation — **not** from existing ERD docs alone.

**Sources inspected:**

| Source | Role |
|--------|------|
| `backend/database/models.py` | SQLAlchemy model metadata (columns, declared FKs) |
| `backend/scripts/bootstrap_aurora.sql` | Production Aurora/Postgres `CREATE TABLE` (canonical bootstrap) |
| `backend/scripts/bootstrap_sqlite.sql` | Test/dev SQLite bootstrap (same tables) |
| `backend/database/init_db.py` | Runtime migrations + seeds (`skills`, `user_skills`, `task_skills`, kanban seed) |
| `backend/scripts/migration_add_indexes.sql` | Optional composite indexes |
| `backend/crud/*` | All SQL read/write paths |
| `backend/logic/*`, `backend/routes/*` | Business callers |
| `backend/db_wrapper/*` | Connection pool / `read()` / `write()` facade |

**Not present:** Prisma schema, Alembic migrations, `schema.sql` at repo root.

**Runtime note:** The app does **not** use SQLAlchemy ORM sessions for queries. `models.py` defines schema metadata; all persistence goes through `db_wrapper.DatabaseWrapper` and raw SQL in `crud/`.

---

## Table inventory and status

| Table | In `bootstrap_aurora.sql` | In `models.py` | Status |
|-------|---------------------------|----------------|--------|
| `users` | Yes | Yes | **Actively used** |
| `app_settings` | Yes | Yes | **Actively used** |
| `clients` | Yes | Yes | **Actively used** |
| `skills` | **No** (init_db migration only) | Yes | **Actively used** |
| `user_skills` | **No** (init_db migration only) | Yes | **Actively used** |
| `task_skills` | **No** (init_db migration only) | **No** | **Partially used** (read-only) |
| `projects` | Yes | Yes | **Actively used** |
| `project_members` | Yes | Yes | **Actively used** |
| `sections` | Yes | Yes | **Actively used** |
| `tasks` | Yes | Yes | **Actively used** |
| `task_assignees` | Yes | Yes | **Actively used** |
| `task_timer_runs` | Yes | Yes | **Actively used** |
| `task_time_logs` | Yes | Yes | **Actively used** |
| `kanban_columns` | Yes | Yes | **Actively used** |
| `timesheet_submissions` | Yes | Yes | **Actively used** |
| `timesheet_entries` | Yes | Yes | **Actively used** |
| `task_feedback` | Yes | Yes | **Actively used** |
| `task_checklists` | Yes | Yes | **Actively used** |
| `task_attachments` | Yes | Yes | **Actively used** |
| `audit_logs` | Yes | Yes | **Actively used** |
| `notifications` | Yes | Yes | **Actively used** |
| `oauth_clients` | Yes | Yes | **Actively used** |
| `oauth_grants` | Yes | Yes | **Actively used** |
| `personal_access_tokens` | Yes | Yes | **Actively used** |
| `scrums` | Yes | Yes | **Actively used** |
| `teams_transcript_imports` | Yes | Yes | **Actively used** |
| `zet_wrapper_demo` | No | No | **Experimental** (wrapper test only) |
| `test` | No | No | **Experimental** (wrapper test only) |

A fully initialized production database has **26 application tables** (23 from bootstrap + 3 skill tables from `init_db._migrate_skills()`).

---

# users

## Purpose

Identity and authorization for all in-app users (`manager`, `employee`, `admin`). Stores credentials, profile fields, org hierarchy (`manager_id`), and account state.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Type | Nullable | Notes |
|--------|------|----------|-------|
| `id` | VARCHAR | NO | App-generated id (e.g. `u…` via `new_id`) |
| `name` | VARCHAR | NO | Display name |
| `email` | VARCHAR | NO | Unique, login key (case-insensitive lookup in CRUD) |
| `password_hash` | VARCHAR | NO | bcrypt hash; empty string for Microsoft-only users |
| `role` | VARCHAR | NO | `manager` \| `employee` \| `admin` (model comment omits `admin` but code uses it) |
| `avatar` | VARCHAR | NO | URL or data URL |
| `job_title` | VARCHAR | NO | Profile |
| `experience_months` | INTEGER | NO | Months at signup; combined with `joined_at` for tenure |
| `joined_at` | VARCHAR | NO | ISO datetime string |
| `is_active` | BOOLEAN | NO | `false` = cannot log in; data retained |
| `manager_id` | VARCHAR | YES | FK → `users.id`; timesheet approval routing |

**Indexes (bootstrap):** `ix_users_email`, `ix_users_manager_id`

## Foreign Keys

| Column | References | ON DELETE |
|--------|------------|-----------|
| `manager_id` | `users.id` | SET NULL (self-referential) |

## Referenced By

`projects.created_by`, `tasks` (assigned_to, assigned_by, created_by), `project_members.user_id`, `task_assignees.user_id`, `task_timer_runs.user_id`, `task_time_logs.user_id`, `timesheet_submissions` (user_id, reviewer_id), `timesheet_entries.user_id`, `task_feedback.user_id`, `task_checklists.created_by`, `task_attachments.uploaded_by`, `audit_logs.user_id`, `notifications` (user_id, triggered_by), `personal_access_tokens.user_id`, `user_skills.user_id`, `scrums.updated_by`, `teams_transcript_imports.imported_by`

## Relationships

```
users.manager_id → users.id
```

Purpose: line manager for timesheet review (`timesheet_submissions` listing joins `users.manager_id`).

Used by: `backend/crud/timesheet_submissions.py`, `backend/logic/timesheet_logic.py`

## How the application uses this table

- Registration and login (`auth_logic`); Microsoft sign-in creates/links users.
- Profile updates, password changes, manager assignment, role changes, activation.
- Visibility: project membership and role drive what projects/tasks a user sees.
- Admin console lists, edits, and hard-deletes users with reassignment (`admin_logic` + `crud/admin.py`).

## Files that read this table

`backend/crud/users.py`, `backend/crud/admin.py`, `backend/crud/analytics.py`, `backend/crud/timesheet_submissions.py` (JOIN), `backend/logic/*` (via users_crud), `backend/ai/tools.py`, `backend/ai/chains.py`

## Files that write this table

`backend/crud/users.py` (create, update, password, role, active, manager, project membership side effects on `project_members`), `backend/crud/admin.py` (`reassign_and_delete_user`), `backend/logic/auth_logic.py` (registration / Microsoft user create)

---

# app_settings

## Purpose

Key/value store for app-level configuration that must survive restarts (not env-only).

## Primary Key

`key` (`VARCHAR`)

## Columns

| Column | Type | Notes |
|--------|------|-------|
| `key` | VARCHAR | Setting name |
| `value` | TEXT | Opaque string (often JSON for structured state) |

## Foreign Keys

None.

## Referenced By

None (logical keys only).

## Known keys (from code)

| Key | Set by | Purpose |
|-----|--------|---------|
| `admin_password_hash` | `auth_logic` | Overrides env admin password for `/admin` console |
| `min_timer_persist_minutes` | `timer_logic` | Minimum seconds before timer stop writes time log |
| `clockify.api_key` | `clockify_logic` | Clockify API key |
| `clockify.workspace_id` | `clockify_logic` | Clockify workspace |
| `clockify.auto_sync` | `clockify_logic` | Auto-sync toggle |
| `clockify.sync_status` | `clockify_logic` | JSON sync job state (not a separate table — comment in `clockify_logic.py` mentioning `ClockifySyncJob` is **misleading**) |

## How the application uses this table

Singleton config and integration secrets. Read on demand; upsert on change.

## Files that read this table

`backend/crud/settings.py` → `auth_logic`, `timer_logic`, `clockify_logic`

## Files that write this table

`backend/crud/settings.py` → `auth_logic`, `timer_logic`, `clockify_logic`

**Status:** Actively used (configuration — include in production ERD as optional/supporting).

---

# clients

## Purpose

Client organizations that own projects (billing / reporting grouping).

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR | App-generated |
| `name` | VARCHAR | Unique enforced in logic (case-insensitive lookup) |
| `created_at` | VARCHAR | ISO datetime |

## Foreign Keys

None.

## Referenced By

`projects.client_id`

## Relationship

```
projects.client_id → clients.id
```

Purpose: associate a project with a client.

Used by: `backend/crud/projects.py`, `backend/logic/project_logic.py`, `backend/logic/client_logic.py`

## How the application uses this table

Managers create clients; projects optionally link via `client_id`. Client list for project forms.

## Files that read this table

`backend/crud/clients.py`, `backend/logic/client_logic.py`

## Files that write this table

`backend/crud/clients.py` (INSERT only — no update/delete CRUD found)

---

# skills

## Purpose

Catalog of skill tags (e.g. technologies) attachable to users.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR | e.g. `sk…` |
| `name` | VARCHAR | Display name |
| `created_at` | VARCHAR | ISO datetime |

## Schema note

Created by `init_db._migrate_skills()`, **not** in `bootstrap_aurora.sql`. Fresh Aurora bootstrap alone would miss this table until `init_db()` runs.

## Foreign Keys

None.

## Referenced By

`user_skills.skill_id`, `task_skills.skill_id` (if populated)

## How the application uses this table

Managers list/create skills; attach to users via `user_skills`. Used in forecast/skill-matching (`task_forecast_logic` reads user skills).

## Files that read this table

`backend/crud/skills.py`, `backend/logic/skill_logic.py`, `backend/logic/task_forecast_logic.py`

## Files that write this table

`backend/crud/skills.py` (INSERT)

**Routes:** `backend/routes/skills.py`

---

# user_skills

## Purpose

Many-to-many: which skills each user has.

## Primary Key

Composite (`user_id`, `skill_id`)

## Columns

| Column | Type | FK |
|--------|------|-----|
| `user_id` | VARCHAR | → `users.id` CASCADE |
| `skill_id` | VARCHAR | → `skills.id` CASCADE |

## How the application uses this table

Managers set a user's skill set (`skill_logic.set_user_skills`). Forecast logic reads skill names per user for assignment recommendations.

## Files that read this table

`backend/crud/skills.py`

## Files that write this table

`backend/crud/skills.py` (`set_for_user` — DELETE + INSERT)

**Status:** Actively used.

---

# task_skills

## Status

**PARTIALLY USED**

## Purpose (intended)

Many-to-many: skills required or associated with a task (for forecast / skill matching).

## Primary Key

Composite (`task_id`, `skill_id`) — per `init_db._migrate_skills()` DDL

## Columns

| Column | Type | FK |
|--------|------|-----|
| `task_id` | VARCHAR | → `tasks.id` CASCADE |
| `skill_id` | VARCHAR | → `skills.id` CASCADE |

## Schema note

- Created only in `init_db._migrate_skills()` — **not** in `bootstrap_aurora.sql`
- **No** SQLAlchemy model in `models.py`

## Application usage

| Operation | Found in code? |
|-----------|----------------|
| SELECT | Yes — `crud/skills.py` → `skill_names_by_task_ids()` |
| INSERT / UPDATE / DELETE | **No** — Unable to verify any write path from code |
| Routes / Logic writes | **No** |

`task_forecast_logic` reads `task_skills` for skill-match scoring; without writes, rows would only exist from manual SQL or removed features.

## Recommendation

Either implement task–skill assignment (CRUD + API) or **exclude from production ERD** and drop table if empty. Do not treat as a core entity until writes exist.

---

# projects

## Purpose

Top-level work container: name, client, media, members, sections, tasks.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Type | FK / notes |
|--------|------|------------|
| `id` | VARCHAR | PK |
| `name` | VARCHAR | |
| `description` | VARCHAR | |
| `client_id` | VARCHAR | → `clients.id` (nullable; model `RESTRICT`, bootstrap plain REFERENCES) |
| `created_by` | VARCHAR | → `users.id` |
| `created_at` | VARCHAR | |
| `background_image` | TEXT | URL/data URL |
| `accent_color` | VARCHAR | Hex accent |
| `project_image` | VARCHAR | Thumbnail |

## Foreign Keys

| Column | References |
|--------|------------|
| `client_id` | `clients.id` |
| `created_by` | `users.id` |

## Referenced By

`project_members`, `sections`, `tasks`, `timesheet_entries`

## Relationship examples

```
projects.created_by → users.id
```

Purpose: record who created the project.

Used by: `backend/crud/projects.py`, `backend/routes/projects.py`, `backend/logic/project_logic.py`

```
projects.client_id → clients.id
```

Purpose: client association for reporting.

Used by: `backend/crud/projects.py`, `backend/logic/project_logic.py`

## How the application uses this table

CRUD for managers; membership controls visibility; delete cascades manually in CRUD (tasks, sections, timesheet entries, members).

## Files that read this table

`backend/crud/projects.py`, `backend/crud/admin.py`, `backend/crud/analytics.py`, `backend/logic/project_logic.py`, `backend/ai/tools.py`

## Files that write this table

`backend/crud/projects.py`, `backend/crud/admin.py` (reassign `created_by` on user delete)

---

# project_members

## Purpose

Many-to-many project membership (who can see/work on a project).

## Primary Key

Composite (`project_id`, `user_id`)

## Columns

| Column | FK |
|--------|-----|
| `project_id` | → `projects.id` |
| `user_id` | → `users.id` |

**Index:** `ix_project_members_user_id`

## How the application uses this table

Gate for task/project visibility (`tasks` queries JOIN `project_members`). Managers add/remove members; admin assigns projects to users.

## Files that read this table

`backend/crud/projects.py`, `backend/crud/users.py`, `backend/crud/tasks.py`, `backend/crud/admin.py`

## Files that write this table

`backend/crud/projects.py` (`add_member`, `remove_member`), `backend/crud/users.py` (`set_project_membership`)

---

# sections

## Purpose

Columns/sections within a project (task grouping; timesheet rows also reference section).

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | FK |
|--------|-----|
| `id` | PK |
| `name` | |
| `project_id` | → `projects.id` |

**Index:** `ix_sections_project_id`

## Referenced By

`tasks.section_id`, `timesheet_entries.section_id`

## How the application uses this table

Created with projects; tasks and manual timesheet entries must reference a section. Delete section via project logic (guarded by task/timesheet counts in logic).

## Files that read this table

`backend/crud/sections.py`, `backend/logic/project_logic.py`

## Files that write this table

`backend/crud/sections.py` (INSERT, DELETE)

---

# tasks

## Purpose

Core work item: assignment, status (kanban column id), priority, dates, time aggregate, JSON tags/custom fields.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Type | Notes |
|--------|------|-------|
| `id` | VARCHAR | PK |
| `title`, `description` | VARCHAR/TEXT | |
| `project_id` | VARCHAR | FK → `projects.id` |
| `section_id` | VARCHAR | FK → `sections.id` |
| `assigned_to` | VARCHAR | FK → `users.id` — **primary assignee (legacy + denormalized)** |
| `assigned_by` | VARCHAR | FK → `users.id` |
| `created_by` | VARCHAR | FK → `users.id` |
| `due_date` | VARCHAR | ISO date string |
| `priority` | VARCHAR | |
| `status` | VARCHAR | **Kanban column id** (e.g. `backlog`, `in_progress`) — **no DB FK** |
| `is_started` | BOOLEAN | |
| `started_at` | VARCHAR | ISO timestamp prefix match for daily views |
| `completed_at` | VARCHAR | ISO date when done |
| `approved_by_manager` | BOOLEAN | |
| `time_tracked` | INTEGER | **Denormalized** total seconds (from `task_time_logs`) |
| `min_log_minutes` | INTEGER | Per-task minimum log granularity |
| `tags_json` | TEXT | JSON array |
| `custom_fields_json` | TEXT | JSON object |
| `created_at` | VARCHAR | |

**Indexes:** `ix_tasks_project_id`, `ix_tasks_section_id`, `ix_tasks_assigned_to`; optional `migration_add_indexes.sql` composites.

## Foreign Keys (declared)

`project_id`, `section_id`, `assigned_to`, `assigned_by`, `created_by` → respective tables.

## Missing FK (logical only)

```
tasks.status  ~~>  kanban_columns.id   (NO database FK)
```

Purpose: task column on board. Enforced in application (`kanban_logic`, `task_logic`); deleting a column reassigns tasks to `backlog` via `tasks_crud.reassign_status`.

Used by: `backend/crud/kanban.py`, `backend/crud/tasks.py`, `backend/logic/kanban_logic.py`

## Referenced By

`task_assignees`, `task_timer_runs`, `task_time_logs`, `task_feedback`, `task_checklists`, `task_attachments`, `task_skills` (if used)

## Redundant / duplicated data

1. **`assigned_to` vs `task_assignees`** — Multi-assignee truth is `task_assignees`; `assigned_to` kept as primary/fallback (`task_logic` documents pre-multi-assignee tasks).
2. **`time_tracked` vs `task_time_logs`** — `timelog_crud` recomputes and updates `tasks.time_tracked` on log changes.

## How the application uses this table

Full task lifecycle: create, update, move status, start/complete, approve, delete. Central entity for UI, analytics, AI tools, MCP.

## Files that read this table

`backend/crud/tasks.py`, `backend/crud/analytics.py`, `backend/crud/admin.py`, `backend/logic/task_logic.py`, `backend/logic/analytics_logic.py`, `backend/logic/task_forecast_logic.py`, `backend/logic/daily_summary_logic.py`, `backend/ai/*`

## Files that write this table

`backend/crud/tasks.py`, `backend/crud/timelog.py` (updates `time_tracked`), `backend/crud/projects.py` (delete by project), `backend/crud/admin.py` (reassign columns)

**Routes:** `backend/routes/tasks.py`, nested feedback/timer endpoints

---

# task_assignees

## Purpose

Ordered multi-assignee list per task (`position` ordering).

## Primary Key

Composite (`task_id`, `user_id`)

## Columns

| Column | Notes |
|--------|-------|
| `task_id` | FK → `tasks.id` CASCADE |
| `user_id` | FK → `users.id` CASCADE |
| `position` | Sort order |

**Index:** `ix_task_assignees_user_id`

## How the application uses this table

Replaces single-assignee model; `task_logic` syncs `tasks.assigned_to` to first assignee. Visibility checks use assignee membership.

## Files that read this table

`backend/crud/task_assignees.py`, `backend/crud/tasks.py`, `backend/crud/admin.py`

## Files that write this table

`backend/crud/task_assignees.py` (`set_assignees`)

---

# task_timer_runs

## Purpose

Active server-side timer session per (`user_id`, `task_id`) — survives browser reload.

## Primary Key

Composite (`user_id`, `task_id`)

## Columns

| Column | Notes |
|--------|-------|
| `user_id` | FK → `users.id` CASCADE |
| `task_id` | FK → `tasks.id` CASCADE |
| `started_at` | ISO UTC; elapsed computed on stop |

## How the application uses this table

`timer_logic` start/stop/list; on stop, elapsed seconds flow to `task_time_logs` and optionally timesheet entries, then row deleted.

## Files that read this table

`backend/crud/timers.py`

## Files that write this table

`backend/crud/timers.py` (INSERT, DELETE)

**Routes:** `backend/routes/tasks.py` (timer endpoints)

---

# task_time_logs

## Purpose

Per-user, per-task, per-date accumulated seconds (task timer and manual logging).

## Primary Key

`id` (`SERIAL` / autoincrement)

## Columns

| Column | Unique constraint |
|--------|-------------------|
| `task_id` | FK → `tasks.id` CASCADE |
| `user_id` | FK → `users.id` |
| `log_date` | `YYYY-MM-DD` |
| `seconds` | |

**Unique:** `(task_id, log_date, user_id)` — `uq_task_time_user_date`

**Index:** `ix_task_time_logs_user_id`

## How the application uses this table

Source of truth for task time; upsert increments seconds; drives `tasks.time_tracked` aggregate.

## Files that read this table

`backend/crud/timelog.py`, `backend/logic/timer_logic.py`, `backend/logic/timesheet_logic.py`, `backend/logic/daily_summary_logic.py`

## Files that write this table

`backend/crud/timelog.py`, `backend/crud/admin.py` (merge on user delete)

---

# kanban_columns

## Purpose

Configurable board columns (id + label + order). Task `status` stores column **id**.

## Primary Key

`id` (`VARCHAR`) — e.g. `backlog`, `in_progress`, `testing`, `in_review`, `done`

## Columns

| Column | Notes |
|--------|-------|
| `label` | Display name |
| `position` | Column order |

## Foreign Keys

None (referenced logically by `tasks.status`).

## How the application uses this table

Seeded on first boot (`init_db._seed_kanban`). Managers can add/rename/reorder/delete columns (`kanban_logic`); protected base ids cannot be deleted.

## Files that read this table

`backend/crud/kanban.py`, `backend/logic/kanban_logic.py`

## Files that write this table

`backend/crud/kanban.py`, `backend/database/init_db.py` (seed INSERT)

**Routes:** `backend/routes/kanban.py`

**Status:** Actively used (not unused).

---

# timesheet_submissions

## Purpose

Weekly timesheet approval workflow — one row per (`user_id`, `week_start`) when submitted.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Notes |
|--------|-------|
| `user_id` | FK → `users.id` CASCADE |
| `week_start` | Monday `YYYY-MM-DD` |
| `status` | `submitted` \| `approved` \| `rejected` |
| `submitted_at` | ISO datetime |
| `reviewer_id` | FK → `users.id` SET NULL (historical; listing uses `users.manager_id`) |
| `reviewed_at` | |
| `rejection_note` | TEXT |
| `submitted_dates` | TEXT JSON array of included work dates |

**Unique:** `(user_id, week_start)`

## How the application uses this table

Employee submits week (or subset of days); manager approves/rejects. Absence of row = draft week.

## Files that read this table

`backend/crud/timesheet_submissions.py`, `backend/logic/timesheet_logic.py`

## Files that write this table

`backend/crud/timesheet_submissions.py`, `backend/crud/admin.py` (reassign on user delete)

**Routes:** `backend/routes/timesheet.py`

---

# timesheet_entries

## Purpose

Manual per-day work log rows (project, section, time range, billable flag) — separate from `task_time_logs`.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | FK |
|--------|-----|
| `user_id` | → `users.id` |
| `work_date` | |
| `project_id` | → `projects.id` |
| `section_id` | → `sections.id` |
| `description` | TEXT |
| `time_from`, `time_to` | |
| `seconds` | |
| `billable` | BOOLEAN default true |
| `created_at` | |

**Indexes:** user_id, work_date, project_id; optional composite in `migration_add_indexes.sql`

## How the application uses this table

Timesheet UI CRUD; manager team reports; timer stop may create entries via `timesheet_logic`.

## Files that read this table

`backend/crud/timesheet_entries.py`, `backend/logic/timesheet_logic.py`, `backend/logic/analytics_logic.py`, `backend/logic/daily_summary_logic.py`

## Files that write this table

`backend/crud/timesheet_entries.py`, `backend/crud/projects.py` (delete by project), `backend/crud/admin.py`

---

# task_feedback

## Purpose

Comment thread on tasks (feedback / discussion).

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | FK |
|--------|-----|
| `task_id` | → `tasks.id` CASCADE |
| `user_id` | → `users.id` |
| `message` | TEXT |
| `created_at`, `updated_at` | |

**Index:** `ix_task_feedback_task_id`

## How the application uses this table

CRUD on `/tasks/{id}/feedback`; triggers notifications and audit on create.

## Files that read this table

`backend/crud/task_feedback.py`, `backend/logic/task_feedback_logic.py`

## Files that write this table

`backend/crud/task_feedback.py`

**Routes:** `backend/routes/tasks.py`

---

# task_checklists

## Purpose

Checklist items subordinate to a task.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Notes |
|--------|-------|
| `task_id` | FK CASCADE |
| `title`, `priority` | |
| `is_done` | BOOLEAN |
| `position` | |
| `created_by` | FK → `users.id` |
| `created_at` | |

## Files that read/write

`backend/crud/checklists.py`, `backend/logic/checklist_logic.py`

**Routes:** `backend/routes/checklists.py`

---

# task_attachments

## Purpose

File metadata for uploads stored on disk (`stored_name`); binary not in DB.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Notes |
|--------|-------|
| `task_id` | FK CASCADE |
| `filename` | Original name |
| `stored_name` | UUID on filesystem |
| `content_type`, `size_bytes` | |
| `uploaded_by` | FK → `users.id` |
| `created_at` | |

## Files that read/write

`backend/crud/attachments.py`, `backend/logic/attachment_logic.py`

**Routes:** `backend/routes/attachments.py`

---

# audit_logs

## Purpose

Append-only activity log (7-day retention purge on read/init).

## Primary Key

`id` (`SERIAL`)

## Columns

| Column | Notes |
|--------|-------|
| `user_id` | FK → `users.id` |
| `action` | e.g. `task.created`, `mom.updated` |
| `entity_type` | `task`, `project`, `scrum`, … |
| `entity_id` | |
| `entity_name` | Display snapshot |
| `details` | JSON text |
| `created_at` | |

**Index:** `ix_audit_logs_user_id`

## How the application uses this table

`log_audit()` called from task, project, timesheet, meeting notes, checklist, attachment, teams import flows. Managers see all; employees see own.

## Files that read this table

`backend/crud/audit.py`, `backend/logic/audit.py`

## Files that write this table

`backend/crud/audit.py` (INSERT, DELETE purge), `backend/logic/audit.py`

**Routes:** `backend/routes/audit.py`

---

# notifications

## Purpose

In-app notification inbox per user.

## Primary Key

`id` (`SERIAL`)

## Columns

| Column | Notes |
|--------|-------|
| `user_id` | Recipient; FK → `users.id` |
| `type` | `task_assigned`, `task_commented`, … |
| `title`, `message` | |
| `entity_type`, `entity_id` | Polymorphic pointer |
| `is_read` | BOOLEAN |
| `triggered_by` | FK → `users.id` |
| `created_at` | |

## How the application uses this table

Created by `notification_logic` from task/timesheet/feedback events; listed and marked read via API.

## Files that read this table

`backend/crud/notifications.py`, `backend/logic/notification_logic.py`

## Files that write this table

`backend/crud/notifications.py`

**Routes:** `backend/routes/notifications.py`

---

# oauth_clients

## Purpose

Persisted MCP OAuth dynamically registered clients (JSON blob).

## Primary Key

`client_id` (`VARCHAR`)

## Columns

| Column | Notes |
|--------|-------|
| `data` | TEXT — serialized `OAuthClientInformationFull` |
| `created_at` | |

## Foreign Keys

None. `oauth_grants.client_id` references logically but **no DB FK**.

## Files that read/write

`backend/crud/oauth.py`, `backend/oauth_provider.py`

**Routes:** OAuth DCR via `oauth_well_known` / `oauth_consent` flow

---

# oauth_grants

## Purpose

Short-lived OAuth state: pending auth requests, authorization codes, refresh tokens.

## Primary Key

`key` (`VARCHAR`) — request id, code, or refresh token value

## Columns

| Column | Notes |
|--------|-------|
| `kind` | `pending` \| `code` \| `refresh` |
| `client_id` | **No FK** to `oauth_clients` |
| `user_id` | **No FK** to `users` (may be empty during pending) |
| `data` | JSON payload |
| `expires_at` | FLOAT unix expiry |

## Files that read/write

`backend/crud/oauth.py`, `backend/oauth_provider.py`

---

# personal_access_tokens

## Purpose

Long-lived revocable tokens for MCP / API (`zet_pat_…`); only SHA-256 hash stored.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Notes |
|--------|-------|
| `user_id` | FK → `users.id` CASCADE |
| `name` | Label |
| `token_hash` | UNIQUE |
| `prefix` | Display prefix |
| `created_at`, `last_used_at` | |
| `revoked` | BOOLEAN |

**Indexes:** `user_id`, unique `token_hash`

## Files that read/write

`backend/crud/access_tokens.py`, `backend/logic/token_logic.py`, `backend/oauth_provider.py` (issues PAT as access token)

**Routes:** `backend/routes/tokens.py`, Settings → Developer in frontend

---

# scrums

## Purpose

Meeting notes / MOM (minutes of meeting) — many per calendar day; stores raw text + AI-parsed JSON.

## Primary Key

`id` (`VARCHAR`)

## Columns

| Column | Notes |
|--------|-------|
| `work_date` | `YYYY-MM-DD` (not unique) |
| `title` | |
| `position` | Order within day |
| `raw_text` | Pasted or imported transcript |
| `parsed_json` | AI output JSON |
| `parse_status` | `empty` \| `ok` \| `failed` |
| `updated_by` | FK → `users.id` nullable |
| `updated_at`, `created_at` | |

**Index:** `ix_scrums_work_date`

## Referenced By

`teams_transcript_imports.scrum_id`

## Files that read/write

`backend/crud/meeting_notes.py`, `backend/logic/meeting_notes_logic.py`, `backend/logic/teams_logic.py` (creates via meeting flow)

**Routes:** `backend/routes/meeting_notes.py`, `backend/routes/integrations_teams.py`

---

# teams_transcript_imports

## Purpose

Idempotency ledger for Microsoft Teams transcript → scrum imports (dedup by Graph `transcript_id`).

## Primary Key

`transcript_id` (`VARCHAR`)

## Columns

| Column | FK |
|--------|-----|
| `meeting_id` | |
| `scrum_id` | → `scrums.id` SET NULL |
| `imported_by` | → `users.id` |
| `imported_at` | |

## Relationship

```
teams_transcript_imports.scrum_id → scrums.id
```

Purpose: link import record to created MOM row.

Used by: `backend/crud/teams.py`, `backend/logic/teams_logic.py`

## Files that read/write

`backend/crud/teams.py` (read check + INSERT only)

---

# Experimental / non-production tables

## zet_wrapper_demo

**Status:** UNUSED in product — created at runtime by `wrapper_test_logic`.

**Recommendation:** Exclude from production ERD; do not deploy wrapper-test routes in production.

## test

**Status:** UNUSED in product — ad-hoc table in `wrapper_test_logic`.

**Recommendation:** Exclude from production.

---

# Cross-cutting schema issues

## Missing foreign keys

| From | To | Issue |
|------|-----|-------|
| `tasks.status` | `kanban_columns.id` | Logical only; orphan statuses possible if column deleted outside app |
| `oauth_grants.client_id` | `oauth_clients.client_id` | No DB constraint |
| `oauth_grants.user_id` | `users.id` | No DB constraint |

## Broken / risky relationships

| Issue | Detail |
|-------|--------|
| Project delete | `projects.client_id` has no `ON DELETE` in bootstrap; deleting client with projects may fail |
| `skills` tables absent from bootstrap | Aurora `bootstrap_aurora.sql` alone is incomplete; `init_db()` must run |
| `task_skills` read without write | Forecast may always fall back to inferred skills |

## Redundant / duplicated data

| Location | Duplicates | Mitigation in code |
|----------|------------|-------------------|
| `tasks.assigned_to` | First assignee in `task_assignees` | `task_logic` keeps in sync |
| `tasks.time_tracked` | SUM(`task_time_logs.seconds`) | `timelog_crud` recomputes on change |

## Potential normalization issues

| Topic | Notes |
|-------|-------|
| ISO date/time as VARCHAR | `due_date`, `work_date`, `week_start`, timestamps — compared as strings |
| JSON in TEXT columns | `tags_json`, `custom_fields_json`, `parsed_json`, `submitted_dates`, `oauth` blobs |
| Polymorphic notifications | `entity_type` + `entity_id` without FK |
| Polymorphic audit | Same pattern |

## Unused columns (low or no read in CRUD)

Unable to verify strict "never read" for every column without exhaustive UI audit. Columns with **limited** dedicated use:

| Column | Notes |
|--------|-------|
| `tasks.custom_fields_json` | Stored on create/update; dedicated query usage not found in `crud/` beyond full row SELECT |
| `timesheet_submissions.reviewer_id` | Stored but manager routing prefers `users.manager_id` in `list_for_reviewer` |

## Dead tables

| Table | Verdict |
|-------|---------|
| `task_skills` | Effectively dead for writes — treat as partial |
| `zet_wrapper_demo`, `test` | Dev-only |

---

# Production Database Summary

## Tables actively used (24)

`users`, `app_settings`, `clients`, `skills`, `user_skills`, `projects`, `project_members`, `sections`, `tasks`, `task_assignees`, `task_timer_runs`, `task_time_logs`, `kanban_columns`, `timesheet_submissions`, `timesheet_entries`, `task_feedback`, `task_checklists`, `task_attachments`, `audit_logs`, `notifications`, `oauth_clients`, `oauth_grants`, `personal_access_tokens`, `scrums`, `teams_transcript_imports`

## Tables never / barely used

| Table | Verdict |
|-------|---------|
| `task_skills` | Read-only path exists; **no application writes** |
| `zet_wrapper_demo` | Wrapper test only |
| `test` | Wrapper test only |

## Core business entities

`users`, `clients`, `projects`, `project_members`, `sections`, `tasks`, `task_assignees`, `skills`, `user_skills`

## Authentication entities

`users` (credentials), `personal_access_tokens`, `oauth_clients`, `oauth_grants`, `app_settings` (admin password hash)

## Time tracking entities

`task_timer_runs`, `task_time_logs`, `tasks.time_tracked` (aggregate), `timesheet_entries`, `timesheet_submissions`

## AI entities

**No dedicated AI tables.** AI reads `tasks`, `users`, analytics queries via `backend/ai/` and `logic/insight_logic.py`, `logic/task_forecast_logic.py`, `logic/meeting_notes_logic.py` (LLM parses into `scrums.parsed_json`).

## Meeting entities

`scrums`, `teams_transcript_imports`

## Audit entities

`audit_logs`

## Notification entities

`notifications`

## Kanban / workflow

`kanban_columns` + `tasks.status` (logical FK)

---

# Recommended Production ERD

Include these **24 tables** (solid read/write paths):

1. `users`
2. `clients`
3. `projects`
4. `project_members`
5. `sections`
6. `tasks`
7. `task_assignees`
8. `task_feedback`
9. `task_checklists`
10. `task_attachments`
11. `kanban_columns` *(draw dashed/logical link from `tasks.status`)*
12. `task_timer_runs`
13. `task_time_logs`
14. `timesheet_entries`
15. `timesheet_submissions`
16. `skills`
17. `user_skills`
18. `scrums`
19. `teams_transcript_imports`
20. `notifications`
21. `audit_logs`
22. `personal_access_tokens`
23. `oauth_clients`
24. `oauth_grants`

### Optional on ERD (supporting, not core domain)

- `app_settings` — if showing Clockify/admin/timer config

### Exclude from production ERD

| Exclude | Reason |
|---------|--------|
| `task_skills` | No write path in application |
| `zet_wrapper_demo` | Experimental wrapper test |
| `test` | Experimental wrapper test |

### Suggested ERD annotations

- Mark `tasks.status` → `kanban_columns.id` as **logical** (no DB FK).
- Mark `tasks.assigned_to` as **denormalized primary assignee** (mirror of `task_assignees[0]`).
- Mark `tasks.time_tracked` as **cached aggregate** of `task_time_logs`.
- Group OAuth: `oauth_clients` + `oauth_grants` + `personal_access_tokens` → `users`.

---

# Appendix: DB access layer

## `backend/db_wrapper/`

| Module | Role |
|--------|------|
| `wrapper.py` | `DatabaseWrapper.read()` / `write()` / `transaction()` |
| `pool.py` | Aurora connection pools (IAM auth via `iam_token_manager.py`) |
| `sqlite_pool.py` | Test SQLite when `ZET_TEST_SQLITE=1` |
| `dialect.py` | SQL placeholder adaptation |
| `loader.py` | Connector load for production |

All `crud/` modules accept `Db` (`DatabaseWrapper`) and execute parameterized SQL — **no ORM query API**.

## Initialization path

```
main.py startup → init_db()
  → bootstrap_aurora.sql (or sqlite)
  → _migrate_submitted_dates, _migrate_task_min_log_minutes, _migrate_clients, _migrate_skills
  → _seed_kanban
  → purge_old_audit_logs
```

---

*Generated from repository state. Where code paths were not found, sections state "Unable to verify from code."*
