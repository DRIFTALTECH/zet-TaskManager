# ZET — Full Session Context for New Claude Session

> Paste this entire file into a new Claude session. It contains everything needed to continue work on this codebase without gaps.

---

## 1. What This App Is

**ZET** is a full-stack team task management application with an integrated AI agent called **Zani**. The user (Nani, nanibroly@gmail.com) built this with Claude over multiple sessions. The workspace folder is `/Users/Lokesh/Desktop/TaskManager`.

---

## 2. Tech Stack

### Frontend (`/frontend`)
- **React 18 + TypeScript**, Vite (port 8080)
- **Zustand** — single global store (`src/stores/appStore.ts`)
- **TanStack Query** (minimal; most state is in Zustand)
- **Shadcn/ui + Radix UI + Tailwind CSS**
- **React Router 6**, **Framer Motion**, **dnd-kit**, **React Hook Form + Zod**
- **`@/`** path alias → `./src/`

### Backend (`/backend`)
- **FastAPI**, **SQLAlchemy 2.0**, **SQLite** (`/backend/data/taskmanager.db`)
- **PyJWT + Passlib** (auth)
- **LangChain + langchain-groq** (AI)
- **Groq API** → `meta-llama/llama-4-scout-17b-16e-instruct` (agent) + `llama-3.3-70b-versatile` (structured output)

### Run Commands
```bash
# Frontend
cd frontend && npm run dev        # port 8080

# Backend
cd backend && uvicorn main:app --reload   # port 8000

# Frontend proxies /api → http://127.0.0.1:8000
# frontend/.env: VITE_API_URL=http://127.0.0.1:8000
# backend/.env: GROQ_API_KEY=<key>
```

---

## 3. Domain Model

```
Projects → Sections → Tasks
Users (role: manager | employee)
KanbanColumns (customisable per-user)
TimesheetEntries (manual daily work log: project, section, description, time range)
TaskFeedback (comments on tasks)
TaskChecklists
TaskAttachments
AuditLogs
Notifications
```

### Key Data Flow
```
UI → Zustand Store → api.ts (Bearer JWT) → FastAPI Routes → Logic → CRUD → SQLite
```

### Roles
- **manager**: can create projects, approve tasks, manage users, see all projects
- **employee**: sees only their projects, cannot create projects or add members

---

## 4. Project Structure (Key Files)

### Backend
```
backend/
  main.py                    # FastAPI app, CORS, router registration
  database/
    models.py                # SQLAlchemy ORM models
    database.py              # DB connection, Base, get_db
  routes/
    auth.py, users.py, projects.py, tasks.py, kanban.py, timesheet.py
  logic/
    project_logic.py, task_logic.py, user_logic.py, ...
  crud/
    project_crud.py, task_crud.py, ...
  ai/
    router.py                # FastAPI AI routes (/ai/*)
    chains.py                # High-level AI chains (orchestration)
    tools.py                 # LangChain agent tools (12 tools)
    schemas.py               # Pydantic request/response models
    prompts.py               # All LLM prompts
    service.py               # LangChain + Groq client helpers
```

### Frontend
```
frontend/src/
  pages/
    AIPage.tsx               # Zani AI chat page
    TimesheetPage.tsx        # Timesheet / work log page
    DashboardPage.tsx
    TasksPage.tsx
    KanbanPage.tsx
    UsersPage.tsx (manager only)
    SettingsPage.tsx
  components/
    CreateTaskModal.tsx
    UserAvatar.tsx
    Navbar.tsx
    ...
  stores/
    appStore.ts              # Single Zustand store (auth, projects, tasks, kanban, theme)
  lib/
    api.ts                   # HTTP client with JWT Bearer token
    microsoftAuth.ts         # Microsoft Entra SSO helpers
    motion.ts                # Framer Motion presets (snappy, pageEnter)
    utils.ts                 # cn() and misc helpers
  types/
    index.ts                 # All TypeScript interfaces
  hooks/                     # Custom React hooks
```

---

## 5. Authentication

- JWT stored in `localStorage` under key `tm_token`
- `api.ts` reads it and adds `Authorization: Bearer <token>` to every request
- Microsoft SSO: `VITE_MICROSOFT_CLIENT_ID` env var enables "Sign in with Microsoft" button
- Login returns `{ access_token, user }` — token stored, user hydrated into Zustand

---

## 6. AI System — Zani Agent (Full Detail)

### Overview
Zani is an agentic AI built on **LangChain LCEL + Groq Llama 4 Scout**. It has two modes:
1. **Action mode** — propose creating projects/sections/tasks/members (user must Accept)
2. **Personal agent mode** — query the current user's data and render cards

