/**
 * Dashboard toolbar — shared by the list and the board.
 *
 * Both views read the same filters, so the controls live here once. Anything the
 * user has narrowed is echoed back as a removable chip: a filter you cannot see
 * is a filter you forget you set, which is how an "empty" board usually happens.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CONTROL_H } from '@/lib/field-styles';
import { ArrowUpDown, CalendarDays, ChevronDown, Flag, Group, Milestone, Search, Users, X, type LucideIcon } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import UserAvatar from '@/components/UserAvatar';
import DateRangeField from '@/components/DateRangeField';
import type { DashGroupBy, DashSortBy } from '@/lib/dash-rows';
import { NO_SPRINT_FILTER_ID, UNASSIGNED_FILTER_ID } from '@/lib/task-utils';
import type { Priority } from '@/types';

/**
 * The board's own controls sit one step above the app's field height.
 *
 * They are the thing being reached for, not a value being read, and at the
 * field height a row of bare icons was small enough to have to aim at. One step
 * up is still compact and no longer fiddly.
 */
export const TOOLBAR_H = 'h-9';

const TRIGGER =
  `flex ${CONTROL_H} shrink-0 items-center justify-between gap-1.5 rounded-lg border border-border/70 ` +
  'bg-card/70 px-2 text-xs font-medium shadow-none focus:outline-none focus:ring-2 focus:ring-ring/40';

/**
 * A square version of the same control, for the ones that carry an icon instead
 * of their value.
 *
 * The toolbar was a row of six named boxes and the board underneath got what was
 * left. Naming a control costs the width of its longest value forever; an icon
 * costs 28px and says the same thing on hover — as long as the value it holds is
 * still visible when it is set, which is what the dot below is for.
 *
 * No outline. Ten boxed squares in a row is a fence, and the bar they sit on
 * already separates them from the work; a fill on hover is enough to say which
 * one the pointer is over.
 */
export const ICON_TRIGGER =
  `tb-btn relative flex ${TOOLBAR_H} w-9 shrink-0 items-center justify-center rounded-full ` +
  'bg-foreground text-background shadow-md transition-all hover:bg-foreground/85 ' +
  'focus:outline-none disabled:opacity-40';

/** Marks an icon control that is holding a value, since the value is not shown. */
function ActiveDot() {
  return (
    <span
      aria-hidden
      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-card bg-primary"
    />
  );
}

export interface DashFilterOption {
  id: string;
  text: string;
  label?: ReactNode;
}

