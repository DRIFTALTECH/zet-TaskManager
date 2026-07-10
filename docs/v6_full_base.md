# ZET Production Architecture v6 — Full Box Guide

Companion to [`zet-production-architecture-v6.drawio`](./zet-production-architecture-v6.drawio).

This document explains **every box, subtitle word, and edge label** on the v6 diagram: why it exists, how ZET uses it, who calls it, and where it lives in the repo.

---

## How to read the diagram

**Top → bottom (happy path):**

```
Users → Access (browser) → Authentication Zone
  → Frontend → Backend (JWT Bearer REST)
    → routes → logic → CRUD → DB Wrapper → Aurora
  → (Logic also uses Platform Services)
External Services sit outside AWS (dashed lines).
```

**Layering rule (non-negotiable in code):**

```
routes/  →  thin HTTP only; calls ONE logic function
logic/   →  business rules, permissions, orchestration, commits
crud/    →  every SQLAlchemy / SQL query
```

Services (AI, MCP, Realtime, Audit/Notifications/Files) are **shared tools used by Logic**, not a fifth step after CRUD.

---

## 1. Title

| Word on diagram | Meaning |
|-----------------|--------|
| **ZET TaskManager** | Product name |
| **Production Software Architecture** | Target production layout (Aurora, Entra, Groq, etc.), not a local-only dump of every file |

---

## 2. Left column — who uses the app

### Box: Users

| Text | Why it’s there |
|------|----------------|
| **Manager** | Role `manager` — create projects, assign members, approve work, move any task in projects they belong to; **no** `/admin` console |
| **Create · Assign · Approve** | Core manager verbs: create projects/tasks, assign people, approve timesheets / submissions |
| **Employee** | Role `employee` — own work only; cannot create projects or assign members |
| **Tasks · Log Time** | Employee focus: execute tasks, timers / timesheet entries |
| **Admin** | Role `admin` — full in-app access **plus** standalone `/admin` console; sees all projects/tasks |
| **Manage System** | Admin console: users, roles, system controls |

**Who calls them?** Nobody “calls” Users — they open the browser. Role checks live in `logic/` (and deps in `routes/deps.py`).

**Code:** roles are fields on the user model / JWT claims; enforced across `*_logic.py`.

---

### Box: Access

| Text | Why |
|------|-----|
| **Access** | Entry channel into the product |
| **Web Browser** | ZET is a SPA — only browser clients are in scope on this diagram |

**Edge `enter` → Authentication Zone:** user hits the React app; all session work starts inside Auth Zone.

---

## 3. AWS Cloud (outer group)

| Text | Why |
|------|-----|
| **AWS Cloud** | Production hosting boundary for the app + database |

On the diagram this groups the Authentication Zone and Data Layer. It does **not** invent extra AWS products (no Redis, SQS, Lambda boxes unless they exist in product docs as real targets).

---

## 4. Authentication Zone (big blue swimlane)

### Title line

| Phrase | Meaning |
|--------|---------|
| **Authentication Zone** | Logical span covering FE + BE + Platform Services so auth is not drawn twice |
| **MSAL sign-in** | Browser uses Microsoft Authentication Library (`@azure/msal-browser`) |
| **JWKS validate** | Backend fetches Microsoft’s public key set and verifies the Entra `id_token` |
| **app JWT session** | After Microsoft (or password) login, ZET issues its **own** JWT used for all API calls |
| **(through Platform Services)** | Visual: the zone extends down through services so auth isn’t a tiny top strip |

### Box: Sign-in once (auth note)

| Phrase | Meaning |
|--------|---------|
| **Frontend MSAL → Entra id_token** | User signs in with Microsoft; MSAL returns an OpenID `id_token` (JWT from Microsoft) |
| **Backend JWKS (RS256)** | `auth_logic` uses `PyJWKClient` against Entra discovery keys; algorithm **RS256** |
| **issues ZET JWT** | Backend creates/looks up user and returns ZET `access_token` |
| **every API call = Bearer JWT** | `Authorization: Bearer <zet-jwt>` on subsequent REST (and PAT for MCP) |

