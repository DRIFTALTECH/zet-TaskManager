# Clockify → ZET Field-Level Mapping (One-to-One)

Every variable read or written by `clockify-importer`, with **complete format examples**.

**Direction:** Clockify API → ZET database only (import).  
**Companion:** [zetToClock.md](./zetToClock.md) (architecture + tables).

![Field-level mapping cheat sheet](./clockify-zet-field-mapping.png)

---

## Format legend

| Label | Meaning | Example pattern |
|-------|---------|-----------------|
| **CK-UUID** | Clockify string id | `64f1a2b3c4d5e6f7a8b9c0d1` |
| **CK-ISO** | Clockify UTC datetime | `2026-07-10T09:15:23Z` or `2026-07-10T09:15:23.000Z` |
| **ZET-VARCHAR** | Postgres/SQLite VARCHAR | any string |
| **ZET-DATE** | Stored as VARCHAR, not DATE type | `2026-07-10` |
| **ZET-TIME** | HH:MM 24h UTC wall clock | `09:15` |
| **ZET-ISO** | Full UTC ISO string in DB | `2026-07-10T06:00:00.123456+00:00` |
| **ZET-UUID** | Standard UUID v4 string | `550e8400-e29b-41d4-a716-446655440000` |
| **ZET-PREFIX-ID** | `new_id(prefix)` | `p1a2b3c4d5e`, `s6f7g8h9i0j`, `c9k8l7m6n5o` |
| **ZET-CLK-ID** | Sanitized Clockify id + prefix | `clk_64f1a2b3c4d5e6f7a8b9c0d1` |

**Sanitization rule (all Clockify ids used as ZET PKs):**

```text
re.sub(r'[^a-zA-Z0-9_-]', '', str(raw))
```

Example: `"entry/abc?123"` → `"entryabc123"` → ZET id `clk_entryabc123`

---

## 1. Workspace members / users API

`GET /workspaces/{wsId}/members` (fallback: `/users`)

### 1.1 Clockify → ZET (read from API)

| # | Clockify path | CK type | CK format | CK example (complete) | ZET target | ZET SQL type | ZET format | ZET example (complete) | Stored? |
|---|---------------|---------|-----------|----------------------|------------|--------------|------------|------------------------|---------|
| 1 | `id` | string | CK-UUID | `"5fc6a0b5b8b4a123456789ab"` | *(runtime map key)* | — | — | `ck_user_email["5fc6a0b5b8b4a123456789ab"]` | No |
| 2 | `userId` | string | CK-UUID | `"5fc6a0b5b8b4a123456789ab"` | same as `id` | — | — | fallback if `id` absent | No |
| 3 | `email` | string | email | `"Jane.Doe@Example.COM"` | `users.email` | VARCHAR UNIQUE | lowercase email | `"jane.doe@example.com"` | Yes |
| 4 | `user.email` | string | email | `"bob@example.com"` | `users.email` | VARCHAR | lowercase | `"bob@example.com"` | Yes (if top-level `email` missing) |
| 5 | `name` | string | plain text | `"Jane Doe"` | `users.name` | VARCHAR | trimmed text | `"Jane Doe"` | Yes (create only) |

### 1.2 Importer-generated user fields (no Clockify source)

| # | Source | ZET target | ZET SQL type | ZET format | ZET example (complete) | When |
|---|--------|------------|--------------|------------|------------------------|------|
| 6 | `uuid.uuid4()` | `users.id` | VARCHAR PK | ZET-UUID | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` | New user only |
| 7 | `hash_password(token)` | `users.password_hash` | VARCHAR | bcrypt hash | `"$2b$12$K3x…truncated…"` | New user only |
| 8 | constant | `users.role` | VARCHAR | literal | `"employee"` | New user only |
| 9 | `create_user` default | `users.avatar` | VARCHAR | empty | `""` | New user only |
| 10 | `create_user` default | `users.job_title` | VARCHAR | empty | `""` | New user only |
| 11 | `create_user` default | `users.experience_months` | INTEGER | zero | `0` | New user only |
| 12 | `datetime.now(UTC).isoformat()` | `users.joined_at` | VARCHAR | ZET-ISO | `"2026-07-10T06:00:00.123456+00:00"` | New user only |

### 1.3 Complete member example

**Clockify input (one array element):**

```json
{
  "id": "5fc6a0b5b8b4a123456789ab",
  "email": "Jane.Doe@Example.COM",
  "name": "Jane Doe"
}
```

**ZET output — existing user matched by email:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "role": "manager"
}
```

