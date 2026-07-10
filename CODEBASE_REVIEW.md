# ZET Task Manager — Codebase Review

**Date:** July 2, 2026  
**Scope:** Full-stack review (backend FastAPI + Aurora `db_wrapper`, frontend React/Vite)  
**Focus:** Database slowness, performance, security, coding standards, DRY, optimization

---

## Executive summary

Database calls feel slow primarily because of **Aurora network/IAM overhead**, **full-table reads** on analytics and bootstrap paths, and at least one **N+1 query loop** in WIP analytics. The app has recently migrated from SQLite/SQLAlchemy to **Aurora + IAM + psycopg2 pools** (`backend/db_wrapper/`), which adds per-connection auth cost that local SQLite did not have.

The architecture (`routes → logic → crud`) is mostly followed, but analytics and AI/MCP paths still load entire tables into Python. Security posture is reasonable for a dev app (bcrypt, JWT fail-fast in prod, explicit CORS in prod), but several **RBAC gaps**, **unauthenticated test endpoints**, and **startup-mode full-team visibility** widen access beyond typical role boundaries.

**Top 5 actions (highest impact):**

1. Fix N+1 in `get_wip_data` — batch task lookup instead of per-row SQL.
2. Replace `list_all_tasks` / `list_all_*` in analytics with scoped SQL aggregations.
3. Add missing indexes on `tasks` and composite index on `timesheet_entries (user_id, work_date)`.
4. Remove or auth-guard `/wrapper/test-read` and `/wrapper/test-write`.
5. Stop loading full task/user tables on frontend bootstrap; paginate or scope by project.

---

## Why database calls feel slow

### 1. Aurora + IAM authentication (infrastructure)

| Factor | Location | Impact |
|--------|----------|--------|
| IAM token generation | `backend/db_wrapper/pool.py` | Each pool rebuild calls `generate_db_auth_token`. Tokens cached ~14 min; cold start or refresh adds latency. |
| Reader/writer split | `backend/db_wrapper/wrapper.py` | After any write in a request, reads route to **writer** (read-your-writes). Extra hop vs reader endpoint. |
| Network RTT | Aurora host vs app region | Cross-AZ/region adds 5–50ms+ per round trip. |
| Connection pool | `DB_POOL_MIN` / `DB_POOL_MAX` (default 2–20) | Pool exhaustion → wait for checkout. |
| No statement timeout | `db_wrapper/wrapper.py` | Long analytics queries hold connections. |

**Diagnostic:** Set `DB_SLOW_QUERY_MS=100` and watch logs for `slow query` from `zet.db_wrapper`. Use `main.py` slow-request middleware (default logs requests > 1s).

### 2. Full-table scans (application)

Analytics endpoints load **entire tables** on every request:

```text
crud/analytics.py:
  list_all_tasks()        → SELECT * FROM tasks
  list_all_task_assignees()
  list_all_projects()
  list_all_sections()
  list_all_project_members()
```

Used by:

- `logic/analytics_logic.py` — overview, org tree, delivery-risk, WIP, timesheet analytics
- `logic/task_forecast_logic.py` — forecast, smart reassignment
- `ai/tools.py` — personal AI tools
- `mcp_app.py` — employee lookup

**Impact:** O(n) memory and transfer; grows linearly with tasks/users. On Aurora this is often the dominant cost after network.

### 3. N+1 query — Who's Working On What (confirmed)

```python
# backend/logic/analytics_logic.py (get_wip_data)
for e in entries:
    ...
    if key not in key_map:
        task = analytics_crud.latest_task_in_section_for_user(db, e.section_id, e.user_id)
```

One extra `SELECT ... LIMIT 1` per unique `(user_id, project_id, section_id)` tuple. With hundreds of timesheet rows this becomes hundreds of queries per WIP page load.

**Fix:** Preload tasks grouped by `(section_id, assigned_to)` in one query, or join in SQL.

### 4. N+1 in list endpoints