### Backend AI Files

#### `backend/ai/service.py`
```python
# Agent LLM (tool-calling):
ChatGroq(model="meta-llama/llama-4-scout-17b-16e-instruct", temperature=0)

# Structured output / description gen:
ChatGroq(model="llama-3.3-70b-versatile", temperature=0.1-0.4)
```

Three helpers:
- `complete(prompt, vars)` → plain text (description gen, summarization)
- `complete_structured(prompt, vars, PydanticSchema)` → validated Pydantic model
- `transcribe()` → stubbed for future Whisper/audio feature

#### `backend/ai/tools.py` — 12 Tools in `build_tools(db, current_user)`

**PROPOSE tools** (return `PROPOSED: <json>` — user must Accept in UI):
1. `create_project(name, description)` — MANAGERS ONLY; duplicate check
2. `create_section(project_id, section_name)` — duplicate check
3. `create_task(title, project_id, section_id, assignee_id, description, due_date, priority, tags)` — validates ALL IDs against DB before proposing
4. `add_member_to_project(project_id, user_id)` — MANAGERS ONLY; already-member check

**EXECUTE tools** (run immediately, return `SUCCESS: <text>`):
5. `list_projects()` — all projects with sections and member IDs
6. `list_users()` — all users with IDs, titles, experience

**PERSONAL DATA tools** (return `CARDS: <json-array>` — rendered as cards in UI):
7. `get_my_tasks(status_filter, priority_filter)` — tasks assigned to current user
8. `get_my_tasks_due_today()` — tasks due today
9. `get_my_overdue_tasks()` — past due, not completed
10. `get_my_stats()` — counts: assigned_total, in_progress, completed_this_week, overdue
11. `get_my_timesheet_this_week()` — hours per project since Monday
12. `get_my_projects()` — projects user is a member of with task completion %

**Tool return prefix protocol:**
```
PROPOSED: <json>        → action queued for user Accept/Edit
ALREADY_EXISTS: <msg>   → duplicate found; use existing ID
SUCCESS: <msg>          → read-only result
CARDS: <json-array>     → data cards for rendering
ACCESS DENIED: <msg>    → manager-only action blocked
ERROR: <msg>            → unexpected error
```

#### `backend/ai/chains.py`

**`chat(req, db, current_user)` — Manual LCEL tool-calling loop:**
```python
def chat(req, db, current_user):
    tools = build_tools(db, current_user)
    llm = service.get_llm_for_agent().bind_tools(tools)
    
    # System + history (last 6 turns, text only) + current user message
    messages = [SystemMessage(content=system_content)]
    # ... add history messages ...
    
    actions = []; proposals = []; cards = []
    
    for _ in range(8):  # max 8 iterations
        response = llm.invoke(messages)
        messages.append(response)
        if not response.tool_calls: break
        
        for tc in response.tool_calls:
            raw = tool.invoke(tc["args"])
            # Parse prefix → populate actions/proposals/cards
            messages.append(ToolMessage(content=raw, tool_call_id=tc["id"]))
    
    return ChatResponse(message=response.content, tasks=[], actions=actions, proposals=proposals, cards=cards)
```

**Other chains:**
- `generate_description(title, project_name, section_name, context)` → AI task description
- `summarize_task(db, task_id)` → bullet-point TL;DR of comment thread
- `parse_task(text, users, projects)` → structured task extraction from natural language
- `parse_timesheet(summary, work_date, projects)` → structured timesheet rows from natural language

#### `backend/ai/schemas.py` — Key Models

```python
class AICard(BaseModel):
    type: str   # "task" | "stat" | "project" | "timesheet_summary"
    data: dict[str, Any]

class AIProposal(BaseModel):
    type: str   # "create_project" | "create_section" | "create_task" | "add_member"
    # flat optional fields: name, description, project_id, project_name,
    # section_name, title, section_id, assignee_id, assignee_name,
    # due_date, priority, tags, user_id, user_name

class ChatResponse(BaseModel):
    message: str
    tasks: list[ExtractedTask]
    actions: list[AgentAction]    # tool: str, status: str, summary: str
    proposals: list[AIProposal]
    cards: list[AICard]

class TimesheetParseResponse(BaseModel):
    rows: list[ExtractedTimesheetRow]
    gaps: list[str]               # e.g. ["14:30–15:00 unaccounted"]
    total_hours: float
    message: str
```

#### `backend/ai/prompts.py` — AGENT_SYSTEM sections

