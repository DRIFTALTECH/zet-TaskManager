/**
 * Bulk edit bar for the dashboard list.
 *
 * Appears once rows are ticked. The same four edits the row cells offer, applied
 * to everything selected — reassigning ten tasks one row at a time is the thing
 * this replaces.
 */
import { CalendarPlus, Flag, Trash2, UserPlus2, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import UserAvatar from '@/components/UserAvatar';
import { CellPopover, Option, type DashUser } from '@/components/dash/DashCells';
import { columnColorTokens } from '@/lib/column-colors';
import { priorityTextClass } from '@/lib/priority-styles';
import { localISODateFromDate } from '@/lib/due-date-utils';
import type { DashRow } from '@/lib/dash-rows';
import type { DashRowPatch } from '@/components/dash/DashTable';
import type { KanbanColumn, Priority } from '@/types';

const PRIORITIES: Priority[] = ['Urgent', 'High', 'Medium', 'Low'];

const ACTION =
  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground/80 hover:bg-muted';

export function DashBulkBar({
  rows,
  columns,
  members,
  onApply,
  onDelete,
  onClear,
}: {
  rows: DashRow[];
  columns: KanbanColumn[];
  /** People assignable to every selected row — empty hides the assignee action. */
  members: DashUser[];
  onApply: (patch: DashRowPatch) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  if (rows.length === 0) return null;
  const noun = rows.length === 1 ? 'item' : 'items';

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-card/95 p-1.5 shadow-xl backdrop-blur">
        <span className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-xs font-semibold">
          {rows.length} {noun} selected
          <button type="button" onClick={onClear} aria-label="Clear selection" className="text-muted-foreground hover:text-foreground">
            <X className="h-3 w-3" />
          </button>
        </span>

        <span className="mx-0.5 h-5 w-px bg-border/70" />

        <CellPopover
          className="w-48"
          trigger={<span className={ACTION}><Flag className="h-3.5 w-3.5 opacity-70" /> Status</span>}
        >
          {close => (
            <>
              {columns.map(c => {
                const tone = columnColorTokens(c.color);
                return (
                  <Option key={c.id} onClick={() => { close(); onApply({ status: c.id }); }}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
                    <span className="truncate">{c.label}</span>
                  </Option>
                );
              })}
            </>
          )}
        </CellPopover>

        {members.length > 0 && (
          <CellPopover
            className="w-52"
            trigger={<span className={ACTION}><UserPlus2 className="h-3.5 w-3.5 opacity-70" /> Assignee</span>}
          >
            {close => (
              <>
                <Option onClick={() => { close(); onApply({ assigneeIds: [] }); }}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                  Unassign
                </Option>
                {members.map(u => (
                  <Option key={u.id} onClick={() => { close(); onApply({ assigneeIds: [u.id] }); }}>
                    <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                    <span className="truncate">{u.name}</span>
                  </Option>
                ))}
              </>
            )}
          </CellPopover>
        )}

        <CellPopover
          className="w-44"
          trigger={<span className={ACTION}><Flag className="h-3.5 w-3.5 opacity-70" /> Priority</span>}
        >
          {close => (
            <>
              {PRIORITIES.map(p => (
                <Option key={p} onClick={() => { close(); onApply({ priority: p }); }}>
                  <Flag className={`h-3.5 w-3.5 ${priorityTextClass[p]}`} />
                  {p}
                </Option>
              ))}
            </>
          )}
        </CellPopover>

        <CellPopover
          align="end"
          className="w-auto p-0"
          trigger={<span className={ACTION}><CalendarPlus className="h-3.5 w-3.5 opacity-70" /> Due date</span>}
        >
          {close => (
            <>
              <Calendar
                mode="single"
                onSelect={date => {
                  if (!date) return;
                  close();
                  onApply({ dueDate: localISODateFromDate(date) });
                }}
                initialFocus
              />
              <div className="border-t border-border/60 p-1">
                <Option onClick={() => { close(); onApply({ dueDate: '' }); }}>
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                  Clear due date
                </Option>
              </div>
            </>
          )}
        </CellPopover>

        <span className="mx-0.5 h-5 w-px bg-border/70" />

        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    </div>
  );
}

export default DashBulkBar;
