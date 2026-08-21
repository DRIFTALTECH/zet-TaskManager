/**
 * Shared date-range presets for the timesheet, calendar, and report pages.
 *
 * These pages used to hard-code their own period logic — the timesheet and
 * calendar could only step a week at a time. Range selection now lives here so
 * all three agree on what "this month" means and on how stepping works.
 *
 * Every range is a pair of inclusive local-date ISO strings (YYYY-MM-DD).
 * Timesheet dates are wall-clock local dates, never UTC instants, so all
 * arithmetic here stays in local time.
 */

/** Widest span the API will read in one request — mirrors MAX_RANGE_DAYS on the server. */
export const MAX_RANGE_DAYS = 400;

export type RangePresetId = 'all' | 'day' | 'week' | 'lastweek' | 'month' | 'last7' | 'last30' | 'custom';

export interface DateRangeValue {
  start: string;
  end: string;
}

/** A custom selection in progress: the end is absent until the second click. */
export interface PartialDateRange {
  start: string;
  end?: string;
}

export interface RangeSelection {
  preset: RangePresetId;
  /** How many whole periods to step back (positive) or forward (negative is future). */
  offset: number;
  /** Only meaningful when preset === 'custom'. `end` is unset mid-selection. */
  custom?: PartialDateRange;
}

export const RANGE_PRESETS: { id: RangePresetId; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'lastweek', label: 'Last week' },
  { id: 'month', label: 'This month' },
  { id: 'last7', label: 'Last 7 days' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom range' },
];

/** Local-date ISO string. Avoids toISOString(), which shifts to UTC. */
export function toIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parse an ISO date as local noon, so DST transitions cannot move the day. */
export function fromIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

export function todayIso(): string {
  return toIso(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + days);
  return toIso(d);
}

/** Monday of the ISO week containing `iso`. */
export function weekMonday(iso: string): string {
  const d = fromIso(iso);
  const dow = d.getDay(); // 0 = Sunday
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
  return toIso(d);
}

export function daysBetween(start: string, end: string): number {
  const ms = fromIso(end).getTime() - fromIso(start).getTime();
  return Math.round(ms / 86_400_000) + 1; // inclusive
}

/** Every date in the range, inclusive. Used to build day columns and lists. */
export function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * Resolve a selection to concrete dates.
 *
 * `offset` steps by whole periods: for 'month' it moves calendar months (so
 * stepping back from 31 March lands on all of February, not on 3 March), and for
 * the day-count presets it moves by that many days.
 */
/** Lower bound for the "All time" preset — comfortably before any real data. */
const ALL_TIME_START = '2000-01-01';

export function resolveRange(sel: RangeSelection): DateRangeValue {
  const { preset, offset, custom } = sel;
  const today = new Date();

  if (preset === 'all') {
    // Wide enough to mean "no filter" while still being a concrete range, so
    // callers never need to special-case a missing bound.
    return { start: ALL_TIME_START, end: addDays(todayIso(), 365) };
  }

  if (preset === 'custom') {
    if (custom?.start) {
      const start = custom.start;
      const end = custom.end && custom.end >= start ? custom.end : start;
      return { start, end };
    }
    // No custom range chosen yet — fall back to this week rather than nothing.
    const monday = weekMonday(todayIso());
    return { start: monday, end: addDays(monday, 6) };
  }

  if (preset === 'day') {
    const d = addDays(todayIso(), offset);
    return { start: d, end: d };
  }

  if (preset === 'week' || preset === 'lastweek') {
    // 'lastweek' is simply the week preset anchored one week back; the arrows then
    // step from there like any other period.
    const base = preset === 'lastweek' ? -1 : 0;
    const monday = addDays(weekMonday(todayIso()), (offset + base) * 7);
    return { start: monday, end: addDays(monday, 6) };
  }

  if (preset === 'month') {
    const anchor = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const start = toIso(anchor);
    const end = toIso(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0));
    return { start, end };
  }

  // Rolling windows ending today (or shifted whole windows when stepped).
  const span = preset === 'last7' ? 7 : 30;
  const end = addDays(todayIso(), offset * span);
  return { start: addDays(end, -(span - 1)), end };
}

/** Human label for the resolved range, e.g. "3 – 9 Mar 2026" or "March 2026". */
export function formatRangeLabel(range: DateRangeValue, preset: RangePresetId): string {
  if (preset === 'all') return 'All time';

  const s = fromIso(range.start);
  const e = fromIso(range.end);

  if (range.start === range.end) {
    return s.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // A full calendar month reads better by name than as two dates.
  if (preset === 'month') {
    return s.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  const sameYear = s.getFullYear() === e.getFullYear();
  const sameMonth = sameYear && s.getMonth() === e.getMonth();

  if (sameMonth) {
    return `${s.getDate()} – ${e.getDate()} ${e.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  }
  if (sameYear) {
    return `${s.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${e.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

/** Mondays of every ISO week the range touches — submission is still per-week. */
export function weeksInRange(range: DateRangeValue): string[] {
  const out: string[] = [];
  let monday = weekMonday(range.start);
  const lastMonday = weekMonday(range.end);
  while (monday <= lastMonday) {
    out.push(monday);
    monday = addDays(monday, 7);
  }
  return out;
}

/** True when the range is longer than the server will read in one request. */
export function rangeTooLong(range: DateRangeValue): boolean {
  return daysBetween(range.start, range.end) > MAX_RANGE_DAYS;
}
