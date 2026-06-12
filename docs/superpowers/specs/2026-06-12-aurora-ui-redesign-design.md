# ZET "Aurora Console" UI Redesign — Design Spec

**Date:** 2026-06-12
**Status:** Executed autonomously (user requested wow-factor recreation of the UI; design direction chosen from the existing brand mark).

## Goal

Recreate the ZET frontend with a distinctive, premium visual identity. The current UI is a flat
monochrome grayscale theme on Inter. The ZET logo already uses an indigo→violet gradient that the
theme ignores; the redesign builds the whole design system around it.

## Direction: "Aurora Console"

- **Theme:** Ink-dark default (deep indigo-tinted near-black) and a porcelain light theme.
  Neutrals are hue-tinted (indigo cast), never pure gray.
- **Brand:** Electric indigo (`#6366f1`) → violet (`#7c3aed`) gradient, used for primary actions,
  active nav, focus rings, and ambient background glows.
- **Typography:** Bricolage Grotesque (display/headings), Schibsted Grotesk (body),
  JetBrains Mono (task IDs, timers, dates).
- **Atmosphere:** Fixed ambient aurora layer (two blurred radial gradients + subtle noise) behind
  the app shell; glass surfaces for navbar/sidebar.
- **Motion:** Existing snappy tween system kept; added staggered page-load reveals, animated nav
  active indicator (framer-motion `layoutId`), hover glows.

## Scope

1. **Design tokens** (`index.css`, `tailwind.config.ts`) — full rewrite of CSS variables both
   themes, fonts, keyframes, shadows, aurora/glass/glow utilities. This restyles every page.
2. **App shell** — `AppSidebar` (glass, gradient active pill, animated indicator, brand footer),
   `AppNavbar` (glass, page title, restyled project picker, animated theme toggle), `App.tsx`
   layout (aurora background layer).
3. **Dashboard** — header with display-font title + live stat chips (total / due today / overdue),
   kanban columns with per-column accent colors and tinted headers, refined task cards
   (gradient hairline, glow hover, mono metadata), polished drag overlay and empty column state.
4. **My Tasks** — project groups as cards with progress bars, refined task rows, stagger entrance.
5. **Brand** — `ZetLogo` glow + display font.

Deep pages (Timesheet, UserDetail, ManageEmployees, TimeReport, Users, Settings, Audit) are
restyled implicitly via the token layer; no structural changes there in this pass.

## Non-goals

- No backend/API changes. No route, store, or data-flow changes.
- No behavior changes to drag-and-drop, timers, approvals, auth.

## Verification

`npm run build`, `npm run lint`, `npm run test` in `/frontend` must pass.
