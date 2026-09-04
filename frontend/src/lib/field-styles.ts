/**
 * Field styling tokens — the app's form language in one place.
 *
 * Two rules, both learned from the detail modals:
 *
 * 1. Labels are uniform and quiet. Per-field accent colours turn a form into a
 *    rainbow and stop the label column reading as a column.
 * 2. Inside a field grid, values read as text: borders and fills appear on hover
 *    and focus only. A screen of boxed inputs makes every field look equally
 *    urgent.
 */

/**
 * Wraps a set of `<section><FieldLabel/>{value}</section>` blocks into aligned
 * label→value rows. A value that renders more than one element must wrap them in
 * a single div, or the extras land in their own grid cells.
 */
export const FIELD_GRID = [
  'grid grid-cols-1 gap-x-8 gap-y-0 lg:grid-cols-2',
  '[&>section]:grid [&>section]:grid-cols-[6.5rem_minmax(0,1fr)] [&>section]:items-center',
  '[&>section]:gap-3 [&>section]:min-h-8',
  '[&>section>div:first-child]:mb-0 [&>section>div:first-child]:text-xs',
  '[&_input]:border-transparent [&_input]:bg-transparent [&_input]:shadow-none',
  '[&_input:hover]:bg-muted/60 [&_input:focus]:bg-muted/60 [&_input:focus]:border-border/60',
  '[&_[role=combobox]]:border-transparent [&_[role=combobox]]:bg-transparent',
  '[&_[role=combobox]:hover]:bg-muted/60',
].join(' ');

/**
 * Added to FIELD_GRID to collapse fields that carry no value. A detail modal
 * that lists every empty date and tag slot pushes the description and comments
 * off screen, so empty rows stay hidden until the reader asks for them; each
 * `<section>` opts in by setting `data-empty`.
 */
export const HIDE_EMPTY_FIELDS = '[&>section[data-empty=true]]:hidden';

/** Ghost styling for a single control sitting outside a FIELD_GRID. */
export const GHOST_FIELD =
  'border-transparent bg-transparent shadow-none transition-colors hover:bg-muted/60 focus:bg-muted/60 focus:border-border/60';

/**
 * Standalone form control (dialogs, settings, filters) — the boxed sibling of
 * FIELD_GRID's ghost inputs. Seven files had grown their own near-identical
 * `inputCls`, differing only in padding; this is that string, once.
 */
export const FIELD_INPUT =
  'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm transition-all placeholder:text-muted-foreground/40 focus:border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/40';
