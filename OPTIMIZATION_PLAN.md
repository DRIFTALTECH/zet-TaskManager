# ZET — Optimization & Architecture Plan

> Owner: Engineering
> Status: Proposed
> Last updated: 2026-07-18
> Scope: Frontend theming + performance, backend architecture + API/DB speed, phased delivery.

This document is the single source of truth for the optimization effort. Each work item has a **goal**, **what changes**, **acceptance criteria**, and a **rough effort** (S ≤ half day, M ≤ 2 days, L ≤ 1 week). Nothing here changes product behavior unless explicitly noted — every change must be independently shippable and verifiable via `npm run build` / `npm run test` (frontend) and `pytest` (backend).

---

## 0. Guiding Principles

1. **Measure before and after.** No optimization ships without a number attached (bundle KB, endpoint p95 ms, query count). Guessing is banned.
2. **DRY on the third repeat**, not speculatively. Extract patterns that already recur.
3. **Incremental, reversible commits.** One feature/module at a time. No big-bang refactor branch that lives for weeks.
4. **Layering is law.** Backend keeps `routes → logic → crud`. Frontend moves to feature-first but keeps a hard line between shared primitives and feature code.
5. **Perf priority order:** network payload/count → render cost → compute cost.
6. **Behavior-preserving refactors first**, feature work second. Never mix a move-files commit with a logic-change commit.

---

## 1. Baseline Metrics (fill in before starting — Phase 0)

| Metric | Tool | Baseline | Target |
|---|---|---|---|
| Initial JS bundle (gzip) | `vite build` + `rollup-plugin-visualizer` | TBD | −50% |
| Largest single chunk | build report | TBD | < 250 KB |
| First Contentful Paint | Lighthouse | TBD | < 1.5s |
| Time to Interactive | Lighthouse | TBD | < 3s |
| `/tasks` API p95 | server timing log | TBD | < 200ms |
| Slowest 5 endpoints | slow-query / timing middleware | TBD | documented |
| Queries per `/tasks` request | SQL echo / count | TBD | O(1) batched |

**Action:** Add a timing middleware to FastAPI and `rollup-plugin-visualizer` to Vite as the very first task. Everything else is judged against these.

---

# PART A — FRONTEND

## A1. Theme System (color + font tokens)

### Current state
- Theme is a binary `dark`/`light` toggled by `useAppStore(s => s.theme)` → `document.documentElement.classList.toggle('dark')` (`App.tsx`).
- Colors/fonts live ad hoc across Tailwind classes + one-off files (`lib/pill-color.ts`, `lib/image-color.ts`). No central design-token layer.

### Goal
A single **design-token system** so color and font changes happen in one place and cascade everywhere. Non-developers can restyle the app by editing tokens, not hunting components.

### What changes
1. **CSS variable token layer** in `index.css` (`:root` + `.dark`):
   - Semantic tokens only: `--color-bg`, `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-primary`, `--color-primary-fg`, `--color-accent`, `--color-danger`, `--color-success`, `--color-warning`.
   - Radius, spacing scale, shadow tokens.
2. **Tailwind config maps to the variables** (`tailwind.config.ts` → `colors: { bg: 'var(--color-bg)' … }`). Components use `bg-bg`, `text-text-muted` — never raw hex or `bg-slate-900`.
3. **Font tokens:** `--font-sans`, `--font-mono`, `--font-display`. Self-host fonts (see A4) and wire via `--font-*`. Font-size + line-height scale tokens (`--text-sm` … `--text-2xl`).
4. **Theme presets:** a `themes/` map (e.g. `default`, `midnight`, `solarized`) each = a set of token values. Switching theme = swapping the token object on `:root`. Enables future multi-theme with zero component edits.
5. **Migrate hardcoded colors:** codemod/grep pass replacing raw Tailwind palette classes and hex literals with semantic tokens. Track progress with a lint rule (`no raw hex in tsx`).