*(Only `email` used for match; existing row unchanged.)*

**ZET output — new user created:**

```json
{
  "id": "a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32",
  "name": "Jane Doe",
  "email": "jane.doe@example.com",
  "password_hash": "$2b$12$…",
  "role": "employee",
  "avatar": "",
  "job_title": "",
  "experience_months": 0,
  "joined_at": "2026-07-10T06:00:00.123456+00:00"
}
```

---

## 2. Projects API

`GET /workspaces/{wsId}/projects?page=1&page-size=200`

### 2.1 Clockify → ZET

| # | Clockify path | CK type | CK format | CK example (complete) | ZET target | ZET SQL type | ZET format | ZET example (complete) | Stored? |
|---|---------------|---------|-----------|----------------------|------------|--------------|------------|------------------------|---------|
| 1 | `id` | string | CK-UUID | `"64a1b2c3d4e5f6789012345"` | `ck_id_to_zet` cache | — | tuple | `("pa1b2c3d4e5", "sa6b7c8d9e0")` | No (runtime only) |
| 2 | `name` | string | plain text | `"  Website Redesign  "` | `projects.name` | VARCHAR | stripped | `"Website Redesign"` | Yes |
| 3 | `name` (lowercase) | string | match key | `"website redesign"` | lookup key | — | — | matches existing ZET project | No |
| 4 | `clientName` | string | plain text | `"Acme Corp"` | `clients.name` | VARCHAR | stripped | `"Acme Corp"` | Yes (via client) |
| 5 | `clientName` | string | plain text | `"Acme Corp"` | `projects.client_id` | VARCHAR FK nullable | ZET-PREFIX-ID | `"ca1b2c3d4e5"` | Yes |

### 2.2 Importer-generated project + section fields

| # | Source | ZET target | ZET SQL type | ZET format | ZET example (complete) |
|---|--------|------------|--------------|------------|------------------------|
| 6 | `new_id("p")` | `projects.id` | VARCHAR PK | `p` + 10 hex | `"pa1b2c3d4e5"` |
| 7 | constant | `projects.description` | VARCHAR | literal | `"Imported from Clockify"` |
| 8 | `_default_owner_id()` | `projects.created_by` | VARCHAR FK | ZET-UUID | `"550e8400-e29b-41d4-a716-446655440000"` |
| 9 | `_now_iso()` | `projects.created_at` | VARCHAR | ZET-ISO | `"2026-07-10T06:00:00.123456+00:00"` |
| 10 | `new_id("s")` | `sections.id` | VARCHAR PK | `s` + 10 hex | `"sa6b7c8d9e0"` |
| 11 | constant | `sections.name` | VARCHAR | literal | `"General"` |
| 12 | new project id | `sections.project_id` | VARCHAR FK | ZET-PREFIX-ID | `"pa1b2c3d4e5"` |
| 13 | `new_id("c")` | `clients.id` | VARCHAR PK | `c` + 10 hex | `"ca1b2c3d4e5"` |
| 14 | `_now_iso()` | `clients.created_at` | VARCHAR | ZET-ISO | `"2026-07-10T06:00:00.123456+00:00"` |

### 2.3 Complete project example

**Clockify input:**

```json
{
  "id": "64a1b2c3d4e5f6789012345",
  "name": "Website Redesign",
  "clientName": "Acme Corp"
}
```

