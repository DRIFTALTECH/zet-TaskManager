/**
 * The dashboard list.
 *
 * One grid, one row renderer, one set of column tracks. The header lives inside
 * each group rather than above the whole page, which is what keeps the cells
 * under their labels — the old nested project/story cards each added their own
 * padding, so every level of depth pushed a row further out of alignment.
 *
 * Depth is expressed with indentation alone. No boxes, no dashed borders.
 *
 * Work from every project sits in the same groups; the project is named on the
 * row instead of wrapping the table in a per-project band, so a status group
 * shows everything at that status rather than once per project.
 */
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { BookOpen, ChevronRight, CircleDot, GitBranch, GripVertical, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { AddWorkMenu } from '@/components/AddWorkMenu';
import { RowDescription } from '@/components/dash/RowDescription';
import { Hint } from '@/components/ui/hint';
import { WorkTypeSelect } from '@/components/dash/WorkTypeSelect';
import { Checkbox } from '@/components/ui/checkbox';
import { useAppStore } from '@/stores/appStore';
import { ROW_SHADOW } from '@/lib/card-shadow';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { isTaskAssignedTo } from '@/lib/task-utils';
import { DashBulkBar } from '@/components/dash/DashBulkBar';
import { columnColorTokens } from '@/lib/column-colors';
import { projectNameColor } from '@/lib/project-utils';
import { flattenDashNodes, statusColumnId, type DashGroup, type DashRow } from '@/lib/dash-rows';
import {
  AssigneeCell,
  DueDateCell,
  PriorityCell,
  StatusCell,
  TimeCell,
  type DashUser,
} from '@/components/dash/DashCells';
import type { KanbanColumn, Priority } from '@/types';

export type { DashUser };

/** A single-cell edit. Only the touched field is present. */
export interface DashRowPatch {
  title?: string;
  /**
   * Set when a drop lands outside any parent: membership is only ever what the
   * user put there, so leaving a story means leaving it, not just moving group.
   */
  detach?: boolean;
  assigneeIds?: string[];
  status?: string;
  priority?: Priority;
  dueDate?: string;
}

/**
 * Title | Assignee | Due date | Priority | Est · Actual, with Status inserted only
 * when the list is grouped by something else — repeating a row's status inside a
 * status group is a column of noise.
 */
const cols = (withStatus: boolean) =>
  // Columns appear as the screen allows. The fixed tracks add up to 24rem
  // (32rem with status), which overflows a phone on their own, so a narrow
  // screen keeps only the title and the due date and the rest are hidden in
  // step with these templates.
  'grid items-center gap-2 sm:gap-3 grid-cols-[minmax(0,1fr)_auto] ' +
  'sm:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem] ' +
  (withStatus
    ? 'lg:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_6rem_8rem]'
    : 'lg:grid-cols-[minmax(0,1fr)_6rem_6rem_6rem_6rem]');

const CELL = 'text-[13px]';

/**
 * The board's card, laid out as a row: same radius, same border weight, same
 * shadow values — so switching views does not feel like switching apps.
 */
const ROW_CARD = `rounded-lg border border-border/60 bg-card transition-shadow ${ROW_SHADOW}`;

/**
 * Start / Stop for a list row.
 *
 * The board card has always had this; the list had no way to start a timer at
 * all, so tracking time meant switching views. Same rules as the card: only the
 * people a task is assigned to can start it, and never once it is done.
 */
function RowTimer({ row }: { row: DashRow }) {
  const currentUser = useAppStore(s => s.currentUser);
  const activeTimers = useAppStore(s => s.activeTimers);
  const startTimer = useAppStore(s => s.startTimer);
  const stopTimer = useAppStore(s => s.stopTimer);
  const task = row.task;
  const isActive = !!activeTimers[row.entityId];
  const elapsed = useElapsedTime(activeTimers[row.entityId] ?? null);

  if (row.type === 'story' || !task) return null;
  const isDone = row.status === 'completed' || row.status === 'done';
  const canStart = !!currentUser && isTaskAssignedTo(task, currentUser.id) && !isDone;
  if (isDone || (!canStart && !isActive)) return null;

  return (
    <span className="flex shrink-0 items-center gap-1.5" onClick={e => e.stopPropagation()}>
      {isActive ? (
        <>
          <button
            type="button"
            className="rounded-lg bg-destructive/90 px-2 py-1 text-[11px] font-semibold text-destructive-foreground transition-colors hover:bg-destructive"
            onClick={() => { void stopTimer(row.entityId); }}
          >
            Stop
          </button>
          {elapsed && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">{elapsed}</span>
          )}
        </>
      ) : (
        <button
          type="button"
          className="rounded-lg bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          onClick={() => { void startTimer(row.entityId); }}
        >
          Start
        </button>
      )}
    </span>
  );
}

