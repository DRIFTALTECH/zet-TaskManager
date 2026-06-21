# ZET Agent Mascots — reference

The 4 animated mascot characters, their domains, and **where each is meant to live**.
Read this before touching anything under `src/components/agents/`.

## The 4 agents

| Color | Id | Name | Domain | Lives on (routes) |
|-------|------|--------|------------------------------------------------|-------------------|
| ⬛ Black | `tasker` | **Tasker** | Extract / create / assign / move tasks | `/` (Dashboard) — **placed**. Also drives the Create-tasks popup ("thinking") wherever that modal opens. |
| 🟧 Orange | `tracky` | **Tracky** | Timesheet & time tracking | `/timesheet`, `/reports`, `/calendar` — **planned, not placed** |
| 🟨 Yellow | `pilot` | **Pilot** | Project management — projects, members, sections; flags overdue / over-estimate tasks | `/manage`, `/manage/:projectId`, `/users` — **planned, not yet placed** |
| 🟣 Purple | `zani` | **Zani** | Personal assistant — explains, answers | `/ai` ONLY — **placed**. Never elsewhere. |

### Placement rules (important)
- **One companion at a time.** The bottom-right `Companion` picks the agent by route: `/` → Tasker, `/ai` → Zani, everything else → nothing (returns null).
- **Zani is `/ai`-only.** Do not show Zani on other pages.
- When Tracky/Pilot get placed, extend the route→agent mapping in `Companion.tsx` (the `agent` derivation). Keep "one at a time" — never two mascots on screen.
- The mascot is **fixed** in its bottom-right corner: no dragging the avatar itself, no hide/peek, no idle "are you there?" nagging. (These were tried and explicitly removed.)

## Behaviors (current)
- **Click the mascot → opens the Create-tasks popup** (`TaskCreatorModal` from `@/pages/AIPage`). The mascot replaced the old navbar "Create tasks" button.
- **Event reactions** (brief, in-place, no caption cards, single-at-a-time): driven by `agentEvent` in the store.
  - `task_created` / `task_assigned` → notebook scribble
  - `task_approved` → thumbs-up
  - `task_moved` → card hops between columns
  - `timer_started` → stopwatch
  - `timer_stopped` → notebook (logging into timesheet)
- **Ground-attached**: sits flush at the bottom with a shadow + subtle breathing (transform-origin bottom).
- **Settings toggle**: `mascotsEnabled` in the store (persisted as `localStorage 'mascots'`), toggled in Settings → Appearance. `false` → no mascot at all.
- **Reduced motion**: `prefers-reduced-motion` → static avatar, no breathing/animations.

### Tasker hub (Dashboard) — wired in `Companion.tsx`
- Click → action menu: create tasks · start top task · overdue list · summarize my day (AI) · notifications.
- Attention badge: overdue (rose) / long timer (amber) / unread (violet).
- Drag a kanban card onto Tasker → quick actions (Start timer / Mark done). Tasks are owned by one user, so there is **no "assign to me"**.
- Celebration: confetti when ALL my tasks sit in the Done column (transition-only — never on initial load).

> Note: this table is the source of truth for *identity + placement*; the component (`Companion.tsx`) is the source of truth for *current behavior*.

## The event bus (how to trigger a reaction)
Store (`src/stores/appStore.ts`):
- `agentEvent: { kind: AgentEventKind; seq: number } | null`
- `emitAgentEvent(kind)` — call from a store action after the mutation succeeds; `seq` is a monotonic counter so repeats always re-fire.
- `AgentEventKind = 'task_created' | 'task_assigned' | 'task_approved' | 'task_moved' | 'timer_started' | 'timer_stopped'`
- Already emitted from: `createTask`, `updateTask` (section-move → `task_moved`, new assignee → `task_assigned`), `moveTask`, `approveTask`, `startTimer`, `stopTimer`.
- To add a new reaction: add the kind to `AgentEventKind`, emit it from the relevant store action, then map it → a `Reaction` in `Companion.tsx`.

## Moods (AgentAvatar)
`AgentMood = idle | happy | busy | alert | talking | thinking | sad | angry | ouch`.
`AgentAvatar.tsx` renders the body shape + cursor-tracking pupils + blink + mood-driven mouth/eyebrows. Shapes: `tallRect` (Tasker, Zani), `dome` (Tracky), `tallDome` (Pilot) — defined in `agents.ts`.

## File map (`src/components/agents/`)
- `agents.ts` — agent definitions (id, name, shape, colors, eyeY, domain), `AgentMood`/`AgentShape` types, route→agent helper, idle tip strings.
- `AgentAvatar.tsx` — the SVG avatar (presentational): shapes, blink, eye-tracking, moods.
- `Companion.tsx` — the single global mascot overlay mounted in `AppLayout` (`src/App.tsx`). Route-aware agent pick. Owns the **Tasker** hub (Dashboard) + **Zani** (`/ai`). **This is where Tracky/Pilot placement gets added.**
- `TaskerThinking.tsx` — Tasker "thinking" loader shown inside the Create-tasks modal while the AI extracts tasks (replaces the old generic spinner).
- `shared.ts` — shared helpers/hook: `usePrefersReducedMotion`, `fmtDur`.
- `shared-ui.tsx` — shared presentational bits: `MenuItem`, `Stat`.
- `confetti.ts` — dependency-free canvas confetti burst (`burstConfetti`).
- `AGENTS.md` — this file.

## Where it's mounted
`src/App.tsx` → `AppLayout` renders `<Companion />` once, below `<main>`. It is NOT per-page. The store toggle + route logic decide visibility.