**ZET output (new project path):**

```json
{
  "clients": {
    "id": "ca1b2c3d4e5",
    "name": "Acme Corp",
    "created_at": "2026-07-10T06:00:00.123456+00:00"
  },
  "projects": {
    "id": "pa1b2c3d4e5",
    "name": "Website Redesign",
    "description": "Imported from Clockify",
    "client_id": "ca1b2c3d4e5",
    "created_by": "550e8400-e29b-41d4-a716-446655440000",
    "created_at": "2026-07-10T06:00:00.123456+00:00"
  },
  "sections": {
    "id": "sa6b7c8d9e0",
    "name": "General",
    "project_id": "pa1b2c3d4e5"
  }
}
```

---

## 3. Tasks API (catalog tasks)

`GET /workspaces/{wsId}/projects/{projectId}/tasks`

### 3.1 Clockify → ZET (`tasks` row)

| # | Clockify path | CK type | CK format | CK example (complete) | ZET target | ZET SQL type | ZET format | ZET example (complete) |
|---|---------------|---------|-----------|----------------------|------------|--------------|------------|------------------------|
| 1 | `id` | string | any string | `"task-uuid/abc123"` | `tasks.id` | VARCHAR PK | `clk_task_{safe}` | `"clk_task_task-uuidabc123"` |
| 2 | `name` | string | plain text | `"Implement login page"` | `tasks.title` | VARCHAR | max 200 chars | `"Implement login page"` |
| 3 | *(none)* | — | — | — | `tasks.description` | VARCHAR | constant | `"Imported from Clockify"` |
| 4 | parent resolve | — | — | — | `tasks.project_id` | VARCHAR FK | ZET-PREFIX-ID | `"pa1b2c3d4e5"` |
| 5 | parent resolve | — | — | — | `tasks.section_id` | VARCHAR FK | ZET-PREFIX-ID | `"sa6b7c8d9e0"` |
| 6 | `assigneeId` | string | CK-UUID | `"5fc6a0b5b8b4a123456789ab"` | `tasks.assigned_to` | VARCHAR FK | ZET-UUID | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |
| 7 | `_default_owner_id()` | — | — | — | `tasks.assigned_by` | VARCHAR FK | ZET-UUID | `"550e8400-e29b-41d4-a716-446655440000"` |
| 8 | `_default_owner_id()` | — | — | — | `tasks.created_by` | VARCHAR FK | ZET-UUID | `"550e8400-e29b-41d4-a716-446655440000"` |
| 9 | `dueDate` | string | CK-ISO | `"2026-08-15T00:00:00.000Z"` | `tasks.due_date` | VARCHAR | ZET-DATE | `"2026-08-15"` |
| 9b | `due_date` | string | CK-ISO | `"2026-08-15"` | `tasks.due_date` | VARCHAR | ZET-DATE | `"2026-08-15"` |
| 10 | *(missing due)* | — | — | — | `tasks.due_date` | VARCHAR | empty | `""` |
| 11 | constant | — | — | — | `tasks.priority` | VARCHAR | literal | `"Medium"` |
| 12 | `status` | string | enum | `"ACTIVE"` | `tasks.status` | VARCHAR | mapped | `"in_progress"` |
| 12b | `status` | string | enum | `"DONE"` | `tasks.status` | VARCHAR | mapped | `"completed"` |
| 12c | `status` | string | any/other | `"TODO"` | `tasks.status` | VARCHAR | default | `"backlog"` |
| 13 | constant | — | — | — | `tasks.is_started` | BOOLEAN | false | `false` |
| 14 | constant | — | — | — | `tasks.started_at` | VARCHAR | null | `null` |
| 15 | constant | — | — | — | `tasks.completed_at` | VARCHAR | null | `null` |
| 16 | constant | — | — | — | `tasks.approved_by_manager` | BOOLEAN | false | `false` |
| 17 | constant | — | — | — | `tasks.time_tracked` | INTEGER | zero | `0` |
| 18 | constant | — | — | — | `tasks.min_log_minutes` | INTEGER | default | `1` |
| 19 | constant | — | — | — | `tasks.tags_json` | TEXT | JSON array | `"[]"` |
| 20 | constant | — | — | — | `tasks.custom_fields_json` | TEXT | JSON object | `"{}"` |
| 21 | `_now_iso()` | — | — | — | `tasks.created_at` | VARCHAR | ZET-ISO | `"2026-07-10T06:00:00.123456+00:00"` |