| Path | Pattern |
|------|---------|
| `logic/user_logic.py` | `project_ids_for_user(db, u.id)` per user in `list_users` |
| `logic/project_logic.py` | `member_ids` + `sections.list_for_project` per project |
| `logic/task_logic.py` | `to_task_out` — assignees + timelog per task (batched in `list_tasks` but not everywhere) |
| `ai/tools.py` | `list_all(tasks)` then `get_by_id` per match |

### 5. Frontend forces full domain load

```typescript
// frontend/src/stores/appStore.ts — bootstrap, login, register
Promise.all([
  api.getUsers(),
  api.getProjects(),
  api.getTasks(),      // entire task table
  api.getKanbanColumns(),
  api.getActiveTimers(),
]);
```

WebSocket reconnect (`hooks/useTaskSync.ts`) triggers **another** full tasks + users + projects sync.

### 6. Missing / suboptimal indexes

`backend/scripts/bootstrap_aurora.sql` indexes FKs and `work_date`, but **not**:

| Suggested index | Reason |
|-----------------|--------|
| `tasks (status)` | Analytics filters active/completed in Python after full scan |
| `tasks (due_date)` | Overdue / due-today logic |
| `tasks (completed_at)` | Completion metrics |
| `tasks (section_id, assigned_to, created_at DESC)` | `latest_task_in_section_for_user` |
| `task_assignees (task_id)` | Only `user_id` indexed today |
| `timesheet_entries (user_id, work_date)` **composite** | Range queries use both columns |
| `timesheet_entries (section_id)` | WIP grouping |

**Note:** `work_date`, `due_date`, `completed_at` are `VARCHAR`. Indexes help equality; range comparisons are weaker than native `DATE` types.

---

## Performance issues

### Backend

| Severity | Issue | File(s) |
|----------|-------|---------|
| **Critical** | Full-table `list_all_*` on analytics hot paths | `crud/analytics.py`, `logic/analytics_logic.py`, `logic/task_forecast_logic.py` |
| **Critical** | WIP N+1 `latest_task_in_section_for_user` in loop | `logic/analytics_logic.py` ~631–634 |
| **High** | MCP opens new `SessionLocal()` per tool call | `mcp_app.py` |
| **High** | `password_hash` selected in analytics user queries (unnecessary bytes) | `crud/analytics.py` `_USER_COLS` |
| **Medium** | Python-side filtering after full fetch (should be SQL `WHERE`) | `analytics_logic.py` throughout |
| **Medium** | Pool `dispose_all()` on transient checkout failure disrupts all requests | `db_wrapper/pool.py` |
| **Low** | `db.refresh()` called but **not implemented** on `DatabaseWrapper` | `logic/admin_logic.py`, `logic/user_logic.py` — likely `AttributeError` after profile updates |

### Frontend

| Severity | Issue | File(s) |
|----------|-------|---------|
| **Critical** | Bootstrap loads all tasks/users/projects | `stores/appStore.ts` |
| **High** | WS reconnect re-fetches entire domain | `hooks/useTaskSync.ts` |
| **High** | `useAppStore()` without selectors → broad re-renders | 15+ pages/components |
| **Medium** | No route-level code splitting (`React.lazy`) | `App.tsx` |
| **Medium** | Duplicate notification polling (30s + 60s) | `NotificationBell.tsx`, `Companion.tsx` |
| **Medium** | `startTimer` refetches all tasks | `appStore.ts` |
| **Medium** | Split data layer: Zustand (core) vs React Query (analytics) | Multiple pages |
| **Low** | Monolithic pages (Timesheet 2100+ LOC, UserDetail 1600+) | Hard to optimize per-feature |

---

## Security vulnerabilities & risks

### Critical / high

