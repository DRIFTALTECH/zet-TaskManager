/**
 * Kanban column palette.
 *
 * The backend stores a palette *key* per column (see `logic/kanban_logic.COLUMN_COLORS`),
 * never a hex value, so the same column reads correctly in light and dark themes and a
 * future theme change is a one-file edit here.
 *
 * Keys and their order must stay in step with the backend tuple — it uses the order to
 * auto-assign a colour to a new column, and rejects any key it does not know.
 */
export const COLUMN_COLOR_KEYS = [
  'slate',
  'violet',
  'amber',
  'sky',
  'emerald',
  'rose',
  'orange',
  'teal',
  'indigo',
  'pink',
] as const;

export type ColumnColor = (typeof COLUMN_COLOR_KEYS)[number];

export const DEFAULT_COLUMN_COLOR: ColumnColor = 'slate';

interface ColumnColorTokens {
  /** Human label for the picker. */
  name: string;
  /** Status pill: solid-ish background + readable text. */
  pill: string;
  /** Small solid dot — the pill's colour with no text on it. */
  dot: string;
  /** Faint wash behind a board column body. */
  surface: string;
  /** Text-only accent (inline "+ Add" rows, group counts). */
  accent: string;
}

const TOKENS: Record<ColumnColor, ColumnColorTokens> = {
  slate: {
    name: 'Grey',
    pill: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
    dot: 'bg-slate-400 dark:bg-slate-500',
    surface: 'bg-slate-50/60 dark:bg-slate-900/30',
    accent: 'text-slate-600 dark:text-slate-300',
  },
  violet: {
    name: 'Violet',
    pill: 'bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-200',
    dot: 'bg-violet-500',
    surface: 'bg-violet-50/60 dark:bg-violet-950/25',
    accent: 'text-violet-600 dark:text-violet-300',
  },
  amber: {
    name: 'Amber',
    pill: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
    dot: 'bg-amber-500',
    surface: 'bg-amber-50/60 dark:bg-amber-950/25',
    accent: 'text-amber-700 dark:text-amber-300',
  },
  sky: {
    name: 'Sky',
    pill: 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200',
    dot: 'bg-sky-500',
    surface: 'bg-sky-50/60 dark:bg-sky-950/25',
    accent: 'text-sky-600 dark:text-sky-300',
  },
  emerald: {
    name: 'Green',
    pill: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-200',
    dot: 'bg-emerald-500',
    surface: 'bg-emerald-50/60 dark:bg-emerald-950/25',
    accent: 'text-emerald-600 dark:text-emerald-300',
  },
  rose: {
    name: 'Rose',
    pill: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-200',
    dot: 'bg-rose-500',
    surface: 'bg-rose-50/60 dark:bg-rose-950/25',
    accent: 'text-rose-600 dark:text-rose-300',
  },
  orange: {
    name: 'Orange',
    pill: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200',
    dot: 'bg-orange-500',
    surface: 'bg-orange-50/60 dark:bg-orange-950/25',
    accent: 'text-orange-700 dark:text-orange-300',
  },
  teal: {
    name: 'Teal',
    pill: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-200',
    dot: 'bg-teal-500',
    surface: 'bg-teal-50/60 dark:bg-teal-950/25',
    accent: 'text-teal-600 dark:text-teal-300',
  },
  indigo: {
    name: 'Indigo',
    pill: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-200',
    dot: 'bg-indigo-500',
    surface: 'bg-indigo-50/60 dark:bg-indigo-950/25',
    accent: 'text-indigo-600 dark:text-indigo-300',
  },
  pink: {
    name: 'Pink',
    pill: 'bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-200',
    dot: 'bg-pink-500',
    surface: 'bg-pink-50/60 dark:bg-pink-950/25',
    accent: 'text-pink-600 dark:text-pink-300',
  },
};

/** Tokens for a stored colour key. Unknown/missing keys fall back to grey. */
export function columnColorTokens(color: string | undefined | null): ColumnColorTokens {
  const key = (color ?? '') as ColumnColor;
  return TOKENS[key] ?? TOKENS[DEFAULT_COLUMN_COLOR];
}

export function isColumnColor(value: string): value is ColumnColor {
  return (COLUMN_COLOR_KEYS as readonly string[]).includes(value);
}