function Row({
  row,
  columns,
  doneColumnId,
  members,
  expanded,
  onToggle,
  onClick,
  onAddChild,
  onDelete,
  onConvert,
  onEdit,
  projectName,
  withStatus,
  groupKey,
  busy,
  selected,
  onSelectChange,
}: {
  row: DashRow;
  columns: KanbanColumn[];
  doneColumnId: string;
  members: DashUser[];
  expanded: boolean;
  onToggle: (rowId: string) => void;
  onClick: (row: DashRow) => void;
  onAddChild?: (row: DashRow) => void;
  onDelete: (row: DashRow) => void;
  /** Story ⇄ task, in place. */
  onConvert: (row: DashRow) => void;
  onEdit: (row: DashRow, patch: DashRowPatch) => void;
  /** Set only on top-level rows when more than one project is in view. */
  projectName?: string;
  withStatus: boolean;
  /** The group this row is drawn under, so an off-status child can say so. */
  groupKey: string;
  /** A request for this row is in flight. */
  busy?: boolean;
  selected: boolean;
  onSelectChange: (row: DashRow, next: boolean) => void;
}) {
  const done =
    row.status === 'completed' || row.status === doneColumnId || row.status === 'done';
  // Drag from the handle only. The row is full of popovers and a whole-row
  // draggable would swallow every one of their clicks.
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: row.rowId,
    data: { row },
  });
  // Stories and tasks can take children, so they are drop targets too: dropping a
  // task on a story files it under that story, a task on a task makes a subtask.
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `row:${row.rowId}`,
    disabled: false,
    data: { row },
  });
  // Renaming happens on the row. Opening the whole detail modal to change a
  // title is the slow path, and the pencil is where people reach for it first.
  const [titleDraft, setTitleDraft] = useState<string | null>(null);

  const commitTitle = () => {
    const next = (titleDraft ?? '').trim();
    setTitleDraft(null);
    if (next && next !== row.title) onEdit(row, { title: next });
  };

  return (
    <div
      ref={el => { setNodeRef(el); setDropRef(el); }}
      style={{ marginLeft: row.depth * 20, opacity: isDragging ? 0.4 : 1 }}
      role="button"
      tabIndex={0}
      onClick={() => onClick(row)}
      onKeyDown={e => {
        if (e.key === 'Enter') onClick(row);
      }}
      className={`${cols(withStatus)} ${CELL} ${ROW_CARD} group my-0.5 min-h-7 cursor-pointer px-2.5 py-0.5 ${
        selected ? 'border-primary/50 bg-primary/5' : ''
      } ${isOver && !isDragging ? 'ring-1 ring-primary/40' : ''} ${
        busy ? 'pointer-events-none opacity-60' : ''
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span
          className={`shrink-0 transition-opacity ${selected ? '' : 'opacity-0 group-hover:opacity-100'}`}
          onClick={e => e.stopPropagation()}
        >
          <Checkbox
            checked={selected}
            onCheckedChange={next => onSelectChange(row, next === true)}
            aria-label={`Select ${row.title}`}
            className="h-3.5 w-3.5"
          />
        </span>
        <Hint label="Drag to another group">
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label="Drag to another group"
            className="-ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-muted-foreground/0 hover:bg-muted active:cursor-grabbing group-hover:text-muted-foreground/50"
            onClick={e => e.stopPropagation()}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        </Hint>
        {row.hasChildren ? (
          <Hint label={expanded ? 'Collapse' : 'Expand'}>
            <button
              type="button"
              aria-label={expanded ? 'Collapse' : 'Expand'}
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              onClick={e => {
                e.stopPropagation();
                onToggle(row.rowId);
              }}
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
              />
            </button>
          </Hint>
        ) : (
          <span className="w-[1.375rem] shrink-0" />
        )}
        {/* A child sits under its parent whatever its status, so the status has
            to be said out loud or a finished task reads as still in Backlog. */}
        {!withStatus && row.depth > 0 && (() => {
          const own = statusColumnId(row.status, columns, doneColumnId);
          if (own === groupKey) return null;
          const col = columns.find(c => c.id === own);
          const tone = columnColorTokens(col?.color);
          return (
            <span
              title={`Status: ${col?.label ?? own}`}
              className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tone.pill}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
              {col?.label ?? own}
            </span>
          );
        })()}
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : row.type === 'subtask' ? (
          <GitBranch className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
        ) : (
          <WorkTypeSelect
            value={row.type === 'story' ? 'story' : 'task'}
            onChange={() => onConvert(row)}
          />
        )}
        {titleDraft !== null ? (
          <input
            autoFocus
            value={titleDraft}
            onChange={e => setTitleDraft(e.target.value)}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') setTitleDraft(null);
            }}
            onBlur={commitTitle}
            className={`min-w-0 flex-1 rounded border border-border/60 bg-background px-1.5 py-0.5 outline-none focus:ring-2 focus:ring-primary/30 ${
              row.type === 'story' ? 'font-semibold' : ''
            }`}
          />
        ) : (
          <span
            className={`truncate group-hover:text-primary ${row.type === 'story' ? 'font-semibold' : ''}`}
          >
            {row.title}
          </span>
        )}
        <RowDescription row={row} />
        {row.childCount > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground/60">
            <GitBranch className="h-3 w-3" />
            {row.childCount}
          </span>
        )}
        {projectName && (
          <span
            className={`shrink-0 truncate text-[11px] font-medium ${projectNameColor(row.projectId)}`}
            title={projectName}
          >
            {projectName}
          </span>
        )}
        {/* One right-aligned group: the timer is always visible, the edit and
            delete icons fade in on hover. Keeping them in a single ml-auto
            wrapper means the icons stay put whether or not a row has a timer. */}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <RowTimer row={row} />

        <span className={`flex shrink-0 items-center gap-0.5 transition-opacity ${titleDraft !== null ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {onAddChild && row.type === 'story' && (
            <Hint label="Add task">
              <button
                type="button"
                aria-label="Add task"
                className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
                onClick={e => {
                  e.stopPropagation();
                  onAddChild(row);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </Hint>
          )}
          <Hint label="Rename">
            <button
              type="button"
              aria-label="Rename"
              className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-foreground"
              onClick={e => {
                e.stopPropagation();
                setTitleDraft(row.title);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </Hint>
          <Hint label={row.type === 'story' ? 'Delete story' : 'Delete task'}>
            <button
              type="button"
              aria-label={row.type === 'story' ? 'Delete story' : 'Delete task'}
              className="rounded p-1 text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
              onClick={e => {
                e.stopPropagation();
                onDelete(row);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </Hint>
        </span>
        </span>
      </div>

      <span className="hidden sm:block">
        <AssigneeCell
          assigneeIds={row.assigneeIds}
          members={members}
          onChange={ids => onEdit(row, { assigneeIds: ids })}
        />
      </span>

      <DueDateCell
        dueDate={row.dueDate}
        isDone={done}
        onChange={iso => onEdit(row, { dueDate: iso })}
      />

      <span className="hidden sm:block">
        <PriorityCell priority={row.priority} onChange={p => onEdit(row, { priority: p })} />
      </span>

      <span className="hidden lg:block">
        <TimeCell estimatedHours={row.estimatedHours} actualHours={row.actualHours} />
      </span>

      {withStatus && (
        <span className="hidden lg:block">
          <StatusCell
            status={row.status}
            columns={columns}
            doneColumnId={doneColumnId}
            onChange={status => onEdit(row, { status })}
          />
        </span>
      )}
    </div>
  );
}

/** What the inline composer can set before the task exists. */
export interface DashDraft {
  title: string;
  assigneeIds: string[];
  dueDate: string;
  priority: Priority;
  /** Empty means "the project's first section". */
  sectionId: string;
}

/**
 * Inline task composer.
 *
 * Creating the common case — a task with a name, in this group — should not cost
 * a modal. Assignee, due date and priority can be set before saving through the
 * same popovers the rows use, so nothing has to be corrected afterwards.
 */
function ItemComposer({
  kind: initialKind,
  color,
  members,
  sections,
  indent = 0,
  onCreate,
  onClose,
}: {
  /** Stories are the top level of a group; tasks only exist inside one. */
  kind: 'story' | 'task';
  color?: string;
  members: DashUser[];
  sections: { id: string; name: string }[];
  indent?: number;
  /** The kind is passed back: the composer can be switched before saving. */
  onCreate: (draft: DashDraft, kind: 'story' | 'task') => Promise<void>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DashDraft>({
    title: '',
    assigneeIds: [],
    dueDate: '',
    priority: 'Medium',
    sectionId: sections[0]?.id ?? '',
  });
  const [saving, setSaving] = useState(false);
  // Seeded by whichever button opened the composer, then free to change.
  const [kind, setKind] = useState<'story' | 'task'>(initialKind);
  const tokens = columnColorTokens(color);

  const submit = async () => {
    const title = draft.title.trim();
    if (!title || saving) return;
    setSaving(true);
    try {
      await onCreate({ ...draft, title }, kind);
      // Stay open: adding one task usually means adding several.
      setDraft(d => ({ ...d, title: '', assigneeIds: [], dueDate: '' }));
    } finally {
      setSaving(false);
    }
  };

  // One step taller than a display row on purpose: this row holds live inputs,
  // and 28px is tight to type into.
  return (
    <div
      className="flex min-h-8 items-center gap-2 border-b border-border/30 px-2"
      style={{ paddingLeft: 8 + indent * 20 }}
    >
      <WorkTypeSelect value={kind} onChange={setKind} disabled={saving} />
      {kind === 'task' && (
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tokens.dot}`} aria-hidden />
      )}
      <input
        autoFocus
        value={draft.title}
        disabled={saving}
        onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          if (e.key === 'Escape') onClose();
        }}
        placeholder={kind === 'story' ? 'Story name' : 'Task name'}
        className="min-w-0 flex-1 border-none bg-transparent px-1 py-1 text-[13px] outline-none placeholder:text-muted-foreground/50"
      />
      <span className="flex shrink-0 items-center gap-0.5">
        <AssigneeCell
          assigneeIds={draft.assigneeIds}
          members={members}
          onChange={ids => setDraft(d => ({ ...d, assigneeIds: ids }))}
        />
        <DueDateCell
          dueDate={draft.dueDate}
          isDone={false}
          onChange={iso => setDraft(d => ({ ...d, dueDate: iso }))}
        />
        <PriorityCell
          priority={draft.priority}
          onChange={pr => setDraft(d => ({ ...d, priority: pr }))}
        />
        {sections.length > 1 && (
          <Hint label="Section">
          <select
            value={draft.sectionId}
            onChange={e => setDraft(d => ({ ...d, sectionId: e.target.value }))}
            aria-label="Section"
            className="max-w-[8rem] rounded border border-transparent bg-transparent px-1 py-1 text-[11px] text-muted-foreground outline-none hover:bg-muted focus:border-border/60"
          >
            {sections.map(sec => (
              <option key={sec.id} value={sec.id}>{sec.name}</option>
            ))}
          </select>
          </Hint>
        )}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="shrink-0 rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={!draft.title.trim() || saving}
        className="shrink-0 rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save ⏎'}
      </button>
    </div>
  );
}

/** Highlights while a row hovers over it, so the target group is never a guess. */
/**
 * A row wins only under the cursor; everywhere else is the group.
 *
 * Filing something inside another item has to be deliberate, so a row is a drop
 * target only when the pointer is actually on it. The rectangle fallback — which
 * catches a drop released in a gap, since people aim with the drag overlay
 * rather than the cursor — is restricted to groups, or an overlay merely
 * overlapping a neighbouring row would silently nest the two.
 *
 * The row being dragged is excluded so it can never be its own drop target.
 */
function makeCollisionDetection(activeRowId: string | null): CollisionDetection {
  const ownDroppable = activeRowId ? `row:${activeRowId}` : null;
  return args => {
    const containers = ownDroppable
      ? args.droppableContainers.filter(c => c.id !== ownDroppable)
      : args.droppableContainers;

    const byPointer = pointerWithin({ ...args, droppableContainers: containers });
    if (byPointer.length > 0) {
      // Prefer the row the cursor is on; a group also matches and would win by
      // area on the way past.
      const onRow = byPointer.find(c => String(c.id).startsWith('row:'));
      return onRow ? [onRow] : byPointer;
    }

    const groups = containers.filter(c => !String(c.id).startsWith('row:'));
    // No nearest-neighbour fallback: a drag released away from the table should
    // do nothing rather than guess a group.
    return rectIntersection({ ...args, droppableContainers: groups });
  };
}

function GroupDropZone({
  groupKey,
  label,
  dragging,
  children,
}: {
  groupKey: string;
  label: string;
  /** Something is being dragged, so the group offers a target of its own. */
  dragging: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: groupKey });
  return (
    <div
      ref={setNodeRef}
      className={`border-b border-border/40 bg-muted/20 px-2 pb-1.5 last:border-b-0 ${
        isOver ? 'bg-primary/5 ring-1 ring-inset ring-primary/30' : ''
      }`}
    >
      {/* Dropping on a row files the item inside that row, so moving to a status
          needs somewhere that is not a row. The gaps between cards are too thin
          to aim at, so while a drag is on, the group offers a strip of its own. */}
      {dragging && (
        <div
          className={`my-1 flex h-8 items-center justify-center rounded-lg border border-dashed text-[11px] font-medium transition-colors ${
            isOver
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border/60 text-muted-foreground/60'
          }`}
        >
          Drop here to move to {label}
        </div>
      )}
      {children}
    </div>
  );
}

function HeaderRow({ withStatus }: { withStatus: boolean }) {
  return (
    <div
      className={`${cols(withStatus)} px-3 pb-1 pt-1 text-[11px] font-medium text-muted-foreground/60`}
    >
      <span>Title</span>
      <span className="hidden sm:block">Assignee</span>
      <span>Due date</span>
      <span className="hidden sm:block">Priority</span>
      <span className="hidden lg:block" title="Estimated · Actual">Est · Actual</span>
      {withStatus && <span className="hidden lg:block">Status</span>}
    </div>
  );
}

export interface DashTableProps {
  groups: DashGroup[];
  columns: KanbanColumn[];
  doneColumnId: string;
  /** Assignable people per project — the assignee popover lists only these. */
  membersForProject: (projectId: string) => DashUser[];
  /** id → display name, used for the project chip on top-level rows. */
  projectNames: Record<string, string>;
  /** Naming the project only helps when work from several is mixed together. */
  showProjectNames: boolean;
  expandedRowIds: Set<string>;
  onToggleRow: (rowId: string) => void;
  collapsedKeys: Set<string>;
  onToggleGroup: (key: string) => void;
  onRowClick: (row: DashRow) => void;
  onAddChild: (row: DashRow) => void;
  /** Row-level delete; the caller owns the confirmation. */
  onDeleteRow: (row: DashRow) => void;
  onEditRow: (row: DashRow, patch: DashRowPatch) => void;
  /** Add straight into a group — the new item inherits that group's status. */
  onAddTask: (groupKey: string) => void;
  /** Inline create — title only, everything else defaulted from the group. */
  onCreateItem: (
    groupKey: string,
    draft: DashDraft,
    opts: { kind: 'story' | 'task'; storyId?: string },
  ) => Promise<void>;
  /** Project the inline composer creates into, and whose members it offers. */
  composerProjectId: string;
  /** Sections offered by the composer's section picker. */
  composerSections: { id: string; name: string }[];
  onAddStory: (groupKey: string) => void;
  /** Groups keyed by status can seed a new item's status; other groupings cannot. */
  groupKeyIsStatus: boolean;
  /** Dropping a row on a group applies that group's value to the row. */
  onDropRow: (row: DashRow, groupKey: string) => void;
  /** Dropping a row on another row files it under that row. */
  onReparentRow: (row: DashRow, parent: DashRow) => void;
  /** Bulk delete from the selection bar; the caller confirms once for the set. */
  onDeleteRows: (rows: DashRow[]) => void;
  /** Story ⇄ task, from the row's own action. */
  onConvertRow: (row: DashRow) => void;
  /** Entity ids with a request in flight. */
  busyIds?: Set<string>;
}

export function DashTable({
  groups,
  columns,
  doneColumnId,
  membersForProject,
  projectNames,
  showProjectNames,
  expandedRowIds,
  onToggleRow,
  collapsedKeys,
  onToggleGroup,
  onRowClick,
  onAddChild,
  onDeleteRow,
  onEditRow,
  onAddTask,
  onCreateItem,
  composerProjectId,
  composerSections,
  onAddStory,
  groupKeyIsStatus,
  onDropRow,
  onReparentRow,
  onDeleteRows,
  onConvertRow,
  busyIds,
}: DashTableProps) {
  // 6px so a click on a cell popover is never read as a drag.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const [dragging, setDragging] = useState<DashRow | null>(null);
  // Rows, not ids: the bar needs each row's project and entity to act on it.
  const [selected, setSelected] = useState<Map<string, DashRow>>(new Map());

  const selectedRows = [...selected.values()];

  /**
   * Every row beneath each row, whether or not it is expanded.
   *
   * Ticking a story means "this and the work in it" — a bulk edit that skipped
   * the tasks would be a surprise, and collapsing a story must not change what
   * ticking it does. Built by flattening each group with everything expanded and
   * reading the depth run that follows a row.
   */
  const descendantsById = useMemo(() => {
    const map = new Map<string, DashRow[]>();
    for (const group of groups) {
      const everything = new Set<string>();
      const collect = (nodes: typeof group.nodes) => {
        for (const n of nodes) {
          everything.add(n.rowId);
          collect(n.children);
        }
      };
      collect(group.nodes);
      const rows = flattenDashNodes(group.nodes, everything);
      rows.forEach((row, i) => {
        const kids: DashRow[] = [];
        for (let j = i + 1; j < rows.length && rows[j].depth > row.depth; j += 1) kids.push(rows[j]);
        if (kids.length > 0) map.set(row.rowId, kids);
      });
    }
    return map;
  }, [groups]);

  const toggleSelected = (row: DashRow, next: boolean) => {
    const family = [row, ...(descendantsById.get(row.rowId) ?? [])];
    setSelected(prev => {
      const copy = new Map(prev);
      for (const r of family) {
        if (next) copy.set(r.rowId, r);
        else copy.delete(r.rowId);
      }
      return copy;
    });
  };
  const clearSelection = () => setSelected(new Map());
  // Only people who belong to every selected row's project can take all of them.
  const sharedMembers = selectedRows.length
    ? selectedRows
        .map(r => membersForProject(r.projectId))
        .reduce((acc, list) => acc.filter(u => list.some(x => x.id === u.id)))
    : [];
  /** `${groupKey}:top` | `${groupKey}:bottom` — at most one composer at a time. */
  const [composerAt, setComposerAt] = useState<string | null>(null);
  // The composer is not tied to a row, so it offers the scoped project's people.
  const composerMembers = membersForProject(composerProjectId);

  const handleDragStart = (e: DragStartEvent) => {
    setDragging((e.active.data.current?.row as DashRow) ?? null);
  };
  const handleDragEnd = (e: DragEndEvent) => {
    const row = (e.active.data.current?.row as DashRow) ?? null;
    setDragging(null);
    const target = e.over?.id;
    if (!row || typeof target !== 'string') return;
    // Dragging one of several ticked rows moves the whole selection: ticking
    // five things and then moving them one at a time is not a selection.
    const moving = selected.has(row.rowId) ? [...selected.values()] : [row];

    // Released on a row means inside that row, wherever it sits. Anywhere else
    // is the group, which means outside — one rule, no exceptions by type.
    if (target.startsWith('row:')) {
      const parent = (e.over?.data.current?.row as DashRow) ?? null;
      if (!parent) return;
      for (const item of moving) {
        if (item.rowId !== parent.rowId) onReparentRow(item, parent);
      }
      if (moving.length > 1) clearSelection();
      return;
    }
    for (const item of moving) onDropRow(item, target);
    if (moving.length > 1) clearSelection();
  };
  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center">
        <BookOpen className="mb-2 h-7 w-7 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={makeCollisionDetection(dragging?.rowId ?? null)}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setDragging(null)}
    >
    <div className="mb-10 overflow-hidden rounded-xl border border-border/50 bg-card">
      {groups.map(group => {
        const open = !collapsedKeys.has(group.key);
        const tokens = columnColorTokens(group.color);
        const rows = open ? flattenDashNodes(group.nodes, expandedRowIds) : ([] as DashRow[]);
        return (
          <GroupDropZone
            key={group.key}
            groupKey={group.key}
            label={group.label}
            dragging={!!dragging}
          >
            <div className="group/group flex items-center gap-2 px-2 py-1.5">
              <button
                type="button"
                aria-label={open ? 'Collapse group' : 'Expand group'}
                onClick={() => onToggleGroup(group.key)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight
                  className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`}
                />
              </button>
              <span
                className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tokens.pill}`}
              >
                {group.label}
              </span>
              <span className="text-xs font-medium text-muted-foreground/70">{group.total}</span>
              <Hint label="Add story at the top">
                <button
                  type="button"
                  aria-label="Add story at the top"
                  onClick={() => setComposerAt(`${group.key}:top`)}
                  className="rounded p-0.5 text-muted-foreground/0 hover:bg-muted group-hover/group:text-muted-foreground/60 hover:!text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </Hint>
            </div>

            {open && (
              <>
                <HeaderRow withStatus={!groupKeyIsStatus} />
                {composerAt === `${group.key}:top` && (
                  <ItemComposer
                    kind="story"
                    color={group.color}
                    members={composerMembers}
                    sections={composerSections}
                    onCreate={(draft, kind) => onCreateItem(groupKeyIsStatus ? group.key : '', draft, { kind })}
                    onClose={() => setComposerAt(null)}
                  />
                )}
                {rows.map(row => (
                  <Fragment key={row.rowId}>
                  <Row
                    row={row}
                    columns={columns}
                    doneColumnId={doneColumnId}
                    members={membersForProject(row.projectId)}
                    expanded={expandedRowIds.has(row.rowId)}
                    onToggle={onToggleRow}
                    onClick={onRowClick}
                    onAddChild={r => setComposerAt(`row:${r.rowId}`)}
                    onDelete={onDeleteRow}
                    onConvert={onConvertRow}
                    onEdit={onEditRow}
                    groupKey={group.key}
                    busy={busyIds?.has(row.entityId)}
                    selected={selected.has(row.rowId)}
                    onSelectChange={toggleSelected}
                    withStatus={!groupKeyIsStatus}
                    projectName={
                      showProjectNames && row.depth === 0
                        ? projectNames[row.projectId]
                        : undefined
                    }
                  />
                  {composerAt === `row:${row.rowId}` && (
                    <ItemComposer
                      kind="task"
                      color={group.color}
                      indent={row.depth + 1}
                      members={membersForProject(row.projectId)}
                      sections={composerSections}
                      onCreate={(draft, kind) =>
                        onCreateItem(groupKeyIsStatus ? group.key : '', draft, {
                          kind,
                          // A story created here belongs beside the row, not inside it.
                          storyId: kind === 'task' ? row.entityId : undefined,
                        })
                      }
                      onClose={() => setComposerAt(null)}
                    />
                  )}
                  </Fragment>
                ))}
                {composerAt === `${group.key}:bottom` ? (
                  <ItemComposer
                    kind="story"
                    color={group.color}
                    members={composerMembers}
                    sections={composerSections}
                    onCreate={(draft, kind) => onCreateItem(groupKeyIsStatus ? group.key : '', draft, { kind })}
                    onClose={() => setComposerAt(null)}
                  />
                ) : (
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => setComposerAt(`${group.key}:bottom`)}
                      className="flex flex-1 items-center gap-1.5 px-2 py-2 text-left text-[12px] font-medium text-muted-foreground/60 hover:bg-muted/40 hover:text-foreground"
                      style={{ paddingLeft: 8 }}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add story
                    </button>
                    <AddWorkMenu
                      hint="More ways to add"
                      onTask={() => onAddTask(groupKeyIsStatus ? group.key : '')}
                      onStory={() => onAddStory(groupKeyIsStatus ? group.key : '')}
                      trigger={
                        <button
                          type="button"
                          aria-label="More ways to add"
                          className="mr-2 rounded p-1 text-muted-foreground/50 hover:bg-muted hover:text-foreground"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      }
                    />
                  </div>
                )}
              </>
            )}
          </GroupDropZone>
        );
      })}
    </div>
    <DragOverlay dropAnimation={null}>
      {dragging ? (
        <div className="flex items-center gap-2 rounded-md border border-border/60 bg-card px-2.5 py-1.5 text-[13px] font-medium shadow-lg">
          <span className="max-w-[18rem] truncate">{dragging.title}</span>
          {selected.has(dragging.rowId) && selected.size > 1 && (
            <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
              +{selected.size - 1}
            </span>
          )}
        </div>
      ) : null}
    </DragOverlay>
    <DashBulkBar
      rows={selectedRows}
      columns={columns}
      members={sharedMembers}
      onApply={patch => {
        selectedRows.forEach(r => onEditRow(r, patch));
        clearSelection();
      }}
      onDelete={() => {
        onDeleteRows(selectedRows);
        clearSelection();
      }}
      onClear={clearSelection}
    />
    </DndContext>
  );
}

export default DashTable;
