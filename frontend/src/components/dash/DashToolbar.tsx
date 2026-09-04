/**
 * Dashboard toolbar — shared by the list and the board.
 *
 * Both views read the same filters, so the controls live here once. Anything the
 * user has narrowed is echoed back as a removable chip: a filter you cannot see
 * is a filter you forget you set, which is how an "empty" board usually happens.
 */
import type { ReactNode } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import UserAvatar from '@/components/UserAvatar';
import DateRangeField from '@/components/DateRangeField';
import type { DashGroupBy, DashSortBy } from '@/lib/dash-rows';
import { NO_SPRINT_FILTER_ID, UNASSIGNED_FILTER_ID } from '@/lib/task-utils';
import type { Priority } from '@/types';

const TRIGGER =
  'flex h-8 shrink-0 items-center justify-between gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 text-xs font-medium shadow-none focus:outline-none focus:ring-2 focus:ring-ring/40';

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
}: {
  allLabel: string;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onClear: () => void;
  options: DashFilterOption[];
  emptyText?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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
      <PopoverTrigger asChild>
        <button type="button" className={`${TRIGGER} w-[min(40vw,9rem)] sm:w-32 text-left`}>
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="max-h-72 w-auto min-w-[14rem] overflow-hidden rounded-xl border-border/70 p-1 shadow-lg"
      >
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
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; text: string }[];
  prefix: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={TRIGGER}>
          <span className="truncate">
            <span className="text-muted-foreground">{prefix}: </span>
            {options.find(o => o.id === value)?.text}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-44 rounded-xl border-border/70 p-1 shadow-lg">
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
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      {text}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${text}`}
        className="rounded-full hover:text-foreground"
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
  /** Rendered at the end of the control row — the view's own Add button. */
  trailing?: ReactNode;
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
    openFilter, onOpenFilter, onClearAll, trailing,
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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {showGrouping && (
          <PlainSelect prefix="Group" value={groupBy} onChange={onGroupBy} options={GROUP_OPTIONS} />
        )}
        <PlainSelect prefix="Sort" value={sortBy} onChange={onSortBy} options={SORT_OPTIONS} />

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search…"
            className="h-8 w-[min(45vw,11rem)] rounded-lg border-border/70 bg-card/70 pl-8 text-xs"
          />
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DashFilterSelect
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
            allLabel="All priorities"
            open={openFilter === 'priority'}
            onOpenChange={o => onOpenFilter(o ? 'priority' : null)}
            selected={priorityFilter as Set<string>}
            onToggle={id => onTogglePriority(id as Priority)}
            onClear={onClearPriorities}
            options={PRIORITIES.map(p => ({ id: p, text: p }))}
          />
          <DateRangeField
            from={dateFrom}
            to={dateTo}
            onChange={onDateRange}
            placeholder="Any due date"
          />
          {trailing}
        </div>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5">
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
    </div>
  );
}

export default DashToolbar;
