# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ZET** is a full-stack task management application with a React/TypeScript frontend and FastAPI/Python backend.

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

The frontend proxies `/api` requests to `http://127.0.0.1:8000`. The `.env` file in `/frontend` sets `VITE_API_URL=http://127.0.0.1:8000`.

### Microsoft sign-in (Entra / Azure AD)

1. In **Azure Portal** → App registrations → New registration → **Single-page application (SPA)**; note the **Application (client) ID**.
2. **Authentication** → add a **Single-page application** redirect URI matching the app origin (e.g. `http://localhost:8080/` for local Vite).
3. Set **`MICROSOFT_CLIENT_ID`** on the backend (same value as the app client ID). Optional: **`VITE_MICROSOFT_TENANT_ID`** on the frontend (defaults to `common` for multi-tenant); use a directory tenant ID for single-tenant only.
4. Frontend **`.env`**: `VITE_MICROSOFT_CLIENT_ID=<same client id>` (and optional tenant). The **Log in / Sign up with Microsoft** buttons appear only when `VITE_MICROSOFT_CLIENT_ID` is set.
5. API: `POST /auth/microsoft` with `{ id_token, remember_me?, role? }` — validates the token with Microsoft JWKS and issues the app JWT.

## Architecture

### Stack

- **Frontend**: React 18 + TypeScript, Vite, Zustand (state), TanStack Query, Shadcn/ui + Radix UI, Tailwind CSS, React Router 6, dnd-kit (drag-and-drop), React Hook Form + Zod
- **Backend**: FastAPI, SQLAlchemy 2.0, SQLite (`/backend/data/taskmanager.db`), PyJWT + Passlib (auth)

### Data Flow

```
UI → Zustand Store → API Client (lib/api.ts) → FastAPI Routes → Logic → CRUD → SQLite
```

All server state lives in Zustand (`frontend/src/stores/appStore.ts`). The store handles auth, projects, tasks, kanban columns, users, and theme. On load, the app restores the session from a JWT stored in localStorage.

### Backend Layers

```
routes/    → HTTP endpoint definitions only — parse input, call ONE logic function, return
logic/     → ALL business logic, validation, orchestration, audit, notifications, transaction boundaries
crud/      → EVERY SQLAlchemy / SQL query — no exceptions
database/  → ORM models and DB connection setup
main.py    → FastAPI app with CORS (all origins allowed)
```

## ⛔ ARCHITECTURE RULES — MANDATORY, NON-NEGOTIABLE

This project follows a strict `routes → logic → crud` layering. Every change MUST obey:

1. **Every SQL/ORM query lives in `crud/` — and nowhere else.** Any `db.query(...)`,
   `db.get(...)`, `db.execute(text(...))`, `db.add(...)`, `db.delete(...)`, `.update(...)`,
   `.flush()`, raw SQL, or model read/write belongs in a `crud/` function. `routes/` and
   `logic/` must NEVER contain these. If you need data, add or call a `crud/` function.
2. **`routes/` only trigger logic.** An endpoint takes the request input + the
   `db`/`user_id` dependencies and calls exactly one `logic/` function, then returns its
   result. No queries, no business rules, no audit calls, no notifications in routes.
   (Returning a `FileResponse`/`Response` and reading an `UploadFile` is allowed — those
   are pure HTTP concerns.)
3. **`logic/` holds all business logic** — validation, permissions, orchestration, audit
   logging, notifications, and transaction boundaries (`db.commit()` is allowed in logic).
   Logic may construct model instances (not a query) but delegates all persistence to `crud/`.
4. **One CRUD module per table/domain** (e.g. `crud/tasks.py`, `crud/notifications.py`).
   Name functions for intent: `get_by_id`, `list_for_member`, `create`, `update`, `delete`.
5. **Filtering happens in SQL, not Python.** Do not fetch everything and filter in a loop —
   add a filtered query to `crud/` (e.g. `projects.list_for_member`).

When adding a feature: define the query in `crud/`, the rules in `logic/`, and a thin
endpoint in `routes/`. If you catch yourself importing a model or `text` into `routes/` or
`logic/` for a query, stop and move it to `crud/`.

### Key Domain Concepts

- **Roles**: `admin`, `manager`, `employee`.
  - `admin` — full access to everything **plus** the standalone `/admin` console; sees ALL projects and tasks. The admin role can only be granted from the admin console.
  - `manager` — all in-app manager powers (create projects, assign members, approve, move any task) but **no** admin console; sees only the projects they are a member of.
  - `employee` — own work only; cannot create projects or assign members; sees only projects they belong to.
- **Projects → Sections → Tasks**: Tasks belong to sections within projects
- **Multi-assignee tasks**: `task_assignees` table with position ordering
- **Time tracking**: Per-user, per-task, per-date via `task_time_logs`; separate manual `timesheet_entries`
- **Kanban**: Customizable columns per-user stored in `kanban_columns` table
- **Task feedback**: Comment threads on tasks via `task_feedback`

### Frontend Structure

- `src/pages/` — Route-level page components (Dashboard, Tasks, Timesheet, Users, etc.)
- `src/components/` — Reusable UI components
- `src/stores/appStore.ts` — Single Zustand store for all global state
- `src/lib/api.ts` — HTTP client that attaches the JWT Bearer token to requests
- `src/types/` — Shared TypeScript interfaces
- `src/hooks/` — Custom React hooks

### Path Alias

`@/` maps to `./src/` in the frontend (configured in both `vite.config.ts` and `tsconfig.json`).