### Acceptance criteria
- Changing `--color-primary` in one file restyles every button/link/accent.
- Zero raw hex colors in `src/**/*.tsx` (enforced by eslint rule).
- Dark/light both driven from the same token set; adding a 3rd theme requires no component change.

**Effort:** L (token layer S, migration L)

---

## A2. Lazy Loading & Code Splitting

### Current state
- `App.tsx` eager-imports **every** page (25 pages, 36k LOC total) into one bundle. No `React.lazy`, no `Suspense`, no `manualChunks`.

### Goal
Ship only what the first screen needs; load routes and heavy widgets on demand.

### What changes
1. **Route-level lazy loading:** convert every page import in `App.tsx` to `React.lazy(() => import('./pages/X'))`, wrap `<Routes>` in `<Suspense fallback={<RouteSkeleton/>}>`. Keep `LoginPage` eager (first paint).
2. **Vendor chunk splitting** in `vite.config.ts` `build.rollupOptions.output.manualChunks`:
   - `react-vendor` (react, react-dom, react-router)
   - `radix` (all `@radix-ui/*`)
   - `charts` (recharts/zet-charts deps)
   - `motion` (framer-motion)
   - `dnd` (@dnd-kit/*)
   - `date` (date-fns)
3. **Lazy-load heavy non-route widgets:** `TaskDetailModal` (1381 LOC), `CreateTaskModal`, `GlobalSearchModal`, `CalendarView`, analytics `ForecastPanel` (757 LOC) — dynamic `import()` on first open, not on page mount.
4. **Prefetch on intent:** prefetch a route's chunk on nav-link hover/focus (cheap perceived-instant nav).
5. **Icon tree-shaking audit:** ensure `lucide-react` imports are per-icon, not barrel.

### Acceptance criteria
- Build report shows ≥ 6 async chunks; no single chunk > 250 KB gzip.
- Navigating to `/timesheet` downloads the timesheet chunk only then.
- Initial bundle drops ≥ 50% vs. baseline.

**Effort:** M

---

## A3. Advanced Render & Data Optimization

### Current state
- `bootstrap()` fetches users + projects + **all tasks** + kanban + timers + clients before the app renders anything (`appStore.ts:159`). Blocking gate.
- `useTaskSync` refetches **all** tasks on any version bump (`useTaskSync.ts:45`); 4s poll fallback.
- TanStack Query is installed and configured but server state is fetched manually in Zustand — two caching layers, one used.
- God files: `appStore.ts` (602 LOC), `types/index.ts` (456 LOC). Pages up to 2110 LOC with no memoization.

### Goal
Fast first render, minimal over-fetching, no wasted re-renders.

### What changes
1. **Slim bootstrap:** gate app on `getMe()` only. Load users/projects at shell mount; load tasks **per active project / per route**, not the entire workspace up front.
2. **Server-state ownership decision (blocking — see Open Questions):** either
   - (Recommended) **TanStack Query owns all server reads** (tasks, projects, users, analytics) — free dedup, stale-while-revalidate, background refetch, per-key invalidation. Zustand keeps UI-only state (theme, drag bus, mascot, selected project). Or
   - Keep Zustand and add manual dedup/caching (more code, reinvents Query).
3. **Delta sync:** replace "refetch all tasks on any bump" with a `since`-cursor endpoint or per-project scoped refetch. Poll cadence backs off when tab hidden (already partly handled).
4. **Split god files:**
   - `appStore.ts` → Zustand slices (`tasksSlice`, `projectsSlice`, `uiSlice`) composed into one store.
   - `types/index.ts` → per-feature `features/*/types.ts` + `shared/types.ts`.
5. **Render hygiene:** `React.memo` on list-row components (`TaskCard`), `useMemo`/`useCallback` for derived lists and handlers passed to memoized children, virtualize long lists (tasks, timesheet rows) with `@tanstack/react-virtual`.
6. **Selector discipline:** Zustand selectors return primitives/narrow slices (avoid whole-store subscriptions that re-render on any change).

### Acceptance criteria
- App shell renders after `getMe()` (< 1 network round-trip to first paint).
- Editing one task does not refetch the entire task list.
- No component re-renders on unrelated store changes (verified via React DevTools profiler).

**Effort:** L

---

## A4. Fonts & Assets

### Current state
- Fonts likely pulled from a CDN or system stack; images uploaded per project.

### Goal
Fast, layout-stable text; no render-blocking font fetches.

### What changes
1. **Self-host fonts** (woff2, subset to used glyphs) in `public/fonts`, `@font-face` with `font-display: swap`, wired through `--font-*` tokens (A1).
2. **Preload** the primary font in `index.html` (`<link rel="preload" as="font" crossorigin>`).
3. **Image handling:** lazy-load below-the-fold images (`loading="lazy"`), serve responsive sizes, prefer AVIF/WebP for static assets.
4. **Remove unused deps** flagged by the bundle report (e.g. unused carousel/embla if not used).

### Acceptance criteria
- No CDN font request on load; CLS ≈ 0 from font swap.
- Lighthouse "properly sized images" and "font-display" pass.

**Effort:** M

---

## A5. Frontend Folder Restructure (feature-first)

### Target layout
```
src/
  features/
    tasks/       components/  api.ts  hooks.ts  utils.ts  types.ts  store-slice.ts
    timesheet/   ...
    projects/    ...
    analytics/   ...
    ai/          ...
    auth/        ...
    users/       ...
  shared/
    ui/          # shadcn primitives (was components/ui)
    components/  # cross-feature: UserAvatar, NavLink, DatePickerInput
    lib/         # pure helpers only: utils, motion, colors, env
    hooks/
    types.ts
  pages/         # thin route shells that compose features
  stores/        # UI-only Zustand (theme, drag, mascot)
  App.tsx
```
Rule anyone can state: **"Everything about feature X lives in `features/X/`."** Mirrors the backend's per-domain thinking.

### What changes
- Split flat `lib/` (23 files) into API clients → each feature's `api.ts`, domain utils → feature `utils.ts`, pure helpers → `shared/lib/`.
- Move feature giants (`TaskDetailModal`, `UserStoriesPanel`, `KanbanBoardPan`) out of flat `components/` into their feature folder.
- Keep `@/` alias; import churn is mostly find-replace.

### Acceptance criteria
- No feature imports another feature's internals except through a defined public entry (`features/x/index.ts`).
- `shared/` never imports from `features/`.
- Build + tests green after each feature moved.

**Effort:** L (do incrementally, one feature per PR)

---

# PART B — BACKEND

## B0. Current architecture (keep — it's good)
`routes/ (thin) → logic/ (rules) → crud/ (all SQL) → database/`. One module per domain across all three layers. DB is **Aurora/Postgres via `db_wrapper`** with IAM-token auth and a read/write connection pool; **SQLite only for tests** (`ZET_TEST_SQLITE`). `config.py` fail-fasts on weak secrets in prod.

> Note: `CLAUDE.md` still says "SQLite (`/backend/data/taskmanager.db`)" — **stale**. Update it to reflect Aurora + db_wrapper. (Doc fix, S.)

The layered structure stays. Optimization here is about **speed and DB handling**, not re-org.

---

## B1. API Speed

### Goal
Predictable, fast endpoints; O(1) query count per request; no unbounded payloads.

### What changes
1. **Timing middleware + slow-query log** (Phase 0). Every response logs route + duration; log SQL over N ms. This drives all backend work.
2. **Kill N+1 everywhere.** `logic/task_logic.list_tasks` already batches (`map_user_ids_for_tasks`, `time_log_maps_for_user`) — that is the template. Audit every `list_*` in `logic/` for per-row `crud` calls in comprehensions (grep flagged candidates in `attachment_logic`, `notification_logic`, `analytics_logic`). Convert to batched `crud` functions that take an id list.
3. **Pagination on all list endpoints** returning unbounded rows (`/tasks`, audit, notifications, timesheet). Cursor or limit/offset; frontend requests per-view scope.
4. **Server-side filtering in SQL, never in Python** (already a CLAUDE.md rule — enforce). Add filtered `crud` functions (`tasks.list_for_project`, etc.).
5. **Response shaping:** return only fields the client needs; avoid serializing heavy relations the UI won't show.
6. **Cache expensive read models:** `task_forecast_logic` (1521 LOC) and `analytics_logic` (1263 LOC) are compute-heavy. Add a TTL cache layer (in-process LRU first; Redis if multi-instance) keyed by (scope, date-range), invalidated on relevant writes.
7. **Async where it pays:** ensure I/O-bound external calls (Microsoft JWKS, AI provider) don't block the event loop; use `httpx.AsyncClient` + caching for JWKS.
8. **GZip/compression middleware** for large JSON responses.

### Acceptance criteria
- `/tasks` p95 < 200ms and constant query count regardless of task volume.
- No endpoint returns an unbounded list.
- Analytics/forecast endpoints served from cache on repeat within TTL.

**Effort:** L

---

## B2. Database Handling — Local + Production

### Goal
One code path, environment-driven config; fast queries via correct indexes; safe migrations.

### What changes
1. **Config matrix (documented + fail-fast):**

   | Concern | Local dev | Production |
   |---|---|---|
   | Engine | Local Postgres (Docker) *or* `ZET_TEST_SQLITE=1` for quick runs | Aurora Postgres (IAM auth) |
   | Auth | password env | IAM token (`iam_token_manager`) |
   | Pool | `DB_POOL_MIN=2 / MAX=20` (env) | tuned per instance size |
   | Migrations | Alembic upgrade on boot (dev) | Alembic in deploy step (never auto in prod) |

   Keep a **single wrapper**; only connection params differ by `APP_ENV`. Document required env in `.env.example`.
2. **Adopt Alembic migrations.** Right now models exist but schema management is ad hoc (`init_db.py`). Introduce versioned migrations so local and prod converge deterministically. `init_db` becomes "run migrations."
3. **Index audit.** Confirm indexes on every FK and filter column:
   - `tasks(project_id)`, `tasks(section_id)`, `tasks(assigned_to)`, `tasks(status)`
   - `task_assignees(task_id)`, `task_assignees(user_id)`
   - `task_time_logs(task_id, user_id, log_date)` composite
   - `notifications(user_id, read)`, `audit(user_id, created_at)`
   Verify with `EXPLAIN (ANALYZE)` on the slow endpoints from B1.
4. **Read/write split usage.** Pool already separates read/write hosts — ensure read-only endpoints (analytics, lists) use the reader, writes use the writer. Audit that logic honors this.
5. **Connection scope correctness.** `get_db()` enters request scope and closes — verify no leaked connections under load; add a pool-metrics log (in-use / idle).
6. **Local dev ergonomics:** `docker-compose.yml` with a Postgres service so local mirrors prod (avoid "works on SQLite, breaks on Postgres" dialect drift). Seed script for demo data.
7. **Backups/safety (prod):** document PITR expectations; migrations gated behind review.

### Acceptance criteria
- Fresh clone → `docker compose up` → migrations run → app works locally on Postgres.
- Prod boot fails loud if IAM/secret config missing (already partly via `config.py`).
- Slow endpoints show index scans (not seq scans) in `EXPLAIN`.
- Zero leaked pool connections in a load test.

**Effort:** L

---

## B3. Backend Housekeeping
- Update `CLAUDE.md` DB section (stale SQLite reference). **S**
- Split the two mega-logic files (`task_forecast_logic` 1521, `analytics_logic` 1263) into cohesive submodules under `logic/forecast/` and `logic/analytics/` — same layer, readable pieces. Behavior-preserving. **M**
- Add per-domain `crud` batch helpers where B1 audit finds N+1. **M**

---

# PART C — DEVELOPMENT PLAN (phased delivery)

Each phase is independently shippable. Do not start a phase before the previous is merged and green. Estimated calendar assumes one engineer; parallelize FE/BE across two.

### Phase 0 — Instrumentation (½–1 day) — **do first, non-negotiable**
- Add Vite `rollup-plugin-visualizer`; capture baseline bundle report.
- Add FastAPI timing middleware + slow-query logging; capture baseline p95 for all endpoints.
- Run Lighthouse; record FCP/TTI.
- Fill in the Baseline Metrics table (§1).
- **Exit:** every number in §1 has a value.

### Phase 1 — Quick, high-visibility wins (2–3 days)
- A2 route lazy loading + vendor `manualChunks`.
- A1 token layer scaffolding (`index.css` variables + Tailwind mapping) — no full migration yet.
- B3 CLAUDE.md fix; B1 timing middleware already from Phase 0.
- **Exit:** initial bundle −50%; theme tokens exist and drive primary color.

### Phase 2 — Data & API correctness (3–5 days)
- A3 slim bootstrap + server-state ownership decision implemented.
- B1 N+1 audit + batch fixes on top 5 slow endpoints; pagination on `/tasks` + audit + notifications.
- B2 index audit + `EXPLAIN` on slow endpoints; add missing indexes.
- **Exit:** `/tasks` p95 < 200ms, constant query count; app renders after `getMe()`.

### Phase 3 — Structure & maintainability (1 week, incremental)
- A5 feature-first frontend restructure, one feature per PR (start with `tasks`).
- A3 god-file splits (store slices, types per feature).
- B3 split mega-logic files into submodules.
- B2 Alembic migrations + `docker-compose` local Postgres.
- **Exit:** feature folders in place; local dev on Postgres via compose; migrations versioned.

### Phase 4 — Polish & advanced perf (3–5 days)
- A1 full color migration (remove raw hex, add eslint rule) + theme presets.
- A4 self-host fonts, preload, image lazy-load.
- A3 list virtualization + render-hygiene pass (memo/selectors).
- B1 TTL cache on analytics/forecast; GZip; async JWKS.
- **Exit:** all §1 targets met; Lighthouse green.

### Phase 5 — Verify & document
- Re-run all Phase 0 measurements; compare against targets in §1.
- Update `CLAUDE.md` with new folder conventions + theming guide.
- Load test DB pool; confirm no leaks.
- **Exit:** before/after metrics table published; docs updated.

---

## Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Big refactor stalls feature work | Feature-first move done one folder per PR; never a long-lived branch |
| SQLite-test vs Postgres-prod dialect drift | Move local dev to Postgres via docker-compose (B2.6) |
| Theme migration misses components | Eslint `no-raw-hex` rule blocks regressions |
| Query-vs-Zustand indecision blocks A3 | Resolve in Open Questions before Phase 2 starts |
| Cache invalidation bugs (B1.6) | Start with short TTL + invalidate-on-write; measure hit rate before extending |

## Decisions (resolved 2026-07-18)
1. **Server-state owner: HYBRID.** TanStack Query owns all server state (tasks, projects, users, clients, analytics, timers — reads + mutations). Zustand shrinks to UI-only state (theme, drag bus, mascot, selectedProjectId, searchQuery). This kills the 4×-repeated `Promise.all + set` boilerplate in `appStore.ts` and turns live-sync into `invalidateQueries`.
2. **Local DB: Postgres (docker-compose).** SQLite dropped from local dev for prod parity. SQLite retained ONLY for CI unit-test speed (`ZET_TEST_SQLITE`).
3. **Tests: KEEP ALL.** All 16 backend + 2 frontend tests stay as the verify gate through the refactor. Fix/skip slow ones — do not delete. "Tests green" is the exit check for every phase.

## Open Questions (still to resolve)
4. **Multi-instance prod?** If yes, caching (B1.6) needs Redis, not in-process LRU.
5. **Theme scope:** just dark/light polish, or true multi-theme presets? Affects A1 depth.

---

## Definition of Done (whole effort)
- Every §1 target metric met and documented (before/after).
- No behavior regressions (`npm run test`, `pytest` green; manual smoke of core flows).
- `CLAUDE.md` updated: DB reality, folder conventions, theming guide.
- Each change traceable to a phase and a PR.