### 3.2 Related rows (`task_assignees`, `project_members`)

| # | Clockify path | ZET target | ZET SQL type | ZET example (complete) |
|---|---------------|------------|--------------|------------------------|
| 22 | `id` → safe | `task_assignees.task_id` | VARCHAR PK part | `"clk_task_task-uuidabc123"` |
| 23 | resolved assignee | `task_assignees.user_id` | VARCHAR PK part | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |
| 24 | constant `0` | `task_assignees.position` | INTEGER | `0` |
| 25 | parent project | `project_members.project_id` | VARCHAR PK part | `"pa1b2c3d4e5"` |
| 26 | assignee | `project_members.user_id` | VARCHAR PK part | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |

### 3.3 Complete catalog task example

**Clockify input:**

```json
{
  "id": "task-uuid-abc123",
  "name": "Implement login page",
  "assigneeId": "5fc6a0b5b8b4a123456789ab",
  "dueDate": "2026-08-15T00:00:00.000Z",
  "status": "ACTIVE"
}
```

**ZET `tasks` row:**

```json
{
  "id": "clk_task_task-uuid-abc123",
  "title": "Implement login page",
  "description": "Imported from Clockify",
  "project_id": "pa1b2c3d4e5",
  "section_id": "sa6b7c8d9e0",
  "assigned_to": "a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32",
  "assigned_by": "550e8400-e29b-41d4-a716-446655440000",
  "created_by": "550e8400-e29b-41d4-a716-446655440000",
  "due_date": "2026-08-15",
  "priority": "Medium",
  "status": "in_progress",
  "is_started": false,
  "started_at": null,
  "completed_at": null,
  "approved_by_manager": false,
  "time_tracked": 0,
  "min_log_minutes": 1,
  "tags_json": "[]",
  "custom_fields_json": "{}",
  "created_at": "2026-07-10T06:00:00.123456+00:00"
}
```

---

## 4. Time entries API (primary import)

`GET /workspaces/{wsId}/user/{userId}/time-entries?start=…&end=…`

Outer loop provides **Clockify user id** → ZET `user_id` via email (not from entry JSON).

### 4.1 Clockify → ZET (`timesheet_entries`)