1. **HOW YOUR TOOLS WORK** — categorises PROPOSE / EXECUTE / PERSONAL DATA tools
2. **PERSONAL AGENT RULES** — maps user phrases to correct tool calls
3. **WORKFLOW** — use list_* for IDs → propose → summarise → tell user to review cards
4. **WHEN NOT TO USE TOOLS** — short acks like "good", "thanks" → text only, no tools
5. **ASSIGNMENT RULES** — experience-based task assignment (<12m junior, 12-48m mid, >48m senior)
6. **ID RULES** — NEVER invent IDs; call list_* if unsure; ERROR: not found → call list_* first
7. **OTHER RULES** — priority values, ISO dates, access denied, ask focused follow-ups

#### `backend/ai/router.py` — API Routes

```
POST /ai/chat              → Zani agent (chat + tool-calling)
POST /ai/generate-description → AI task description from title
POST /ai/summarize-task/{id} → bullet TL;DR of task comment thread
POST /ai/parse-timesheet   → natural language → timesheet rows
POST /ai/parse-task        → natural language → structured tasks
GET  /ai/health            → check GROQ_API_KEY, model info
```

---

## 7. Frontend AI Pages

### `frontend/src/pages/AIPage.tsx` — Zani Chat

**State shape:**
```typescript
interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  tasks?: AIExtractedTask[];
  actions?: AIChatAction[];
  proposals?: AIProposal[];
  cards?: AICard[];           // NEW: personal agent data cards
  loading?: boolean;
}
```

**sendMessage logic (history trimming):**
```typescript
// Text-only, max last 6 turns (12 messages) + current user message
const allClean = [...messages, userMsg]
  .filter(m => !m.loading && m.content.trim())
  .map(m => ({ role: m.role, content: m.content }));
const prior = allClean.slice(0, -1).slice(-12);  // last 12 history msgs
const history = [...prior, allClean[allClean.length - 1]];  // + current
```

**Message rendering order (per AI message):**
1. Text bubble (AI response text)
2. Action badges (already_exists → blue, success → green, denied → amber, error → red)
   - Hidden for: list_projects/list_users success, and all `data` status actions
3. **Proposal cards** (`ProposalCard`) — Accept/Edit each pending action
4. **Agent data cards** (`AgentCardRenderer`) — task/stat/project/timesheet cards
5. Extracted task cards (`ExtractedTaskCard`) — non-agentic flow

**Card components:**
- `AgentTaskCard` — priority dot, title, priority badge, status chip (red if overdue), due date, project/section
- `AgentStatCard` — 2×2 grid: Assigned / In Progress / Done This Week / Overdue
- `AgentProjectCard` — name, section count, description, progress bar (my tasks %)
- `AgentTimesheetCard` — total hours, week range, per-project bar chart

**ProposalCard** handles all 4 proposal types:
- Inline edit for project (name + description) and section (name)
- Opens `CreateTaskModal` for task editing (full form)
- Calls store method on Accept → `useAppStore.getState().bootstrap()` to refresh

**Suggestion chips (updated):**
```
"What tasks are due today?"
"Show me my stats for this week"
"What are my overdue tasks?"
"How many hours did I log this week?"
"What projects am I working on?"
"Create a task to fix the login bug, assign to the first team member, high priority"
```

### `frontend/src/pages/TimesheetPage.tsx` — Work Log

**Structure:**
- Page header with Notify (send email via Microsoft Graph) + Export CSV buttons
- **Quick entry bar** (Clockify-style): description → project → section → time from/to → date picker → Add
- Week navigation (Mon-Sun, newest-first day cards)
- Each **day card** has:
  - Day header: date, total hours, "On Leave" toggle, **✨ AI button**, **+ Add button**
  - **`TimesheetAIPanel`** (opens when AI button clicked, AnimatePresence)
  - Entry list OR empty state

**`TimesheetAIPanel`** (phase 1 → phase 2):
1. Textarea for natural language day description + "Parse my day" button (⌘Enter shortcut)
2. Calls `api.aiParseTimesheet(summary, date, projectRefs)`
3. Shows `RowPreviewCard` list with confidence bars (green ≥0.9, amber ≥0.7, red <0.7)
4. Each card: description, time range, project/section pills, Edit/Remove buttons
5. "← Edit summary" to go back and re-parse
6. "Accept all (N)" → creates `TimesheetWorkEntry` for each row with project+section → calls `reloadEntries()`

---

## 8. Frontend Types (`src/types/index.ts`)

