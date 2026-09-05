/**
 * Editable cells for the dashboard list.
 *
 * Each one shows the current value and opens a popover to change it, so the
 * common edits — reassign, move status, bump priority, set a date — happen on
 * the row instead of via the detail modal.
 *
 * Every trigger stops propagation: the row itself is a button that opens the
 * detail modal, and clicking a cell must edit the cell, not open the modal.
 */
import { useState, type ReactNode } from 'react';
import { CalendarPlus, Flag, UserPlus2, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import UserAvatar from '@/components/UserAvatar';
import { Hint } from '@/components/ui/hint';
import { columnColorTokens } from '@/lib/column-colors';
import { priorityTextClass } from '@/lib/priority-styles';
import {
  dueBucketDateTextClass,
  getDueBucket,
  localISODateFromDate,
  parseLocalISODate,
} from '@/lib/due-date-utils';
import type { KanbanColumn, Priority } from '@/types';

export interface DashUser {
  id: string;
  name: string;
  avatar: string;
}

/** Placeholder for an unset value: faint at rest, clearer on row hover. */
const GHOST = 'h-3.5 w-3.5 text-muted-foreground/35 group-hover:text-muted-foreground/70';

const TRIGGER =
  'flex min-w-0 max-w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted';

const PRIORITIES: Priority[] = ['Urgent', 'High', 'Medium', 'Low'];

export function CellPopover({
  trigger,
  children,
  align = 'start',
  className = 'w-52',
  hint,
}: {
  trigger: ReactNode;
  children: (close: () => void) => ReactNode;
  align?: 'start' | 'end';
  className?: string;
  /** Names the cell on hover — most of these are a bare glyph until they are set. */
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <Hint label={open ? '' : hint}>
        <PopoverTrigger asChild>
          {/* Named from the same hint the tooltip shows: unset, most of these
              are a bare glyph, which leaves a screen reader announcing only
              "button" and a test no way to reach the right one. */}
          <button
            type="button"
            aria-label={hint}
            className={TRIGGER}
            onClick={e => e.stopPropagation()}
          >
            {trigger}
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent
        align={align}
        onClick={e => e.stopPropagation()}
        className={`max-h-72 overflow-y-auto rounded-xl border-border/70 p-1 shadow-lg ${className}`}
      >
        {children(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

export function Option({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted ${active ? 'font-semibold' : ''}`}
    >
      {children}
    </button>
  );
}

export function AssigneeCell({
  assigneeIds,
  members,
  onChange,
}: {
  assigneeIds: string[];
  members: DashUser[];
  onChange: (ids: string[]) => void;
}) {
  const assignees = assigneeIds
    .map(id => members.find(u => u.id === id))
    .filter(Boolean) as DashUser[];

  const toggle = (id: string) => {
    onChange(
      assigneeIds.includes(id) ? assigneeIds.filter(x => x !== id) : [...assigneeIds, id],
    );
  };

  return (
    <CellPopover
      hint="Assignee"
      trigger={
        assignees.length === 0 ? (
          <UserPlus2 className={GHOST} />
        ) : (
          <span className="flex -space-x-1.5">
            {assignees.slice(0, 3).map(u => (
              <UserAvatar
                key={u.id}
                name={u.name}
                avatar={u.avatar}
                size="xs"
                className="ring-2 ring-background"
              />
            ))}
          </span>
        )
      }
    >
      {() => (
        <>
          {members.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nobody is on this project yet.
            </p>
          ) : (
            <>
              {assigneeIds.length > 0 && (
                <Option onClick={() => onChange([])}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                  Clear assignees
                </Option>
              )}
              {members.map(u => (
                <Option key={u.id} active={assigneeIds.includes(u.id)} onClick={() => toggle(u.id)}>
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[9px] ${
                      assigneeIds.includes(u.id)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border'
                    }`}
                  >
                    {assigneeIds.includes(u.id) ? '✓' : ''}
                  </span>
                  <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                  <span className="truncate">{u.name}</span>
                </Option>
              ))}
            </>
          )}
        </>
      )}
    </CellPopover>
  );
}

