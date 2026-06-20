# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ZET** = full-stack task management app. React/TypeScript frontend, FastAPI/Python backend.

## Commands

### Frontend (`/frontend`)

```bash
npm run dev        # Start dev server on port 8080
npm run build      # Production build
npm run lint       # ESLint
npm run test       # Run tests once (Vitest)
npm run test:watch # Run tests in watch mode
```

### Backend (`/backend`)

```bash
pip install -r requirements.txt
uvicorn main:app --reload  # Start API server on port 8000
```

Frontend proxies `/api` to `http://127.0.0.1:8000`. `.env` in `/frontend` sets `VITE_API_URL=http://127.0.0.1:8000`.

### Microsoft sign-in (Entra / Azure AD)

1. In **Azure Portal** → App registrations → New registration → **Single-page application (SPA)**; note **Application (client) ID**.
2. **Authentication** → add **Single-page application** redirect URI matching app origin (e.g. `http://localhost:8080/` for local Vite). For **Microsoft sign-in on MCP OAuth consent page**, also register backend callback `http://localhost:8000/oauth/msal-callback` (and production equivalent) as SPA redirect URI.
3. Set **`MICROSOFT_CLIENT_ID`** on backend (same value as app client ID). Optional: **`VITE_MICROSOFT_TENANT_ID`** on frontend (defaults `common` for multi-tenant); use directory tenant ID for single-tenant only.
4. Frontend **`.env`**: `VITE_MICROSOFT_CLIENT_ID=<same client id>` (and optional tenant). **Log in / Sign up with Microsoft** buttons appear only when `VITE_MICROSOFT_CLIENT_ID` set.
5. API: `POST /auth/microsoft` with `{ id_token, remember_me?, role? }` — validates token via Microsoft JWKS, issues app JWT.

## Architecture

### Stack

- **Frontend**: React 18 + TypeScript, Vite, Zustand (state), TanStack Query, Shadcn/ui + Radix UI, Tailwind CSS, React Router 6, dnd-kit (drag-and-drop), React Hook Form + Zod
- **Backend**: FastAPI, SQLAlchemy 2.0, SQLite (`/backend/data/taskmanager.db`), PyJWT + Passlib (auth)

### Data Flow

```
UI → Zustand Store → API Client (lib/api.ts) → FastAPI Routes → Logic → CRUD → SQLite
```

All server state in Zustand (`frontend/src/stores/appStore.ts`). Store handles auth, projects, tasks, kanban columns, users, theme. On load, app restores session from JWT in localStorage.

### Backend Layers

```
routes/    → HTTP endpoint definitions only — parse input, call ONE logic function, return
logic/     → ALL business logic, validation, orchestration, audit, notifications, transaction boundaries
crud/      → EVERY SQLAlchemy / SQL query — no exceptions
database/  → ORM models and DB connection setup
main.py    → FastAPI app with CORS (all origins allowed)
```

## ⛔ ARCHITECTURE RULES — MANDATORY, NON-NEGOTIABLE

Project follows strict `routes → logic → crud` layering. Every change MUST obey:

1. **Every SQL/ORM query lives in `crud/` — and nowhere else.** Any `db.query(...)`,
   `db.get(...)`, `db.execute(text(...))`, `db.add(...)`, `db.delete(...)`, `.update(...)`,
   `.flush()`, raw SQL, or model read/write belongs in `crud/` function. `routes/` and
   `logic/` must NEVER contain these. Need data? Add or call `crud/` function.
2. **`routes/` only trigger logic.** Endpoint takes request input +
   `db`/`user_id` dependencies, calls exactly one `logic/` function, returns its
   result. No queries, no business rules, no audit calls, no notifications in routes.
   (Returning `FileResponse`/`Response` and reading `UploadFile` allowed — pure
   HTTP concerns.)
3. **`logic/` holds all business logic** — validation, permissions, orchestration, audit
   logging, notifications, transaction boundaries (`db.commit()` allowed in logic).
   Logic may construct model instances (not a query) but delegates all persistence to `crud/`.
4. **One CRUD module per table/domain** (e.g. `crud/tasks.py`, `crud/notifications.py`).
   Name functions for intent: `get_by_id`, `list_for_member`, `create`, `update`, `delete`.
5. **Filtering happens in SQL, not Python.** No fetch-everything-then-filter-in-loop —
   add filtered query to `crud/` (e.g. `projects.list_for_member`).

Adding feature: define query in `crud/`, rules in `logic/`, thin
endpoint in `routes/`. Catch yourself importing model or `text` into `routes/` or
`logic/` for query? Stop, move to `crud/`.

### Key Domain Concepts

- **Roles**: `admin`, `manager`, `employee`.
  - `admin` — full access to everything **plus** standalone `/admin` console; sees ALL projects and tasks. Admin role granted only from admin console.
  - `manager` — all in-app manager powers (create projects, assign members, approve, move any task) but **no** admin console; sees only projects they member of.
  - `employee` — own work only; cannot create projects or assign members; sees only projects they belong to.
- **Projects → Sections → Tasks**: Tasks belong to sections within projects
- **Multi-assignee tasks**: `task_assignees` table with position ordering
- **Time tracking**: Per-user, per-task, per-date via `task_time_logs`; separate manual `timesheet_entries`
- **Kanban**: Customizable columns per-user in `kanban_columns` table
- **Task feedback**: Comment threads on tasks via `task_feedback`

### Frontend Structure

- `src/pages/` — Route-level page components (Dashboard, Tasks, Timesheet, Users, etc.)
- `src/components/` — Reusable UI components
- `src/stores/appStore.ts` — Single Zustand store for all global state
- `src/lib/api.ts` — HTTP client, attaches JWT Bearer token to requests
- `src/types/` — Shared TypeScript interfaces
- `src/hooks/` — Custom React hooks

### Path Alias

`@/` maps to `./src/` in frontend (configured in both `vite.config.ts` and `tsconfig.json`).


## MCP server (embedded)

MCP server **embedded in backend** (`backend/mcp_app.py`, FastMCP), mounted at
`/mcp` on same process/port — no separate service. Tools call `logic/` layer
directly (never DB), so inherit all permission and visibility rules.

Auth = **OAuth 2.1** (`backend/oauth_provider.py`): clients self-register (DCR), user
logs in via `/oauth/consent` (email/password or Microsoft), issued access token = a
ZET **personal access token** (`personal_access_tokens` table; `logic/token_logic.py`). Same
PAT also usable directly as `Authorization: Bearer` token. Root discovery
metadata in `routes/oauth_well_known.py`. Users generate/connect from
**Settings → Developer settings**.

Adding MCP tools: add `@mcp.tool` in `mcp_app.py`, resolve caller via `_uid()`,
call a `logic/` function — never touch DB or routes from a tool.