```typescript
// Core
type Role = 'manager' | 'employee';
interface User { id, name, email, role, avatar, projectIds, jobTitle, experienceMonths, joinedAt, currentExperienceMonths }
interface Project { id, name, description, createdBy, members: string[], sections: Section[], createdAt }
interface Section { id, name, projectId }
interface Task { id, title, description, projectId, sectionId, assignedTo, assigneeIds, assignedBy, createdBy, dueDate, priority, status, isStarted, startedAt?, completedAt?, approvedByManager, timeTracked, tags, createdAt, timeLog, customFields? }

// AI Action / Proposal
interface AIChatAction { tool: string; status: 'proposed'|'already_exists'|'success'|'error'|'denied'|'data'; summary: string }
type AIProposalType = 'create_project'|'create_section'|'create_task'|'add_member';
interface AIProposal { type: AIProposalType; name?, description?, project_id?, project_name?, section_name?, title?, section_id?, assignee_id?, assignee_name?, due_date?, priority?, tags?, user_id?, user_name? }

// AI Response
interface AIChatResponse { message: string; tasks: AIExtractedTask[]; actions: AIChatAction[]; proposals: AIProposal[]; cards: AICard[] }

// Personal Agent Cards
interface AICard { type: 'task'|'stat'|'project'|'timesheet_summary'; data: Record<string, unknown> }
// Card data shapes:
// AICardTaskData: { id, title, priority, status, due_date, is_overdue, project_name, section_name, project_id }
// AICardStatData: { assigned_total, in_progress, completed_this_week, overdue }
// AICardProjectData: { id, name, description, total_tasks, completed_tasks, section_count }
// AICardTimesheetData: { week_start, week_end, total_hours, total_entries, by_project: [{project_name, hours, entry_count}] }

// Timesheet AI
interface AITimesheetRow { project_id, project_name, section_id, section_name, description, time_from, time_to, confidence: number, needs_clarification: boolean, clarification_note }
interface AITimesheetParseResponse { rows: AITimesheetRow[]; gaps: string[]; total_hours: number; message: string }

// Manual Timesheet Entry
interface TimesheetWorkEntry { id, userId, workDate, projectId, sectionId, description, timeFrom, timeTo, seconds, createdAt }
```

---

## 9. API Client (`src/lib/api.ts`) — Key Methods

```typescript
// Auth
api.login(email, password, rememberMe?)
api.register(name, email, password, role?)
api.loginMicrosoft(idToken, rememberMe?, role?, jobTitle?, experienceMonths?)

// Users / Projects
api.getMe() → User
api.getUsers() → User[]
api.getProjects() → Project[]
api.createProject(name, description)
api.addSection(projectId, name)
api.addProjectMember(projectId, userId)

// Tasks
api.getTasks() → Task[]
api.createTask(body) → Task
api.patchTask(taskId, patch) → Task
api.deleteTask(taskId)
api.startTask(taskId), api.moveTask(taskId, status)
api.approveTask(taskId), api.reopenTaskToBacklog(taskId)

// Timesheet
api.getTimesheetWorkEntries(start, end)
api.createTimesheetWorkEntry({ workDate, projectId, sectionId, description, timeFrom, timeTo })
api.patchTimesheetWorkEntry(entryId, body)
api.deleteTimesheetWorkEntry(entryId)
api.getTimesheetWorkEntriesForUser(userId, start, end)  // manager-only

// AI
api.aiChat(messages, users, projects) → AIChatResponse
api.aiGenerateDescription(title, projectName?, sectionName?, context?)
api.aiSummarizeTask(taskId)
api.aiParseTimesheet(summary, workDate, projects) → AITimesheetParseResponse
```

---

## 10. Zustand Store (`src/stores/appStore.ts`) — Key Actions

```typescript
// Auth
login(email, password, rememberMe?)
register(name, email, password, role?)
loginWithMicrosoft(idToken, rememberMe?, role?, jobTitle?, experienceMonths?)
logout()
bootstrap()   // called on app load: getMe + getProjects + getTasks + getUsers + getKanbanColumns

// Projects
createProject(name, description)
addSection(projectId, name)
addMemberToProject(projectId, userId)
removeMemberFromProject(projectId, userId)

// Tasks
createTask({ title, description, projectId, sectionId, dueDate, priority, tags, assigneeIds, assignedBy, createdBy })
updateTask(id, updates)
startTask(id), moveTask(id, status)
approveTask(id), reopenTaskToBacklog(id)

// Kanban
addKanbanColumn(label), renameKanbanColumn(id, label), deleteKanbanColumn(id), reorderKanbanColumns(ids)
```

---

## 11. All Bugs Fixed in This Codebase

1. **LangChain `create_tool_calling_agent` ImportError** — langchain 1.3.9 doesn't export it. Fixed by rewriting `chat()` as a manual LCEL loop: `llm.bind_tools(tools)` + iterate checking `response.tool_calls` + `ToolMessage`.

