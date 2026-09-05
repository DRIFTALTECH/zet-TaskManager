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
/**
 * Height of a compact control.
 *
 * The detail field grid and the dashboard toolbar share it so a filter chip and
 * a task field read as the same size of thing. Changing the density of the app
 * is this one value plus the row min-height beside it.
 */
export const CONTROL_H = 'h-7';

/** Row height that matches CONTROL_H, for grids and list rows. */
export const ROW_MIN_H = 'min-h-7';

export const FIELD_GRID = [
  'grid grid-cols-1 gap-x-5 gap-y-0 sm:grid-cols-2 lg:grid-cols-3',
  '[&>section]:grid [&>section]:grid-cols-[5.5rem_minmax(0,1fr)] [&>section]:items-center',
  '[&>section]:gap-2 [&>section]:min-h-7',
  '[&>section>div:first-child]:mb-0 [&>section>div:first-child]:text-[11px]',
  '[&>section>div:first-child_svg]:h-3 [&>section>div:first-child_svg]:w-3',
  // Values sit one step below body text. A detail modal shows a dozen of these
  // at once, so a field set that reads comfortably on its own still pushes the
  // description and comments off screen.
  '[&>section>*:last-child]:text-[13px]',
  // Controls shrink to the row rather than the row growing to fit a 40px select.
  // That single default was most of the height: twelve fields, twelve h-10 rows.
  '[&_[role=combobox]]:h-7 [&_[role=combobox]]:px-2 [&_[role=combobox]]:text-[13px]',
  '[&_input]:h-7 [&_input]:px-2 [&_input]:py-0 [&_input]:text-[13px]',
  '[&_input]:border-transparent [&_input]:bg-transparent [&_input]:shadow-none',
  '[&_input:hover]:bg-muted/60 [&_input:focus]:bg-muted/60 [&_input:focus]:border-border/60',
  '[&_[role=combobox]]:border-transparent [&_[role=combobox]]:bg-transparent',
  '[&_[role=combobox]:hover]:bg-muted/60',
  // Selects came with a heavy offset ring on plain `focus`, so clicking one
  // stamped a thick dark outline around it while the input beside it just
  // tinted. Same treatment for both, and the ring is kept for `focus-visible`
  // where it is doing its actual job — showing a keyboard where it is.
  '[&_[role=combobox]:focus]:bg-muted/60 [&_[role=combobox]:focus]:border-border/60',
  '[&_[role=combobox]:focus]:ring-0 [&_[role=combobox]:focus]:ring-offset-0',
  '[&_[role=combobox]:focus-visible]:ring-2 [&_[role=combobox]:focus-visible]:ring-primary/30',
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

/**
 * An icon button on a detail modal's header row — save, discard, generate,
 * delete. These used to be a full-width footer band across the bottom of every
 * modal, which cost a row of height on every screen to hold two buttons that
 * are only live while there are unsaved edits.
 */
export const MODAL_HEADER_ACTION =
  'rounded-xl p-2.5 text-muted-foreground/50 transition-all duration-150 hover:bg-muted/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-25';

/** The one that commits — tinted so it reads as the primary action. */
export const MODAL_HEADER_ACTION_PRIMARY =
  'rounded-xl p-2.5 text-primary transition-all duration-150 hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-25';