export function StatusCell({
  status,
  columns,
  doneColumnId,
  onChange,
}: {
  status: string;
  columns: KanbanColumn[];
  doneColumnId: string;
  onChange: (status: string) => void;
}) {
  const id = status === 'completed' ? doneColumnId : status;
  const current = columns.find(c => c.id === id);
  const tokens = columnColorTokens(current?.color);
  return (
    <CellPopover
      hint="Status"
      trigger={
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${tokens.dot}`} aria-hidden />
          <span className={`truncate text-[11px] font-medium ${tokens.accent}`}>
            {current?.label ?? status.replace(/_/g, ' ') ?? 'Backlog'}
          </span>
        </>
      }
    >
      {close =>
        columns.map(c => (
          <Option
            key={c.id}
            active={c.id === id}
            onClick={() => {
              close();
              if (c.id !== id) onChange(c.id);
            }}
          >
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${columnColorTokens(c.color).dot}`}
              aria-hidden
            />
            <span className="truncate">{c.label}</span>
          </Option>
        ))
      }
    </CellPopover>
  );
}

export function PriorityCell({
  priority,
  onChange,
}: {
  priority: Priority;
  onChange: (p: Priority) => void;
}) {
  return (
    <CellPopover
      className="w-36"
      hint="Priority"
      trigger={
        <span className={`flex min-w-0 items-center gap-1.5 ${priorityTextClass[priority]}`}>
          <Flag className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
          <span className="truncate text-[11px] font-medium">{priority}</span>
        </span>
      }
    >
      {close =>
        PRIORITIES.map(p => (
          <Option
            key={p}
            active={p === priority}
            onClick={() => {
              close();
              if (p !== priority) onChange(p);
            }}
          >
            <Flag className={`h-3.5 w-3.5 shrink-0 ${priorityTextClass[p]}`} fill="currentColor" />
            <span className={`text-[11px] font-medium ${priorityTextClass[p]}`}>{p}</span>
          </Option>
        ))
      }
    </CellPopover>
  );
}

export function DueDateCell({
  dueDate,
  isDone,
  onChange,
}: {
  dueDate: string;
  isDone: boolean;
  onChange: (iso: string) => void;
}) {
  const value = dueDate?.trim() ?? '';
  const selected = value ? parseLocalISODate(value) : undefined;
  return (
    <CellPopover
      align="end"
      className="w-auto p-0"
      hint="Due date"
      trigger={
        value ? (
          <span
            className={`tabular-nums text-[12px] ${dueBucketDateTextClass(getDueBucket(value), isDone)}`}
          >
            {new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        ) : (
          <CalendarPlus className={GHOST} />
        )
      }
    >
      {close => (
        <>
          <Calendar
            mode="single"
            selected={selected}
            onSelect={date => {
              if (!date) return;
              close();
              onChange(localISODateFromDate(date));
            }}
            initialFocus
          />
          {value && (
            <div className="border-t border-border/60 p-1">
              <Option
                onClick={() => {
                  close();
                  onChange('');
                }}
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
                Clear due date
              </Option>
            </div>
          )}
        </>
      )}
    </CellPopover>
  );
}

/** "4h" / "12h" — one decimal below ten, whole hours above, so the column stays narrow. */
function formatHours(h: number): string {
  return h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`;
}

/**
 * Estimate against time tracked. Read-only: actual hours come from timers, the
 * timesheet, and the prompt shown when work moves to Done — never from typing
 * into the list, which would silently disagree with those.
 *
 * Story rows show the roll-up of their whole subtree.
 */
export function TimeCell({
  estimatedHours,
  actualHours,
}: {
  estimatedHours: number | null;
  actualHours: number;
}) {
  const hasEstimate = estimatedHours != null && estimatedHours > 0;
  const hasActual = actualHours > 0;
  if (!hasEstimate && !hasActual) {
    return <span className="text-[11px] text-muted-foreground/35">—</span>;
  }
  const over = hasEstimate && hasActual && actualHours > estimatedHours!;
  return (
    <span className="truncate text-[11px] tabular-nums text-muted-foreground/75">
      {hasEstimate ? formatHours(estimatedHours!) : '—'}
      <span className="px-0.5 text-muted-foreground/40">·</span>
      <span
        className={
          over ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground'
        }
        title={over ? 'Over estimate' : undefined}
      >
        {hasActual ? formatHours(actualHours) : '—'}
      </span>
    </span>
  );
}