export function DashFilterSelect({
  allLabel,
  selected,
  onToggle,
  onClear,
  options,
  emptyText,
  open,
  onOpenChange,
  icon: Icon,
}: {
  allLabel: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  options: DashFilterOption[];
  emptyText?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  icon: LucideIcon;
}) {
  const triggerLabel = (() => {
    if (selected.size === 0) return allLabel;
    if (selected.size === 1) {
      const id = [...selected][0];
      return options.find(o => o.id === id)?.text ?? allLabel;
    }
    return `${selected.size} selected`;
  })();

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      {/* Named on hover and to a screen reader, because the icon shows what
          kind of filter this is but never what it is currently set to. */}
      <Hint label={selected.size === 0 ? allLabel : `${allLabel}: ${triggerLabel}`}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={selected.size === 0 ? allLabel : `${allLabel}: ${triggerLabel}`}
            className={ICON_TRIGGER}
          >
            <Icon className="h-4 w-4" />
            {selected.size > 0 && <ActiveDot />}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align="end"
        className="max-h-72 w-auto min-w-[14rem] overflow-hidden rounded-xl border-border/70 p-1 shadow-lg"
      >
        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          {allLabel}
        </p>
        <div className="max-h-72 overflow-y-auto">
          {options.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              {emptyText ?? 'Nothing to filter by.'}
            </p>
          ) : (
            <>
              <button
                type="button"
                onClick={onClear}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-muted ${selected.size === 0 ? 'font-semibold' : ''}`}
              >
                {allLabel}
              </button>
              {options.map(o => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => onToggle(o.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${selected.has(o.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border'}`}
                  >
                    {selected.has(o.id) ? '✓' : ''}
                  </span>
                  {o.label ?? <span className="truncate">{o.text}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function PlainSelect<T extends string>({
  value,
  onChange,
  options,
  prefix,
  icon: Icon,
  defaultValue,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; text: string }[];
  prefix: string;
  icon: LucideIcon;
  /** Anything other than this counts as "set", and gets the dot. */
  defaultValue: T;
}) {
  const current = options.find(o => o.id === value)?.text;
  return (
    <Popover>
      <Hint label={current ? `${prefix}: ${current}` : prefix}>
        <PopoverTrigger asChild>
          <button type="button" aria-label={`${prefix}: ${current ?? ''}`} className={ICON_TRIGGER}>
            <Icon className="h-4 w-4" />
            {value !== defaultValue && <ActiveDot />}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent align="end" className="w-44 rounded-xl border-border/70 p-1 shadow-lg">
        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
          {prefix}
        </p>
        {options.map(o => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`flex w-full items-center rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted ${o.id === value ? 'font-semibold' : ''}`}
          >
            {o.text}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Chip({ text, onRemove }: { text: string; onRemove: () => void }) {
  return (
    <span
      title={text}
      className="inline-flex max-w-[14rem] items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <span className="truncate">{text}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${text}`}
        className="shrink-0 rounded-full hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

const GROUP_OPTIONS: { id: DashGroupBy; text: string }[] = [
  { id: 'status', text: 'Status' },
  { id: 'assignee', text: 'Assignee' },
  { id: 'priority', text: 'Priority' },
  { id: 'none', text: 'None' },
];

const SORT_OPTIONS: { id: DashSortBy; text: string }[] = [
  { id: 'default', text: 'Default' },
  { id: 'due', text: 'Due date' },
  { id: 'priority', text: 'Priority' },
  { id: 'title', text: 'Name' },
];

export interface DashToolbarProps {
  groupBy: DashGroupBy;
  onGroupBy: (v: DashGroupBy) => void;
  sortBy: DashSortBy;
  onSortBy: (v: DashSortBy) => void;
  /** Grouping is a list-only control — the board is already grouped by column. */
  showGrouping: boolean;

  search: string;
  onSearch: (v: string) => void;

  sprintOptions: { names: string[]; hasBlank: boolean };
  sprintFilter: Set<string>;
  onToggleSprint: (id: string) => void;
  onClearSprints: () => void;

  members: { id: string; name: string; avatar: string }[];
  assigneeFilter: Set<string>;
  onToggleAssignee: (id: string) => void;
  onClearAssignees: () => void;

  priorityFilter: Set<Priority>;
  onTogglePriority: (p: Priority) => void;
  onClearPriorities: () => void;

  dateFrom: string;
  dateTo: string;
  onDateRange: (from: string, to: string) => void;

  openFilter: string | null;
  onOpenFilter: (key: string | null) => void;

  onClearAll: () => void;
  /** List/Board, moved down here beside the rest of the controls. */
  viewSwitch?: ReactNode;
  /** Rendered first — the project the board is scoped to. */
  leading?: ReactNode;
}

const PRIORITIES: Priority[] = ['Urgent', 'High', 'Medium', 'Low'];

export function DashToolbar(props: DashToolbarProps) {
  const {
    groupBy, onGroupBy, sortBy, onSortBy, showGrouping,
    search, onSearch,
    sprintOptions, sprintFilter, onToggleSprint, onClearSprints,
    members, assigneeFilter, onToggleAssignee, onClearAssignees,
    priorityFilter, onTogglePriority, onClearPriorities,
    dateFrom, dateTo, onDateRange,
    openFilter, onOpenFilter, onClearAll, viewSwitch, leading,
  } = props;

  const nameOf = (id: string) =>
    id === UNASSIGNED_FILTER_ID
      ? 'Unassigned'
      : (members.find(m => m.id === id)?.name ?? 'Unknown');

  const hasFilters =
    sprintFilter.size > 0 ||
    assigneeFilter.size > 0 ||
    priorityFilter.size > 0 ||
    !!dateFrom ||
    !!dateTo ||
    !!search.trim();

  const searchRef = useRef<HTMLInputElement>(null);
  /**
   * Closed, the bar is one control: search. Everything else unfolds on hover,
   * outward from it — so the thing you aimed at never moves under the pointer
   * while the rest arrives around it.
   *
   * It stays open while something is typed in it or a filter is on: collapsing
   * would hide the controls holding the board in the state you are reading.
   */
  const [open, setOpen] = useState(false);
  /**
   * The ball drifts to catch the eye, and stops for good once it has worked.
   *
   * Ambient motion is only useful while the control still needs introducing.
   * After that it is a moving target on the one thing that opens the whole
   * toolbar — measurably harder to hit on a trackpad, and worse for anyone
   * whose pointer is not steady.
   */
  const [everOpened, setEverOpened] = useState(false);
  const anythingSet = hasFilters || !!search.trim();
  const shown = open || anythingSet;
  useEffect(() => { if (shown) setEverOpened(true); }, [shown]);

  /** Slides in from the side it sits on, and takes no width while closed. */
  const wing = (side: 'left' | 'right') =>
    [
      'flex items-center gap-1.5 overflow-hidden transition-all duration-300 ease-out',
      shown
        ? 'max-w-[26rem] translate-x-0 opacity-100'
        : `max-w-0 opacity-0 ${side === 'left' ? '-translate-x-4' : 'translate-x-4'}`,
    ].join(' ');


  return (
    <>
      <div
        // Floating over the board, 10px off the bottom, above everything the
        // dashboard draws. Not a footer: the work runs underneath it rather
        // than stopping short, so the strip costs no height.
        className="pointer-events-none absolute inset-x-0 bottom-2.5 z-50 px-2 sm:px-3"
      >
        {/* Only the controls take the pointer — a transparent strip across the
            page would otherwise swallow every click that landed in it. */}
        <div className="mx-auto flex w-fit max-w-full flex-col items-center gap-1.5">
          {hasFilters && (
            <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5">
              {search.trim() && <Chip text={`“${search.trim()}”`} onRemove={() => onSearch('')} />}
              {[...priorityFilter].map(p => (
                <Chip key={p} text={p} onRemove={() => onTogglePriority(p)} />
              ))}
              {[...assigneeFilter].map(id => (
                <Chip key={id} text={nameOf(id)} onRemove={() => onToggleAssignee(id)} />
              ))}
              {[...sprintFilter].map(id => (
                <Chip
                  key={id}
                  text={id === NO_SPRINT_FILTER_ID ? 'No sprint' : id}
                  onRemove={() => onToggleSprint(id)}
                />
              ))}
              {(dateFrom || dateTo) && (
                <Chip
                  text={`Due ${dateFrom || '…'} → ${dateTo || '…'}`}
                  onRemove={() => onDateRange('', '')}
                />
              )}
              <button
                type="button"
                onClick={onClearAll}
                className="text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear all
              </button>
            </div>
          )}
          <div
            className={`pointer-events-auto flex max-w-full flex-nowrap items-center justify-center gap-1.5 ${
              shown ? '' : 'px-3'
            }`}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocusCapture={() => setOpen(true)}
          >
        {/* Left wing: which shape the board takes. The one control that
            changes what you are looking at rather than what is in it, so it
            leads. */}
        <span className={wing('left')}>{viewSwitch}</span>

        {/* Lifted like the cards below it, and further while it is being typed
            in — the one control on the bar you put words into should look like
            it is waiting for them. */}
        <div
          className={`tb-field flex ${TOOLBAR_H} min-w-0 shrink-0 items-center overflow-hidden rounded-full bg-foreground text-background shadow-md transition-all duration-300 ease-out focus-within:shadow-lg ${
            shown
              ? 'w-[min(70vw,22rem)] gap-2 px-4'
              : `tb-ball ${everOpened ? '' : 'tb-ball-drift'} w-9 justify-center gap-0 px-0`
          }`}
          role={shown ? undefined : 'button'}
          aria-label={shown ? undefined : 'Search and filter'}
          onClick={() => { setOpen(true); searchRef.current?.focus(); }}
        >
          <Search
            className={`h-4 w-4 shrink-0 transition-all duration-300 ${
              shown
                ? 'text-background/60'
                : 'text-background/45 [filter:drop-shadow(0_1px_1px_hsl(0_0%_0%/0.6))]'
            }`}
          />
          <input
            ref={searchRef}
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search tasks and stories…"
            aria-label="Search tasks and stories"
            onKeyDown={e => {
              // Nothing to close any more, so Escape does the one useful thing
              // left: drop the query.
              if (e.key === 'Escape') onSearch('');
            }}
            className={`min-w-0 bg-transparent text-sm text-background placeholder:text-background/50 focus:outline-none ${
              shown ? 'flex-1' : 'w-0 flex-none opacity-0'
            }`}
            tabIndex={shown ? undefined : -1}
          />
          {!!search && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => { onSearch(''); searchRef.current?.focus(); }}
              className="shrink-0 rounded-full p-0.5 text-background/60 hover:bg-background/15 hover:text-background"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Right wing: what the board is scoped to, then how the work in it is
            arranged and narrowed. */}
        <span className={wing('right')}>
          {leading}
          {showGrouping && (
            <PlainSelect
              prefix="Group"
              icon={Group}
              defaultValue={'status' as DashGroupBy}
              value={groupBy}
              onChange={onGroupBy}
              options={GROUP_OPTIONS}
            />
          )}
          <PlainSelect
            prefix="Sort"
            icon={ArrowUpDown}
            defaultValue={'default' as DashSortBy}
            value={sortBy}
            onChange={onSortBy}
            options={SORT_OPTIONS}
          />
          <DashFilterSelect
            icon={Milestone}
            allLabel="All sprints"
            open={openFilter === 'sprint'}
            onOpenChange={o => onOpenFilter(o ? 'sprint' : null)}
            selected={sprintFilter}
            onToggle={onToggleSprint}
            onClear={onClearSprints}
            emptyText="No sprints on this work yet."
            options={[
              ...(sprintOptions.hasBlank ? [{ id: NO_SPRINT_FILTER_ID, text: 'No sprint' }] : []),
              ...sprintOptions.names.map(name => ({ id: name, text: name })),
            ]}
          />
          <DashFilterSelect
            icon={Users}
            allLabel="All people"
            open={openFilter === 'people'}
            onOpenChange={o => onOpenFilter(o ? 'people' : null)}
            selected={assigneeFilter}
            onToggle={onToggleAssignee}
            onClear={onClearAssignees}
            emptyText="No team members in this view."
            options={[
              { id: UNASSIGNED_FILTER_ID, text: 'Unassigned' },
              ...members.map(u => ({
                id: u.id,
                text: u.name,
                label: (
                  <>
                    <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                    <span className="truncate">{u.name}</span>
                  </>
                ),
              })),
            ]}
          />
          <DashFilterSelect
            icon={Flag}
            allLabel="All priorities"
            open={openFilter === 'priority'}
            onOpenChange={o => onOpenFilter(o ? 'priority' : null)}
            selected={priorityFilter as Set<string>}
            onToggle={id => onTogglePriority(id as Priority)}
            onClear={onClearPriorities}
            options={PRIORITIES.map(p => ({ id: p, text: p }))}
          />
          <DateRangeField
            iconOnly
            // Matches the buttons it stands beside; twMerge lets the size win.
            className="tb-btn"
            from={dateFrom}
            to={dateTo}
            onChange={onDateRange}
            placeholder="Any due date"
          />
        </span>
          </div>
        </div>
      </div>
    </>
  );
}

export default DashToolbar;