| Risk | Details | File(s) |
|------|---------|---------|
| **Unauthenticated DB test endpoints** | `GET /wrapper/test-read`, `POST /wrapper/test-write` — no auth; write can CREATE TABLE + INSERT | `routes/wrapper_test.py`, `logic/wrapper_test_logic.py` |
| **Analytics RBAC relaxed (startup mode)** | Any authenticated user can view any employee performance/timesheet; WIP shows full team | `logic/analytics_logic.py` — intentional per recent change; document and revisit for production |
| **Self-assign manager on signup** | `RegisterBody.role` allows `"manager"` without approval | `logic/auth_logic.py`, `logic/schemas.py`, `routes/auth.py` |
| **MCP lists all employees** | `find_employees` + `users_crud.list_all` for any PAT holder | `mcp_app.py` |
| **PAT in query string** | `?token=` on MCP/WebSocket — log/history leakage | `mcp_app.py`, `useTaskSync.ts` |
| **Hardcoded Microsoft app IDs in frontend bundle** | Defaults ship when env unset | `frontend/env.defaults.ts` |
| **JWT in localStorage** | XSS → token theft (`tm_token`) | `frontend/src/lib/api.ts` |
| **Insights: client-supplied context** | Authenticated user POSTs arbitrary JSON to LLM — cost/abuse/prompt injection | `routes/insights.py`, `logic/insight_logic.py` |

### Medium

| Risk | Details | File(s) |
|------|---------|---------|
| Open registration | No invite gate | `routes/auth.py` |
| OAuth dynamic client registration | Any client can register | `oauth_provider.py` |
| `analyticsApi` / `adminApi` lack 401 redirect | Inconsistent session expiry vs `api.ts` | `analyticsApi.ts`, `adminApi.ts` |
| `password_hash` loaded into server memory for analytics | Should exclude from `_USER_COLS` | `crud/analytics.py` |
| Hardcoded Microsoft defaults on backend | Fallback client/tenant IDs if env unset | `logic/auth_logic.py` |
| Arbitrary image URLs in `<img src>` | Tracking/SSRF if untrusted URLs stored | `env.ts` `resolveMediaUrl`, project media |

### Low / mitigated

| Item | Status |
|------|--------|
| CORS wide open in prod | **Mitigated** — `config.cors_origins()` requires explicit list in prod |
| Weak JWT in prod | **Mitigated** — `config.py` fail-fast on default secret |
| SQL injection | **Good** — parameterized queries via `db_wrapper`; no raw string concat in CRUD |
| XSS on user content | **Mostly good** — React text nodes; PDF export escapes HTML |
| Static uploads | `nosniff` middleware on `/uploads` | `main.py` |

### Secrets hygiene

- `.env` appears in git status as **untracked** — ensure it stays out of commits.
- Never commit `backend/.cache/dbtoken.json` or IAM tokens.

---

## Coding standards & architecture

Project rules (`CLAUDE.md`): **`routes → logic → crud`**, all SQL in `crud/`, no queries in routes/logic.

### Compliant areas

- Most CRUD modules use `fetch_all` / `fetch_one` via `crud/_base.py`
- Routes generally delegate to single logic functions
- `db_wrapper` centralizes connection pooling and slow-query logging
- Production config fail-fast for JWT, CORS, admin password

### Violations & drift

| Violation | Location | Recommendation |
|-----------|----------|----------------|
| SQL in logic | `notification_logic.py` L92–95 — `db.write("UPDATE notifications...")` | Move to `crud/notifications.py` |
| Raw SQL in logic | `wrapper_test_logic.py` | Remove endpoints or move to crud |
| Routes import CRUD | `routes/health.py`, `routes/analytics.py` (`users_crud.get_by_id`) | Acceptable for auth deps; keep minimal |
| `db.refresh()` on non-ORM wrapper | `admin_logic.py`, `user_logic.py` | Re-fetch via `users_crud.get_by_id` after update |
| Model imports in logic for queries | Some logic files import models but delegate to crud — OK for construction |
| Filtering in Python vs SQL | Analytics aggregates entire tables then filters | Move filters to SQL per project rules |

### Type safety

- **Backend:** Generally typed; Pydantic schemas for API bodies.
- **Frontend:** TypeScript across app; some `any` in older components — run `tsc --noEmit` in CI.