**Code:**

- FE: `frontend/src/lib/microsoftAuth.ts`
- BE: `backend/logic/auth_logic.py` → `_decode_microsoft_id_token`, `microsoft_auth`
- Route: `POST /auth/microsoft` in `backend/routes/auth.py`

**Who calls JWKS?** **Only the backend** — not the frontend.

---

## 5. Frontend (React) · port 8080

| Word | Why |
|------|-----|
| **Frontend (React)** | React 18 + TypeScript + Vite SPA under `frontend/` |
| **port 8080** | Local Vite default; proxies `/api` → backend `:8000` |

### Pages & UI

| Word | Why |
|------|-----|
| **Pages & UI** | Route-level screens + shared components |
| **Dashboard · Tasks · Timesheet** | Example primary pages (not an exhaustive list) |

**Who calls:** browsers via React Router. Pages call the store / `api.ts`, which hits HTTP Client.

**Code:** `frontend/src/pages/`, `frontend/src/components/`.

### Client Auth

| Word | Why |
|------|-----|
| **Client Auth** | Everything the browser does to establish and keep a session |
| **MSAL** | Microsoft sign-in SDK only — does **not** fetch JWKS |
| **JWT storage** | ZET JWT kept in `localStorage` / session restore on load |
| **Protected Routes** | UI gates routes when no valid session |

**Edge `MSAL · id_token` → Microsoft Entra ID:** browser redirects / popup to Entra; receives `id_token`.

**Code:** `microsoftAuth.ts`, auth pages (`Login` / `SignUp` / Admin login), Zustand session restore in `appStore.ts`.

### HTTP Client

| Word | Why |
|------|-----|
| **HTTP Client** | Central fetch wrapper |
| **REST** | JSON over HTTP to FastAPI |
| **Bearer JWT** | Attaches `Authorization: Bearer …` |

**Edge `JWT Bearer · REST / JSON` → routes:** main production traffic after login. This is the **only** FE→BE spine on v6 (Entra is external, not mid-spine).

**Code:** `frontend/src/lib/api.ts`, `adminApi.ts`.

---

## 6. Backend (FastAPI) · port 8000

| Word | Why |
|------|-----|
| **Backend (FastAPI)** | Single Python process: REST + WebSocket + mounted MCP |
| **port 8000** | API / uvicorn |

**Entry:** `backend/main.py` — CORS, routers, static media, `app.mount("/mcp", …)`.

---

## 7. routes (API ROUTES)

Thin HTTP adapters. Each endpoint parses input, injects `db` / `user_id`, calls **one** `logic` function, returns the result.

| Box title | Subtitle words | Why those words | Typical callers | Code |
|-----------|----------------|-----------------|-----------------|------|
| **Auth** | Login · Register · Microsoft | Email/password login & signup; Microsoft `id_token` exchange | Login / Sign-up pages; MSAL redirect handler | `routes/auth.py` → `auth_logic` |
| **Users** | Profile · Listing · Skills | User profile CRUD/list; skills attached to users | Users page, profile UI | `routes/users.py`, `skills.py` |
| **Projects** | CRUD · Members | Create/update/delete projects; add/remove members | Projects UI | `routes/projects.py` |
| **Tasks** | CRUD · Move · Timers | Task create/edit/delete; column/status moves; start/stop timers | Tasks / Kanban / timers | `routes/tasks.py`, `kanban.py` |
| **Timesheet** | Entries · Approve | Manual / logged entries; manager submit & approve flow | Timesheet page | `routes/timesheet.py` |
| **Notifications** | List · Mark Read | In-app notification feed | Bell / notifications UI | `routes/notifications.py` |
| **Analytics** | Overview · Forecast | WIP/overview dashboards + forecast endpoints | Analytics / insights UIs | `routes/analytics.py` (+ forecast via logic) |
| **AI** | Chat · Insights | Conversational AI + insight narration APIs | AI chat / insights pages | `ai/router.py` under `/ai`, `routes/insights.py` |
| **Meeting Notes** | Scrums · Transcribe | Scrum/MOM notes; transcript→notes pipelines | Meeting Notes page | `routes/meeting_notes.py` |
| **Admin** | Console · Auth | Standalone admin login + console APIs | `/admin` frontend | `routes/admin.py` |
| **MCP** | /mcp · Agent Tools | Model Context Protocol surface for agents | Cursor / MCP clients with PAT / OAuth | `mcp_app.py` mounted at `/mcp` |
| **Sync** | WebSocket Sync | Live push channel for board/state updates | Frontend WS client after login | `routes/sync.py` |

