/**
 * Page-level layout tokens — the density the dashboard set, in one place.
 *
 * Every page had grown its own header: a 32px gradient-clipped title over a
 * tinted band with `px-8 pt-7 pb-5` of padding, plus `h-9`/`py-2` chips beside
 * it. That is roughly 140px of chrome before the first row of content, on a
 * screen whose whole job is showing rows. The dashboard dropped to a `text-lg`
 * title and `h-7` controls and became noticeably easier to scan; these tokens
 * are that decision, named, so the rest of the app can share it.
 *
 * Pairs with CONTROL_H in lib/field-styles — controls are `h-7`, and the header
 * is sized so a title and a filter chip look like the same weight of thing.
 */

/** Outer padding for a page that scrolls its whole body. */
export const PAGE_PAD = 'p-3 sm:p-4';

/** Outer padding for a page whose header is fixed and whose body scrolls. */
export const PAGE_PAD_X = 'px-3 sm:px-4';

/** A page that fills the viewport and scrolls internally (board, tables). */
export const PAGE_SHELL = `relative ${PAGE_PAD} h-full flex flex-col overflow-hidden`;

/** A page that grows with its content and scrolls in the main region. */
export const PAGE_SHELL_SCROLL = `relative ${PAGE_PAD} min-h-full flex flex-col`;

/** Page title. One step above body text, not three. */
export const PAGE_TITLE = 'text-lg font-bold text-foreground truncate';

/** Supporting line under a page title. */
export const PAGE_SUBTITLE = 'text-xs text-muted-foreground';

/** Section heading inside a page (a card's title, a chart's caption). */
export const SECTION_TITLE = 'text-sm font-semibold text-foreground';

/**
 * A read-only stat/count pill sitting beside a page title.
 * Matches the toolbar chips rather than the old `px-3 py-1.5 rounded-xl` badge.
 */
export const PAGE_CHIP =
  'inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 text-xs font-medium text-muted-foreground';

/**
 * Segmented control — the list/board switch on the dashboard, generalised.
 * `SEGMENT_BAR` wraps the buttons; each button takes SEGMENT_BTN(active).
 */
export const SEGMENT_BAR =
  'inline-flex h-7 shrink-0 rounded-lg border border-border/70 bg-card/70 p-0.5';

export const SEGMENT_BTN = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;

/** Icon size inside a segmented button or page chip. */
export const SEGMENT_ICON = 'h-3.5 w-3.5';

/** Card surface used by page content blocks. */
export const PAGE_CARD = 'rounded-xl border border-border/50 bg-card/60 p-3';