2. **list_projects/list_users showing "Error: ..." in UI** — tools returned raw text without `SUCCESS:` prefix. Fixed by adding `"SUCCESS: Found N..."` prefix.

3. **Agent repeating proposals after user says "good"** — prompt rule: short acks = text only, no tools. Plus max_iterations 12→8.

4. **Agent hallucinating IDs** — fixed by: temperature→0, full ID validation in `create_task` (DB lookup of project, section, assignee before proposing), explicit "NEVER invent IDs" in prompt.

5. **Agent auto-executing instead of proposing** — all create_* tools now return `PROPOSED: <json>`. Nothing written to DB until user clicks Accept.

---

## 12. Architecture Decisions

- **Two-layer security**: agent tools validate/propose (layer 1) → real API endpoints enforce membership/roles on Accept (layer 2)
- **History trimming**: only text (role + content), max 6 turns (12 msgs), strips proposals/cards/actions — prevents stale context bloat
- **Propose-then-confirm**: nothing ever auto-written. User sees cards with Accept/Edit for every create action
- **CARDS: prefix**: personal data tools return structured JSON arrays that chains.py parses into `AICard[]` objects, frontend renders as rich UI cards
- **Model split**: Llama 4 Scout (MoE, 17B active/109B total, temperature=0) for agent tool-calling; Llama 3.3 70B (temperature=0.1-0.4) for structured extraction and text generation
- **TimesheetAIPanel**: inline per-day panel (AnimatePresence). Phase 1 = textarea input, Phase 2 = preview cards. Confidence coloring (green/amber/red borders). Accept All creates entries sequentially.

---

## 13. What's Working (As of End of Session)

- ✅ Full task management (create, edit, delete, move, assign, approve, time-track)
- ✅ Kanban board with custom columns
- ✅ Timesheet with quick-entry bar, week navigation, email notification via Microsoft Graph
- ✅ **Zani AI agent** with propose-then-confirm flow, duplicate detection, role enforcement
- ✅ **Personal agent** — "what's due today?", "my stats", "overdue tasks", "hours this week", "my projects" → rich cards
- ✅ **Timesheet AI** — natural language day summary → structured rows with confidence bars → Accept All
- ✅ Microsoft SSO (Entra ID) for login + sending email reports
- ✅ AI task description generation, task summarization
- ✅ Audit logs, notifications (with unread count)
- ✅ Profile editing, password change, avatar support
- ✅ Dark/light theme toggle

---

## 14. Potential Next Features (User Has Discussed / Suggested)

- **Meeting ingestion** — upload audio/transcript → extract tasks (backend stub exists in `chains.py`)
- **Manager dashboard** — see all team members' timesheets, task completion rates
- **Task dependency graph** — blocked-by relationships
- **Recurring tasks** — repeating schedules
- **More Zani personal queries** — "who's free this week?", "reassign my overdue tasks"
- **Zani can update tasks** — not just create; e.g., "mark the login bug task as done"

---

## 15. Environment Setup

```bash
# backend/.env
GROQ_API_KEY=<your-groq-key>
MICROSOFT_CLIENT_ID=<azure-app-id>   # optional, for SSO validation

# frontend/.env
VITE_API_URL=http://127.0.0.1:8000
VITE_MICROSOFT_CLIENT_ID=<azure-app-id>   # optional, enables SSO button
VITE_MICROSOFT_TENANT_ID=common           # optional, defaults to "common"
```

---

## 16. Key File Paths (Absolute)

```
/Users/Lokesh/Desktop/TaskManager/          ← workspace root
  frontend/
    src/
      pages/AIPage.tsx
      pages/TimesheetPage.tsx
      stores/appStore.ts
      lib/api.ts
      types/index.ts
  backend/
    ai/
      tools.py         ← 12 agent tools
      chains.py        ← chat(), parse_timesheet(), etc.
      schemas.py       ← AICard, AIProposal, ChatResponse, etc.
      prompts.py       ← AGENT_SYSTEM, TIMESHEET_PARSE_PROMPT, etc.
      router.py        ← /ai/* FastAPI routes
      service.py       ← ChatGroq client helpers
    database/
      models.py        ← SQLAlchemy models
    data/
      taskmanager.db   ← SQLite database
  CLAUDE.md            ← project instructions (Claude reads this automatically)
  SESSION_CONTEXT.md   ← this file
```

---

*This document covers the full state of the ZET codebase as of session end. The codebase is fully functional. Continue from any of the "Potential Next Features" above, or ask about any part of the system.*