**Other route modules that exist but are folded into boxes above (or into Integrations/CRUD):**  
`clockify`, `integrations_teams`, `tokens`, `oauth_*`, `attachments`, `checklists`, `audit`, `clients`, `health`.

**Edge routes → logic:** every successful API handling continues into business logic.

---

## 8. logic (BUSINESS LOGIC)

All validation, permissions, orchestration, audit hooks, notifications, transaction boundaries.

| Box title | Subtitle | Why those words | Who calls | Code |
|-----------|----------|-----------------|-------------|------|
| **Authentication** | JWT · MSAL | Issues/validates **ZET JWT**; Microsoft path uses FE MSAL + BE JWKS (not “OIDC” on diagram) | Auth routes; every protected request via deps | `auth_logic.py` |
| **User Management** | Profiles | Profile updates, listings, role-aware views | User routes | `user_logic.py` |
| **Project Management** | Members · Media | Membership rules; project media/static file rules | Project routes | `project_logic.py` |
| **Task Management** | Assign · Approve | Multi-assignee rules; manager approve/move semantics | Task / kanban routes | `task_logic.py`, `timer_logic.py`, … |
| **Timesheet Logic** | Submit · Review | Submit week/entries; manager review/approve | Timesheet routes | `timesheet_logic.py` |
| **Analytics Logic** | WIP · Overview | Work-in-progress and overview aggregations (SQL via crud) | Analytics routes | `analytics_logic.py` |
| **Forecast Logic** | Recommendations | Task forecast / recommendations | Analytics / task forecast endpoints | `task_forecast_logic.py` |
| **AI & Insights** | LLM Narration | Builds prompts, calls AI Engine, returns narrated insights / chat | AI + insights routes | `insight_logic.py`, AI service glue |
| **Notifications** | In-app Alerts | Creates/lists notification records when domains change | Called **from other logic** + notification routes | `notification_logic.py` |
| **Audit Service** | Write · Read | Persist audit events; read for admin/history | Called from many logic paths + audit routes | `logic/audit.py` |
| **Meeting Notes** | MOM · Transcribe | Minutes-of-meeting generation; transcript processing | Meeting-notes routes | `meeting_notes_logic.py`, `task_extraction_logic.py` |
| **Integrations** | Teams · Clockify | Graph / Teams transcript & Clockify sync orchestration | Teams + Clockify routes; Meeting Notes FE may call Graph directly for tokens | `teams_logic.py`, `clockify_logic.py` |

**Edge `uses` → Platform Services:** Logic reaches out sideways to AI / MCP tools context / Realtime / cross-cutting helpers — not “after” CRUD on the main spine.

**Edges from Integrations:**

- **`Teams` → Microsoft Graph** — Teams transcripts / meeting data (also FE can hit Graph with MSAL Graph scopes for sendMail / transcripts).
- **`Sync` → Clockify API** — push/pull time data via stored API key (`clockify_logic`).

---

## 9. CRUD LAYER

Every ORM query lives here. Logic never should embed `db.query` / `db.execute`; it calls these modules.