| # | Clockify path | CK type | CK format | CK example (complete) | ZET target | ZET SQL type | ZET format | ZET example (complete) |
|---|---------------|---------|-----------|----------------------|------------|--------------|------------|------------------------|
| 1 | `id` | string | CK-UUID | `"64f1a2b3c4d5e6f7a8b9c0d1"` | `timesheet_entries.id` | VARCHAR PK | `clk_{safe}` | `"clk_64f1a2b3c4d5e6f7a8b9c0d1"` |
| 1b | `_id` | string | CK-UUID | `"64f1a2b3c4d5e6f7a8b9c0d1"` | same as `id` | VARCHAR PK | fallback | same |
| 2 | member loop email | — | — | — | `timesheet_entries.user_id` | VARCHAR FK | ZET-UUID | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |
| 3 | `timeInterval.start` | string | CK-ISO | `"2026-07-10T09:15:23Z"` | `timesheet_entries.work_date` | VARCHAR | ZET-DATE | `"2026-07-10"` |
| 4 | `projectId` | string | CK-UUID | `"64a1b2c3d4e5f6789012345"` | `timesheet_entries.project_id` | VARCHAR FK | ZET-PREFIX-ID | `"pa1b2c3d4e5"` |
| 5 | `projectId` resolve | — | — | — | `timesheet_entries.section_id` | VARCHAR FK | ZET-PREFIX-ID | `"sa6b7c8d9e0"` |
| 6 | `description` | string | plain text | `"  Sprint planning  "` | `timesheet_entries.description` | TEXT | stripped | `"Sprint planning"` |
| 7 | `timeInterval.start` | string | CK-ISO | `"2026-07-10T09:15:23Z"` | `timesheet_entries.time_from` | VARCHAR | ZET-TIME | `"09:15"` |
| 8 | `timeInterval.end` | string | CK-ISO | `"2026-07-10T11:00:00Z"` | `timesheet_entries.time_to` | VARCHAR | ZET-TIME | `"11:00"` |
| 9 | `timeInterval.duration` | number | seconds int | `6300` | `timesheet_entries.seconds` | INTEGER | seconds ≥ 0 | `6300` |
| 9b | `timeInterval.duration` | string | digit string | `"6300"` | `timesheet_entries.seconds` | INTEGER | parsed int | `6300` |
| 9c | start+end only | — | computed | — | `timesheet_entries.seconds` | INTEGER | `(end-start).total_seconds()` | `6300` |
| 10 | `billable` | boolean | true/false | `true` | `timesheet_entries.billable` | BOOLEAN | bool | `true` |
| 10b | *(absent)* | — | — | — | `timesheet_entries.billable` | BOOLEAN | default true | `true` |
| 11 | `_now_iso()` | — | — | — | `timesheet_entries.created_at` | VARCHAR | ZET-ISO | `"2026-07-10T06:00:00.123456+00:00"` |

### 4.2 Side effect: `project_members`

| # | Clockify path | ZET target | ZET example (complete) |
|---|---------------|------------|------------------------|
| 12 | resolved `project_id` | `project_members.project_id` | `"pa1b2c3d4e5"` |
| 13 | ZET user | `project_members.user_id` | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |

### 4.3 Complete time entry → timesheet example

**Clockify input:**

```json
{
  "id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "description": "Sprint planning",
  "projectId": "64a1b2c3d4e5f6789012345",
  "billable": true,
  "timeInterval": {
    "start": "2026-07-10T09:15:23Z",
    "end": "2026-07-10T11:00:00Z",
    "duration": 6300
  }
}
```

**ZET `timesheet_entries` row:**

```json
{
  "id": "clk_64f1a2b3c4d5e6f7a8b9c0d1",
  "user_id": "a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32",
  "work_date": "2026-07-10",
  "project_id": "pa1b2c3d4e5",
  "section_id": "sa6b7c8d9e0",
  "description": "Sprint planning",
  "time_from": "09:15",
  "time_to": "11:00",
  "seconds": 6300,
  "billable": true,
  "created_at": "2026-07-10T06:00:00.123456+00:00"
}
```

**ZET API / frontend (`TimesheetWorkEntry`):**

```json
{
  "id": "clk_64f1a2b3c4d5e6f7a8b9c0d1",
  "userId": "a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32",
  "workDate": "2026-07-10",
  "projectId": "pa1b2c3d4e5",
  "sectionId": "sa6b7c8d9e0",
  "description": "Sprint planning",
  "timeFrom": "09:15",
  "timeTo": "11:00",
  "seconds": 6300,
  "billable": true,
  "createdAt": "2026-07-10T06:00:00.123456+00:00"
}
```

**UI display formats (same record):**

| Field | UI format | Example |
|-------|-----------|---------|
| `workDate` | `DD-MM-YYYY` | `10-07-2026` |
| `timeFrom` / `timeTo` | compact `HHMM` | `0915` – `1100` |
| `seconds` | duration text | `1h 45m` |

---

## 5. Time entry → mirror task (`clk_tentry_*`)

Same Clockify time entry also produces a **second** ZET `tasks` row (insert-only).

