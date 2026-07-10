# ZET Architecture — Presentation Summary

Simplified overview for technical presentations. Each section is one diagram plus a short script (~2 minutes).  
Full detail: [architecture.md](./architecture.md) · [erd.md](./erd.md)

---

## 1. Overall System Architecture

**What to say:** The browser runs a React app on port 8080. All API calls go through a thin client layer into FastAPI on port 8000. The backend follows a strict three-layer pattern: routes parse HTTP, logic holds business rules, and crud is the only layer that touches the database. AI and MCP run inside the same backend process. Optional services (Microsoft, Groq, Redis, Sentry) connect only where the code explicitly calls them.

```mermaid
flowchart TB
    subgraph UI["Frontend · port 8080"]
        P[Pages & Components]
        S[Zustand Store]
        A[api.ts / analyticsApi.ts]
        P --> S --> A
    end

    subgraph API["Backend · port 8000"]
        R[routes/]
        L[logic/]
        C[crud/]
        R --> L --> C
    end

    subgraph Extra["Embedded in backend"]
        AI[ai/ · Groq / Ollama]
        MCP[mcp_app · /mcp]
        RT[realtime · WebSocket]
    end

    subgraph Data["Storage"]
        DB[(SQLite / Aurora)]
        FS[Media & attachment files]
    end

  subgraph Ext["External · optional"]
        MS[Microsoft Entra / Graph]
        CK[Clockify]
    end

    A -->|"/api proxy"| R
    R --> AI
    MCP --> L
    C --> DB
    L --> FS
    L --> MS
    L --> CK
    RT -.->|optional Redis| DB
```

| Layer | Role |
|-------|------|
| **Frontend** | React + Zustand; JWT in `localStorage` |
| **routes/** | Auth, parse input, call one logic function |
| **logic/** | RBAC, validation, audit, notifications |
| **crud/** | All SQL — no queries elsewhere |
| **ai/** | LLM chat, parsing, insights |
| **/mcp** | OAuth/PAT tools for external agents |

---

## 2. Database Module Diagram

**What to say:** The database is not one flat schema — it groups into six domains. Identity covers users and tokens. Organization is clients, projects, sections, and skills. Work items are tasks and everything hung off a task. Time tracking splits task-level logs from manual timesheet rows and weekly submissions. Collaboration covers notifications, audit, and meeting notes. Auth tables support MCP OAuth. All access goes through `crud/` modules, one per domain.

```mermaid
flowchart TB
    subgraph Identity["Identity & users"]
        U[users]
        PAT[personal_access_tokens]
        AS[app_settings]
    end

    subgraph Org["Organization"]
        CL[clients]
        PR[projects]
        PM[project_members]
        SE[sections]
        SK[skills]
        US[user_skills]
        TS[task_skills]
    end

    subgraph Work["Work items"]
        TA[tasks]
        TAS[task_assignees]
        FB[task_feedback]
        CH[task_checklists]
        AT[task_attachments]
        KC[kanban_columns]
    end

    subgraph Time["Time tracking"]
        TTL[task_time_logs]
        TTR[task_timer_runs]
        TE[timesheet_entries]
        TSS[timesheet_submissions]
    end

    subgraph Collab["Collaboration"]
        NO[notifications]
        AU[audit_logs]
        SC[scrums]
        TI[teams_transcript_imports]
    end

    subgraph OAuth["MCP / OAuth"]
        OC[oauth_clients]
        OG[oauth_grants]
    end

    PR --> SE --> TA
    PR --> PM --> U
    CL --> PR
    TA --> TAS --> U
    TA --> TTL & FB & CH & AT
    U --> TE & TSS & PAT
    SK --> US & TS
    SC --> TI
```

**27 tables total** · Source: `backend/database/models.py` + `task_skills` migration

---

## 3. Create Task Flow

**What to say:** A manager opens Create Task in the UI. The modal calls the Zustand store, which POSTs to `/tasks`. The route delegates to `task_logic.create_task_action`, which validates project membership and assignees, writes the task and assignee rows via crud, logs an audit entry, and notifies new assignees. The API returns a `TaskOut` object; the store updates and the kanban board re-renders the new card.

```mermaid
sequenceDiagram
    actor User as Manager
    participant UI as CreateTaskModal
    participant Store as appStore
    participant API as POST /tasks
    participant Logic as task_logic.create_task_action
    participant CRUD as crud/tasks · task_assignees
    participant DB as tasks · task_assignees
    participant Side as audit · notifications
    participant Board as DashboardPage / Kanban

    User->>UI: Fill title, project, assignees
    UI->>Store: createTask()
    Store->>API: TaskCreate JSON + Bearer JWT
    API->>Logic: create_task_action
    Logic->>Logic: Validate membership & assignees
    Logic->>CRUD: create_task + set_assignees
    CRUD->>DB: INSERT
    Logic->>Side: task.created audit · task_assigned notify
    Logic-->>API: TaskOut
    API-->>Store: JSON response
    Store->>Board: Update tasks state
    Board-->>User: New TaskCard visible
```