| Box title | Subtitle | Why | Called by | Code |
|-----------|----------|-----|-----------|------|
| **users** | Users | User table read/write | Auth, user, admin logic | `crud/users.py` |
| **projects** | Projects | Projects + membership queries | Project / task visibility logic | `crud/projects.py` (+ sections) |
| **tasks** | Tasks | Task rows, moves, filters | Task / analytics / forecast | `crud/tasks.py` |
| **assignees** | Assignees | Multi-assignee `task_assignees` ordering | Task assign flows | `crud/task_assignees.py` |
| **timesheet** | Timesheet | Entries + submissions | Timesheet logic | `crud/timesheet_entries.py`, `timesheet_submissions.py`, `timelog.py` |
| **notifications** | Notifications | Notification rows | Notification logic | `crud/notifications.py` |
| **audit** | Audit Logs | Audit event persistence | Audit logic | `crud/audit.py` |
| **meeting_notes** | Scrums | Meeting / scrum note storage | Meeting-notes logic | `crud/meeting_notes.py` |
| **skills / clients** | Skills · Clients | Skills catalog + client entities | Skill / client logic | `crud/skills.py`, `clients.py` |
| **tokens / oauth** | PAT · OAuth | Personal access tokens + OAuth client/consent tables for MCP | Token / OAuth / MCP auth | `crud/access_tokens.py`, `oauth.py` |

**Edge CRUD → DB Wrapper:** queries go through the session / pool abstraction.

---

## 10. DB Wrapper

| Word | Why |
|------|-----|
| **DB Wrapper** | App’s database access surface (SQLAlchemy engine/session, health helpers) |
| **Read / Write** | All persistence is read or write SQL against Aurora |
| **Aurora Pool** | Connection pooling toward Amazon Aurora PostgreSQL in production |

**Who calls:** CRUD modules (and low-level session deps). Routes/logic do not open pools themselves.

**Code:** `backend/database/` (models + engine), session injection in `routes/deps.py`.

**Edge `SQL (IAM)` → Data Layer:** production DB auth expectation (IAM DB auth to Aurora), not browser cookies.

Local/dev may still use SQLite in config; **the diagram shows production**, so SQLite is omitted.

---

## 11. Platform Services

Shared capabilities in the **same FastAPI process**. Not microservices. Not a CRUD step.

| Box | Subtitle | Why | Who calls | Code |
|-----|----------|-----|-----------|------|
| **AI Engine** | `backend/ai/` · Groq · Ollama fallback | LLM tooling: service, prompts, parsers, chains | AI/insights/meeting extraction logic | `backend/ai/*` |
| **MCP Server** | `mcp_app.py` · `/mcp` · Agent tools | Agents call ZET tools with same permission rules as HTTP | External MCP clients; tools call `logic/` | `backend/mcp_app.py`, OAuth/PAT |
| **Realtime Sync** | WebSocket · Live board updates | Push updates so Kanban/boards refresh without reload | Browser WS → sync route; publishers from mutating logic | `routes/sync.py` (+ related broadcast helpers) |
| **Cross-cutting** | Audit · Notifications · Files · Shared side effects | Side effects many domains share after a business action | Invoked from logic while handling tasks/projects/etc. | `logic/audit.py`, `notification_logic.py`, `attachment_logic.py` |

**Edge `LLM` → Groq Cloud LLM:** AI Engine’s primary remote model; Ollama is local/dev fallback (not drawn as a separate external box).

---

## 12. Data Layer (AWS)

| Word | Why |
|------|-----|
| **Data Layer (AWS)** | Persistence boundary outside the app process |
| **Amazon Aurora PostgreSQL** | Production database |
| **Production database · IAM auth** | Hosted Postgres-compatible DB; IAM-based connection auth target |

**Why no “Data Domains” box on v6:** domains are already expressed as CRUD chips; the data layer is only the real store (Aurora).

---

## 13. External Services (dashed group)

Outside AWS on purpose — third-party SaaS.

| Box | Subtitle | Why | Who calls | How used |
|-----|----------|-----|-----------|----------|
| **Microsoft Entra ID** | MSAL · JWKS | Identity provider for Microsoft login | **FE MSAL** for login; **BE JWKS** for `id_token` signature | Issues Microsoft `id_token`; publishes JWKS at `login.microsoftonline.com/.../discovery/v2.0/keys` |
| **Microsoft Graph** | Teams transcripts | Teams meeting / transcript / mail APIs | FE (Graph token via MSAL) and/or BE `teams_logic` | Meeting Notes, Teams integration, optional mail send |
| **Groq Cloud LLM** | Primary AI · Ollama fallback | Hosted fast LLM API | AI Engine (`backend/ai`) | Chat, insights, narration; Ollama if Groq unavailable |
| **Clockify API** | Time sync | External time-tracking sync | `clockify_logic` via `/clockify` routes | Connect workspace, sync jobs, status |