### Testing

- Backend tests exist (`backend/tests/`) but coverage is thin for analytics, auth RBAC, and `db_wrapper`.
- No obvious frontend test coverage for bootstrap or sync paths.

---

## DRY violations

### Backend

| Duplication | Locations |
|-------------|-----------|
| User column lists | `crud/users.py`, `crud/analytics.py` `_USER_COLS` |
| Task column lists | `crud/tasks.py`, `crud/analytics.py` `_TASK_COLS` |
| Date range / capacity helpers | `analytics_logic.py`, `task_forecast_logic.py` |
| Active task checks | `_is_active_task`, `_is_overdue_task` duplicated across logic modules |

### Frontend

| Duplication | Locations |
|-------------|-----------|
| HTTP client (3×) | `lib/api.ts`, `lib/analyticsApi.ts`, `lib/adminApi.ts` — `parseError`, `request`, token header |
| Post-auth hydration (4×) | `appStore.ts` bootstrap, login, register, loginWithMicrosoft |
| `defaultRange()` / `iso()` date helpers | WipPage, OverviewPage, CalendarPage, TimeReportPage, UsersPage, etc. |
| `timeAgo()` | NotificationBell, SettingsPage, AuditPage |
| `ACTION_LABELS` audit maps | SettingsPage, AuditPage |

**Recommendation:** Extract `createApiClient()`, `hydrateSession()`, and `lib/dateRange.ts`.

---

## Optimization techniques (recommended)

### Database

1. **Batch / join instead of loop queries** — WIP task resolution, user project IDs, project members.
2. **SQL aggregations** — `COUNT`, `SUM`, `GROUP BY` in crud for dashboard KPIs instead of loading all rows.
3. **Composite indexes** — especially `timesheet_entries(user_id, work_date)`.
4. **Consider `DATE` columns** — migrate `work_date` / `due_date` from VARCHAR for correct range indexes.
5. **Statement timeout** — `SET statement_timeout = '30s'` on pool connections for analytics.
6. **Reader endpoint** — use reader for read-only analytics when stale data is acceptable (skip read-your-writes routing).
7. **Materialized views / cache** — for overview/delivery-risk if real-time not required (Redis, 60s TTL).

### API

1. **Paginate** `GET /tasks`, `GET /users` with `?projectId=` default scoping.
2. **Field selection** — `?fields=id,title,status` for list endpoints.
3. **ETag / version** — sync already has version; ensure delta endpoints return only changes.

### Frontend

1. **Zustand selectors** — `useAppStore(s => s.tasks)` everywhere.
2. **React.lazy** — route-based code splitting in `App.tsx`.
3. **Unify data fetching** — React Query for server state with Zustand for UI-only state.
4. **Debounce search** — WIP, Manage Projects search inputs.
5. **Use `getUnreadNotificationCount`** instead of full notification list for badges.

---

## Vulnerability checklist (OWASP-oriented)

| Category | Status | Notes |
|----------|--------|-------|
| A01 Broken Access Control | ⚠️ | Startup-mode analytics; MCP employee listing; manager self-signup |
| A02 Cryptographic Failures | ✅ | bcrypt passwords; JWT; TLS to Aurora |
| A03 Injection | ✅ | Parameterized SQL |
| A04 Insecure Design | ⚠️ | Full-table analytics; open registration |
| A05 Security Misconfiguration | ⚠️ | Wrapper test routes; hardcoded MS IDs in defaults |
| A06 Vulnerable Components | — | Run `npm audit` / `pip audit` regularly |
| A07 Auth Failures | ⚠️ | JWT in localStorage; token in WS query |
| A08 Data Integrity | ✅ | Server-side validation via Pydantic |
| A09 Logging Failures | ⚠️ | Slow query logging exists; ensure no secrets in logs |
| A10 SSRF | ⚠️ | User-supplied media URLs |

---

## Prioritized remediation roadmap

### Quick wins (1–2 days)

