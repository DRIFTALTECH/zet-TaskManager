import { useState } from 'react';
import { ChevronRight, Loader2, Pencil, Trash2 } from 'lucide-react';

import { AssigneeCell, DueDateCell, PriorityCell, type DashUser } from '@/components/dash/DashCells';
import { confirmAction } from '@/components/ConfirmDialog';
import { InlineSubtaskComposer } from '@/components/InlineSubtaskComposer';
import { useBusyIds } from '@/hooks/useBusyIds';
import { useSlowFlag } from '@/hooks/useSlowFlag';
import { isTaskAssignedTo, isTaskDone, normalizePriority, taskAssigneeIds } from '@/lib/task-utils';
import { cn } from '@/lib/utils';
import type { Priority, Task } from '@/types';

/** What one row can change without being opened. */
export interface WorkItemPatch {
  title?: string;
  assigneeIds?: string[];
  priority?: Priority;
  dueDate?: string;
}

/** Columns are declared once so the header and every row cannot drift apart. */
const GRID = 'grid grid-cols-[minmax(0,1fr)_5rem_5rem_6.5rem_3rem] items-center gap-2';

/**
 * One row, kept a component so it can wait on its own save.
 *
 * Setting an assignee sends a request and nothing on screen said so: the value
 * simply did not change for as long as it took, which reads as a click that
 * missed, so people click again. The row dims and shows a spinner — but only
 * once the wait is long enough to notice, or every fast save would flicker.
 */
function WorkItemRowCells({
  task,
  members,
  busy,
  onOpen,
  onEdit,
  onDelete,
}: {
  task: Task;
  members: DashUser[];
  busy: boolean;
  onOpen: (task: Task) => void;
  onEdit: (task: Task, patch: WorkItemPatch) => void;
  onDelete?: (task: Task) => void | Promise<void>;
}) {
  const slow = useSlowFlag(busy);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(task.title);

  const commitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    // An unchanged title is not an edit; sending it would spin the row for a
    // request that changes nothing.
    if (next && next !== task.title) onEdit(task, { title: next });
    else setDraft(task.title);
  };

  return (
    <div
      className={cn(
        GRID,
        'group border-b border-border/25 px-3 py-1.5 transition-colors',
        busy ? 'pointer-events-none opacity-60' : 'hover:bg-muted/20',
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {slow && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />}
        {renaming ? (
          <input
            autoFocus
            value={draft}
            aria-label="Title"
            onChange={e => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { setDraft(task.title); setRenaming(false); }
            }}
            className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-1.5 py-0.5 text-[13px] focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        ) : (
          <button
            type="button"
            onClick={() => onOpen(task)}
            className={cn(
              'min-w-0 flex-1 truncate text-left text-[13px] hover:underline',
              isTaskDone(task) && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </button>
        )}
      </div>

      <span onClick={e => e.stopPropagation()}>
        <AssigneeCell
          assigneeIds={taskAssigneeIds(task)}
          members={members}
          onChange={ids => onEdit(task, { assigneeIds: ids })}
        />
      </span>

      <span onClick={e => e.stopPropagation()}>
        <PriorityCell
          priority={normalizePriority(task.priority)}
          onChange={priority => onEdit(task, { priority })}
        />
      </span>

      <span onClick={e => e.stopPropagation()}>
        <DueDateCell
          dueDate={task.dueDate ?? ''}
          isDone={isTaskDone(task)}
          onChange={dueDate => onEdit(task, { dueDate })}
        />
      </span>

      {/* Quiet until the row is hovered or something in it has focus, so a long
          list is not a wall of icons — but never hidden from the keyboard. */}
      <span className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label="Rename"
          title="Rename"
          onClick={e => { e.stopPropagation(); setDraft(task.title); setRenaming(true); }}
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-muted hover:text-foreground transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
        {onDelete && (
          <button
            type="button"
            aria-label="Delete"
            title="Delete"
            onClick={async e => {
              e.stopPropagation();
              const ok = await confirmAction({
                title: `Delete "${task.title}"?`,
                description: 'This cannot be undone.',
                confirmLabel: 'Delete',
                destructive: true,
              });
              if (ok) await onDelete(task);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * Whatever is nested inside something — a story's tasks, a task's subtasks — as
 * a table, editable in place.
 *
 * A stack of rows carrying only a title said these were checklist ticks. They
 * are work: each has an owner, a priority and a due date, and all three are set
 * here rather than by opening every one. Comparing those values down a column
 * is the point of a list, and that needs them in a column.
 *
 * One component for both depths, so a story's task and a task's subtask never
 * drift into looking like different kinds of object.
 */
export function WorkItemTable({
  title,
  items,
  members,
  currentUserId,
  onOpen,
  onEdit,
  onDelete,
  onAdd,
  addLabel = 'Add',
}: {
  /** Names the group: "Tasks" under a story, "Subtasks" under a task. */
  title: string;
  items: Task[];
  members: DashUser[];
  currentUserId?: string;
  onOpen: (task: Task) => void;
  onEdit: (task: Task, patch: WorkItemPatch) => void | Promise<void>;
  /** Omitted where the reader may not remove these. */
  onDelete?: (task: Task) => void | Promise<void>;
  /** Omitted where nothing can be added — a subtask of a subtask. */
  onAdd?: (title: string) => Promise<void>;
  addLabel?: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { busyIds, withBusy } = useBusyIds();

  const open = items.filter(t => !isTaskDone(t)).length;
  const mine = currentUserId
    ? items.filter(t => !isTaskDone(t) && isTaskAssignedTo(t, currentUserId)).length
    : 0;

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setCollapsed(c => !c)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-foreground"
        >
          <ChevronRight className={cn('h-4 w-4 transition-transform', !collapsed && 'rotate-90')} />
          {title}
        </button>
        {items.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {open} open
          </span>
        )}
        {mine > 0 && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            {mine} for me
          </span>
        )}
      </div>

      {!collapsed && (
        <div className="overflow-hidden rounded-xl border border-border/50">
          {/* Naming the columns is what lets the icons below stay silent: an
              outlined flag means nothing until something overhead says it is a
              priority. */}
          <div
            className={cn(
              GRID,
              'border-b border-border/40 bg-muted/20 px-3 py-1.5',
              'text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60',
            )}
          >
            <span>Name</span>
            <span>Assignee</span>
            <span>Priority</span>
            <span>Due date</span>
            <span className="sr-only">Actions</span>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-3 text-[13px] italic text-muted-foreground/50">Nothing here yet.</p>
          ) : (
            items.map(st => (
              <WorkItemRowCells
                key={st.id}
                task={st}
                members={members}
                busy={busyIds.has(st.id)}
                onOpen={onOpen}
                onEdit={(task, patch) => void withBusy(task.id, () => Promise.resolve(onEdit(task, patch)))}
                onDelete={
                  onDelete
                    ? task => void withBusy(task.id, () => Promise.resolve(onDelete(task)))
                    : undefined
                }
              />
            ))
          )}

          {onAdd && (
            <div className="px-3 py-1.5">
              <InlineSubtaskComposer onAdd={onAdd} label={addLabel} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default WorkItemTable;