**Edge labels:**

| Label | Direction | Meaning |
|-------|-----------|---------|
| **MSAL · id_token** | Client Auth → Entra | Browser sign-in |
| **JWKS · validate (BE)** | Entra → Auth note / BE auth path | Backend key fetch + RS256 verify |
| **Teams** | Integrations → Graph | Teams/Graph API traffic |
| **Sync** | Integrations → Clockify | Clockify HTTP sync |
| **LLM** | AI Engine → Groq | Model inference |

---

## 14. Legend (bottom bar)

| Phrase | Meaning |
|--------|---------|
| **Path: User → Frontend → Backend (JWT Bearer) → Routes → Logic → CRUD → DB Wrapper → Aurora** | Canonical request path after sign-in |
| **Entra: MSAL (FE) · JWKS (BE)** | Split responsibility for Microsoft login |
| **Services used by Logic** | Side tools, not CRUD successors |
| **Dashed = external** | Lines to Entra / Graph / Groq / Clockify |

---

## Glossary (words that appear on boxes / edges)

| Term | In ZET means |
|------|----------------|
| **JWT** | ZET’s own signed access token after login (and also Microsoft’s `id_token` which is a JWT — different issuer) |
| **Bearer JWT** | HTTP `Authorization: Bearer <token>` |
| **MSAL** | Microsoft Auth Library in the **browser** |
| **JWKS** | JSON Web Key Set — Microsoft’s **public** signing keys; fetched only by **backend** |
| **id_token** | Microsoft-issued identity JWT after MSAL login; POSTed to `/auth/microsoft` |
| **RS256** | Asymmetric signing algorithm for Entra tokens |
| **PAT** | Personal Access Token for MCP / API agent access (`personal_access_tokens`) |
| **OAuth** | OAuth 2.1 for MCP consent (`/oauth`, DCR); diagram packs with PAT under tokens CRUD |
| **REST / JSON** | Normal FastAPI HTTP APIs |
| **WebSocket** | Live sync channel under `/sync` |
| **CRUD** | Create/Read/Update/Delete SQL layer modules |
| **Aurora Pool** | Pooled SQLAlchemy connections to Aurora |
| **IAM auth** | AWS IAM authentication to the database (production posture) |
| **WIP** | Work-in-progress analytics views |
| **MOM** | Minutes of Meeting (meeting notes output) |
| **MCP** | Model Context Protocol server embedded at `/mcp` |

---

## What was deliberately *not* drawn

- **SQLite** — local/dev only; production diagram uses Aurora  
- **OIDC** label — replaced with how ZET actually talks: **MSAL** + **JWT** / **JWKS**  
- **Duplicate Auth FE→Entra→BE strip** — one Entra external + JWT spine  
- **Data Domains chip** — removed so Data Layer is Aurora-only  
- Invented infra (Redis, S3, Lambda, queues) not present as product architecture boxes here  

---

## Quick “who calls whom” cheat sheet

```
Browser Users
  └─ Access (Web Browser)
       └─ Frontend Pages / Client Auth / HTTP Client
            ├─ (dashed) MSAL → Entra → (dashed) JWKS → Backend auth_logic
            └─ JWT Bearer REST → routes → logic ─┬─→ CRUD → DB Wrapper → Aurora
                                                 └─→ Platform Services
                                                       ├─ AI Engine → Groq
                                                       ├─ MCP Server ← agents (PAT/OAuth)
                                                       ├─ Realtime Sync ← browser WS
                                                       └─ Cross-cutting (audit/notify/files)
            Integrations logic ─→ Graph / Clockify
```

---

## Source diagram

- Draw.io: [`docs/zet-production-architecture-v6.drawio`](./zet-production-architecture-v6.drawio)
- Stack notes: `CLAUDE.md`, `docs/architecture.md`, `docs/product-specification.md`
