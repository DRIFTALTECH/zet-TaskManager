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
routes/    → HTTP endpoint definitions (auth, users, projects, tasks, kanban, timesheet)
logic/     → Business logic and validations
crud/      → SQLAlchemy database operations
database/  → ORM models and DB connection setup
main.py    → FastAPI app with CORS (all origins allowed)
```

### Key Domain Concepts

- **Roles**: `manager` and `employee` — managers can approve tasks, manage users, and access protected routes (`/users`, `/manage-employees`)
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