| # | Clockify path | CK example | ZET target | ZET SQL type | ZET example (complete) |
|---|---------------|------------|------------|--------------|------------------------|
| 1 | `id` / `_id` | `"64f1a2b3c4d5e6f7a8b9c0d1"` | `tasks.id` | VARCHAR PK | `"clk_tentry_64f1a2b3c4d5e6f7a8b9c0d1"` |
| 2 | `description` | `"Sprint planning"` | `tasks.title` | VARCHAR | `"Sprint planning"` |
| 2b | *(empty description)* | `""` | `tasks.title` | VARCHAR | `"Time log 2026-07-10"` |
| 3 | `description` | `"Sprint planning"` | `tasks.description` | VARCHAR | `"Sprint planning"` |
| 3b | *(empty)* | `""` | `tasks.description` | VARCHAR | `"Imported from Clockify time entry"` |
| 4 | project resolve | — | `tasks.project_id` | VARCHAR FK | `"pa1b2c3d4e5"` |
| 5 | project resolve | — | `tasks.section_id` | VARCHAR FK | `"sa6b7c8d9e0"` |
| 6 | ZET user | — | `tasks.assigned_to` | VARCHAR FK | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |
| 7 | owner | — | `tasks.assigned_by`, `created_by` | VARCHAR FK | `"550e8400-e29b-41d4-a716-446655440000"` |
| 8 | `timeInterval.start` → date | `"2026-07-10"` | `tasks.due_date` | VARCHAR | `"2026-07-10"` |
| 9 | constant | — | `tasks.priority` | VARCHAR | `"Medium"` |
| 10 | `seconds` > 0 | `6300` | `tasks.status` | VARCHAR | `"completed"` |
| 10b | `seconds` == 0 | `0` | `tasks.status` | VARCHAR | `"backlog"` |
| 11 | `seconds` | `6300` | `tasks.time_tracked` | INTEGER | `6300` |
| 12 | constants | — | `is_started`, `approved_by_manager`, `tags_json`, etc. | various | same as catalog task |
| 13 | `_now_iso()` | — | `tasks.created_at` | VARCHAR | `"2026-07-10T06:00:00.123456+00:00"` |
| 14 | ZET user | — | `task_assignees.user_id` | VARCHAR | `"a3f2c891-0b4e-4d2a-9f1c-8e7d6c5b4a32"` |
| 15 | mirror task id | — | `task_assignees.task_id` | VARCHAR | `"clk_tentry_64f1a2b3c4d5e6f7a8b9c0d1"` |

---

## 6. Sync metadata (`app_settings`)

| # | Source | ZET target | ZET SQL type | ZET format | ZET example (complete) |
|---|--------|------------|--------------|------------|------------------------|
| 1 | `_now_iso()` | `app_settings.key` = `clockify.last_sync` | VARCHAR PK | literal key | `"clockify.last_sync"` |
| 2 | `_now_iso()` | `app_settings.value` | TEXT | ZET-ISO | `"2026-07-10T06:00:00.123456+00:00"` |
| 3 | `json.dumps(result)` | `app_settings.key` = `clockify.last_status` | VARCHAR PK | literal key | `"clockify.last_status"` |
| 4 | sync result dict | `app_settings.value` | TEXT | JSON string | see below |

**`clockify.last_status` complete example:**

```json
{
  "status": "success",
  "imported": 42,
  "updated": 3,
  "unchanged": 1200,
  "skipped": 2,
  "failed": 0,
  "usersCreated": 1,
  "projectsCreated": 2,
  "tasksImported": 15,
  "days": 365,
  "skipSummary": {
    "Missing timestamps": 1,
    "Project not found": 1
  }
}
```

---

## 7. Clockify fields explicitly IGNORED

These may appear in Clockify JSON but are **never read** by the importer:

| Clockify path | Typical CK type | CK example | Why ignored |
|---------------|-----------------|------------|-------------|
| `time-entries.taskId` | string | `"task-uuid-abc123"` | No link to `clk_task_*` |
| `time-entries.tagIds` | array | `["tag1","tag2"]` | Tags not imported |
| `time-entries.userId` | string | CK-UUID | User from outer member loop |
| `time-entries.hourlyRate` | number | `85.0` | Rates not imported |
| `time-entries.costRate` | number | `50.0` | Rates not imported |
| `time-entries.billableRate` | number | `85.0` | Rates not imported |
| `time-entries.createdAt` | CK-ISO | `"2026-07-10T09:15:23Z"` | ZET uses sync-time `created_at` |
| `time-entries.updatedAt` | CK-ISO | `"2026-07-10T10:00:00Z"` | Not stored |
| `time-entries.customFieldValues` | array | `[{…}]` | Not imported |
| `time-entries.isLocked` | boolean | `false` | Not imported |
| `time-entries.type` | string | `"REGULAR"` | Not imported |
| `time-entries.kioskId` | string | CK-UUID | Not imported |
| `time-entries.workspaceId` | string | CK-UUID | Not imported |
| `projects.clientId` | string | CK-UUID | Only `clientName` used |
| `projects.archived` | boolean | `false` | Not imported |
| `projects.color` | string | `"#03A9F4"` | Not imported |
| `projects.billable` | boolean | `true` | Not imported |
| `tasks.estimate` | string/number | `"PT2H"` | Not imported |
| `tasks.billable` | boolean | `true` | Not imported |
| `members.status` | string | `"ACTIVE"` | Not imported |
| `members.hourlyRate` | number | `75.0` | Not imported |

---

## 8. Master one-to-one index (quick lookup)

| Clockify variable | → | ZET variable | ZET type |
|-------------------|---|--------------|----------|
| `members.id` | → | *(runtime only)* | — |
| `members.userId` | → | *(runtime only)* | — |
| `members.email` | → | `users.email` | VARCHAR |
| `members.user.email` | → | `users.email` | VARCHAR |
| `members.name` | → | `users.name` | VARCHAR |
| `projects.id` | → | *(runtime cache)* | — |
| `projects.name` | → | `projects.name` | VARCHAR |
| `projects.clientName` | → | `clients.name` + `projects.client_id` | VARCHAR |
| `tasks.id` | → | `tasks.id` (`clk_task_…`) | VARCHAR |
| `tasks.name` | → | `tasks.title` | VARCHAR |
| `tasks.assigneeId` | → | `tasks.assigned_to` | VARCHAR |
| `tasks.dueDate` / `due_date` | → | `tasks.due_date` | VARCHAR |
| `tasks.status` | → | `tasks.status` | VARCHAR |
| `time-entries.id` / `_id` | → | `timesheet_entries.id` (`clk_…`) | VARCHAR |
| `time-entries.description` | → | `timesheet_entries.description` | TEXT |
| `time-entries.projectId` | → | `timesheet_entries.project_id` + `section_id` | VARCHAR |
| `time-entries.billable` | → | `timesheet_entries.billable` | BOOLEAN |
| `time-entries.timeInterval.start` | → | `work_date` + `time_from` | VARCHAR |
| `time-entries.timeInterval.end` | → | `time_to` | VARCHAR |
| `time-entries.timeInterval.duration` | → | `seconds` | INTEGER |
| `time-entries.id` | → | `tasks.id` (`clk_tentry_…`) | VARCHAR (mirror) |
| `time-entries.description` | → | mirror `tasks.title` + `description` | VARCHAR |
| `seconds` (computed) | → | mirror `tasks.time_tracked` + `status` | INTEGER / VARCHAR |
| sync timestamp | → | `app_settings.clockify.last_sync` | TEXT |
| sync result | → | `app_settings.clockify.last_status` | TEXT (JSON) |

---

*Generated from `clockify-importer` source. See [zetToClock.md](./zetToClock.md) for architecture and upsert rules.*