| Step | File / table |
|------|----------------|
| UI entry | `frontend/src/components/CreateTaskModal.tsx` |
| API client | `frontend/src/stores/appStore.ts` → `lib/api.ts` |
| Route | `backend/routes/tasks.py` |
| Business logic | `backend/logic/task_logic.py` |
| Persistence | `tasks`, `task_assignees` |
| Side effects | `audit_logs`, `notifications` |

---

## 4. Timesheet Flow

**What to say:** Timesheet has two time paths. Employees log work as manual rows in `timesheet_entries`, or time accumulates on tasks via timers into `task_time_logs`. Each week the employee submits; that creates a `timesheet_submissions` record and notifies their manager. The manager reviews entries, then approves or rejects. Locked weeks cannot be edited until reopened.

```mermaid
flowchart LR
    subgraph Employee
        TP[TimesheetPage]
    end

    subgraph Write["Log time"]
        E1[POST /timesheet/entries]
        E2[POST /tasks/id/timer/stop]
    end

    subgraph Logic["timesheet_logic · timer_logic"]
        L1[create_entry]
        L2[stop → task_time_logs]
    end

    subgraph Tables
        TE[(timesheet_entries)]
        TTL[(task_time_logs)]
        TS[(timesheet_submissions)]
    end

    subgraph Manager
        MP[TimesheetManagePanel]
        AP[approve / reject]
    end

    TP --> E1 --> L1 --> TE
    TP --> E2 --> L2 --> TTL
    L2 -.->|best-effort| TE

    TP -->|submit week| SUB[POST .../submit]
    SUB --> TS
    SUB -->|timesheet_submitted| N1[notification → manager]

    MP --> AP --> TS
    AP -->|approved / rejected| N2[notification → employee]
```

| Action | API | Tables updated |
|--------|-----|----------------|
| Add manual row | `POST /timesheet/entries` | `timesheet_entries` |
| Stop task timer | `POST /tasks/{id}/timer/stop` | `task_time_logs`, optionally `timesheet_entries` |
| Submit week | `POST /timesheet/submissions/{week}/submit` | `timesheet_submissions` |
| Manager approve | `POST .../submissions/{id}/approve` | `timesheet_submissions` |

**UI:** `TimesheetPage.tsx` (employee) · `TimesheetManagePanel.tsx` (manager)

---

## 5. AI Recommendation Flow

**What to say:** Recommendations are two-stage. First, a deterministic engine in `task_forecast_logic` scores employees by skill match and availability — no LLM. Managers call `/analytics/forecast` or `/analytics/smart-reassignment` from the Forecast page. Second, optional LLM narration via `POST /insights/generate` turns the numbers into plain-language advice using Groq or Ollama. Employees cannot access these endpoints.

```mermaid
flowchart TB
    subgraph UI["Manager UI"]
        FP[ForecastPanel]
        WW[WhatWillHappenNextPage]
        RC[RecommendationScoreCard]
        IP[AIInsightsPanel]
    end

    subgraph Rule["Rule-based engine · no LLM"]
        API1[GET /analytics/forecast]
        API2[GET /analytics/smart-reassignment]
        TF[task_forecast_logic]
        SC[Score: 50% skills + 50% availability]
    end

    subgraph LLM["Optional narration"]
        API3[POST /insights/generate]
        IL[insight_logic]
        SVC[ai/service · Groq / Ollama]
    end

    subgraph Read["Data read via crud"]
        D[(users · tasks · task_assignees<br/>skills · user_skills · task_skills)]
    end

    WW --> FP --> RC
    FP --> API1 & API2
    API1 & API2 --> TF --> SC
    TF --> D
    SC -->|recommendations[]| RC

    FP --> IP
    IP --> API3 --> IL --> SVC
    IL -->|InsightsResponse| IP
```

| Output | Endpoint | Content |
|--------|----------|---------|
| Deadline forecast | `GET /analytics/forecast` | Risk labels, workload, reassignments |
| Smart reassignment | `GET /analytics/smart-reassignment` | Ranked owner suggestions + why bullets |
| Plain-language insight | `POST /insights/generate` | `decision`, `why`, `evidence`, `recommendation` |

**Scopes used:** `deadline_forecast`, `smart_task_reassignment`  
**Access:** Manager/admin only — 403 for `employee` role

---

## Quick reference

```
UI → Store / api.ts → routes → logic → crud → Database
```

| Topic | Deep dive |
|-------|-----------|
| All flows & APIs | [architecture.md](./architecture.md) |
| Full ERD | [erd.md](./erd.md) / [erd.mmd](./erd.mmd) |