- [ ] Remove or protect `/wrapper/test-*` routes
- [ ] Fix WIP N+1 with batched task lookup
- [ ] Add composite index `timesheet_entries(user_id, work_date)`
- [ ] Remove `password_hash` from `crud/analytics.py` user selects
- [ ] Replace `db.refresh()` with `users_crud.get_by_id` re-fetch
- [ ] Move notification UPDATE to crud
- [ ] Extract `hydrateSession()` in appStore (DRY + easier to optimize later)
- [ ] Enable `DB_SLOW_QUERY_MS=100` in staging and collect top 10 queries

### Medium effort (1–2 weeks)

- [ ] Rewrite analytics overview/delivery-risk as SQL aggregations
- [ ] Add task status/due_date indexes; benchmark before/after
- [ ] Paginate or project-scope `GET /tasks`
- [ ] Consolidate frontend API clients
- [ ] Zustand selectors across hot pages
- [ ] Restrict signup role to `employee` only
- [ ] Remove hardcoded Microsoft IDs from `env.defaults.ts`

### Larger refactors

- [ ] Delta sync API (tasks/projects/users changes since version)
- [ ] React Query as single server-state layer
- [ ] Split TimesheetPage / UserDetailPage into feature modules
- [ ] Re-introduce role-based analytics RBAC with admin toggle (replace blanket startup mode)
- [ ] Migrate date columns to native `DATE` type

---

## Diagnostic playbook

When investigating slow DB calls:

1. **Browser Network tab** — identify slow endpoint (bootstrap `GET /tasks`, `GET /analytics/wip`, etc.).
2. **Backend logs** — search `slow query` and `Slow request` from `zet.db_wrapper` / `zet`.
3. **Aurora** — Performance Insights / slow query log; check CPU, connections, replica lag.
4. **Pool metrics** — log pool checkout wait time; increase `DB_POOL_MAX` if exhausted.
5. **Row counts** — `SELECT COUNT(*) FROM tasks, timesheet_entries, users`.
6. **Explain** — run `EXPLAIN ANALYZE` on WIP and overview SQL in psql.

Example local timing:

```bash
# Backend with verbose DB logging
DB_SLOW_QUERY_MS=100 LOG_LEVEL=INFO uvicorn main:app --reload

# Time a single endpoint (replace TOKEN)
curl -w "%{time_total}\n" -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:8000/analytics/wip?startDate=2026-06-01&endDate=2026-07-02"
```

---

## Positive findings

- Clear layered architecture documented and mostly enforced
- `db_wrapper` with IAM pools, read-your-writes, slow-query logging
- Production fail-fast for secrets and CORS (`config.py`)
- AI write tools are propose-only; MCP uses logic layer
- Parameterized queries throughout CRUD
- React Query used well for analytics (staleTime, lazy AI insights)
- XSS surface largely avoided for user-generated text

---

## Assumptions & open questions

This review was performed statically (code analysis). Confirm for your environment:

1. **Where is slowness worst?** Bootstrap, WIP, Project Status, or all API calls?
2. **Aurora region** vs app deployment region?
3. **Approximate row counts** (tasks, timesheet_entries)?
4. **Is startup-mode full-team visibility** intentional long-term or temporary?
5. **Should `/wrapper/test-*` be deleted** now that migration is complete?

---

## Related files (quick reference)

| Area | Key paths |
|------|-----------|
| DB pool / IAM | `backend/db_wrapper/pool.py`, `backend/database/iam_token_manager.py` |
| Query wrapper | `backend/db_wrapper/wrapper.py` |
| Analytics CRUD | `backend/crud/analytics.py` |
| Analytics logic | `backend/logic/analytics_logic.py` |
| Schema / indexes | `backend/scripts/bootstrap_aurora.sql` |
| Bootstrap fetch | `frontend/src/stores/appStore.ts` |
| Live sync | `frontend/src/hooks/useTaskSync.ts` |
| Architecture rules | `CLAUDE.md` |

---

*Generated from static codebase review. Re-run after major schema or infrastructure changes.*
