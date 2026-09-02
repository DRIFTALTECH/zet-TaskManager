import { useAppStore } from '@/stores/appStore';
import DateRangeField from '@/components/DateRangeField';
import { projectPickerLabel } from '@/lib/project-utils';
import { Task, Priority, KanbanColumn } from '@/types';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus, GripVertical,
  MoreHorizontal, Pencil, Trash2, Flag, Check, ChevronDown, ChevronRight,
  Users, BookOpen, List, Columns, FolderOpen,
} from 'lucide-react';
import { KanbanBoardPan } from '@/components/KanbanBoardPan';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { SortableTaskCard, TaskCard } from '@/components/TaskCard';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { pageEnter } from '@/lib/motion';
import {
  getDueBucket,
  taskMatchesDueDateRange,
  taskMatchesPriorityFilter,
} from '@/lib/due-date-utils';
import { isTopLevelTask, isTaskConfirmed, storyAssigneeIds, taskMatchesAssigneeFilter, taskMatchesSprintFilter, NO_SPRINT_FILTER_ID, UNASSIGNED_FILTER_ID, childTasksOf, taskAssigneeIds, normalizePriority } from '@/lib/task-utils';
import UserAvatar from '@/components/UserAvatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import AssigneeMultiSelect from '@/components/AssigneeMultiSelect';
import { api } from '@/lib/api';
import type { UserStory } from '@/types';

const PROTECTED_IDS = new Set(['backlog', 'in_progress', 'in_review', 'done']);
const DONE_COL_KEY = 'tm_done_col';
const VIEW_KEY = 'tm_dash_view';
type DashView = 'list' | 'board';

const FILTER_TRIGGER =
  'flex h-8 w-[min(40vw,9.5rem)] sm:w-36 shrink-0 items-center justify-between gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 text-xs font-medium shadow-none text-left focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-0';

type DashFilterOption = { id: string; text: string; label?: ReactNode };

function DashFilterSelect({
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
        <button type="button" className={FILTER_TRIGGER}>
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto min-w-[14rem] max-h-72 overflow-hidden rounded-xl border-border/70 p-1 shadow-lg"
      >
        <div className="max-h-72 overflow-y-auto">
          <button
            type="button"
            onClick={onClear}
            className="relative flex w-full cursor-default select-none items-center rounded-lg py-2 pl-8 pr-2 text-sm font-medium outline-none hover:bg-accent hover:text-accent-foreground"
          >
            {selected.size === 0 && (
              <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                <Check className="h-4 w-4" />
              </span>
            )}
            {allLabel}
          </button>
          {options.map(opt => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onToggle(opt.id)}
              className="relative flex w-full cursor-default select-none items-center rounded-lg py-2 pl-8 pr-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground"
            >
              {selected.has(opt.id) && (
                <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
                  <Check className="h-4 w-4" />
                </span>
              )}
              <span className="flex min-w-0 items-center gap-2 truncate">{opt.label ?? opt.text}</span>
            </button>
          ))}
          {options.length === 0 && emptyText && (
            <p className="px-2 py-2 text-xs text-muted-foreground">{emptyText}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'text-red-600 dark:text-red-400',
  High: 'text-orange-600 dark:text-orange-400',
  Medium: 'text-yellow-600 dark:text-yellow-400',
  Low: 'text-green-600 dark:text-green-400',
};

function KanbanColumnPanel({
  column, tasks, onTaskClick, onNewTask, isDropTarget, isManager,
  approvingId, onApprove,
  isDoneColumn, onSetDoneColumn, onRenameColumn, onDeleteColumn, showProjectPill,
  storyTitleById,
}: {
  column: KanbanColumn; tasks: Task[];
  onTaskClick: (t: Task) => void; onNewTask: () => void;
  isDropTarget: boolean; isManager: boolean;
  approvingId: string | null; onApprove: (id: string) => void;
  isDoneColumn: boolean; onSetDoneColumn: () => void;
  onRenameColumn: () => void; onDeleteColumn: () => void;
  showProjectPill?: boolean;
  storyTitleById?: Record<string, string>;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: column.id, data: { type: 'column' as const },
  });
  const isProtected = PROTECTED_IDS.has(column.id);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined, opacity: isDragging ? 0.4 : 1 }}
      className={`min-w-[300px] w-[85vw] shrink-0 sm:min-w-[340px] sm:w-[340px] lg:w-auto lg:min-w-0 lg:flex-1 lg:basis-0 lg:shrink flex flex-col rounded-2xl transition-[box-shadow,background-color] duration-150 ease-out ${isDropTarget ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''}`}
    >
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <button {...attributes} {...listeners} onClick={e => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors touch-none p-0.5 rounded">
            <GripVertical className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-foreground">{column.label}</h3>
          <span className="text-[11px] text-muted-foreground bg-muted/80 px-2.5 py-0.5 rounded-full font-medium border border-border/40">{tasks.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onNewTask}
            className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Add task"
          >
            <Plus className="h-4 w-4" />
          </button>
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onSetDoneColumn} className="gap-2">
              <Flag className="h-3.5 w-3.5" />
              {isDoneColumn ? 'Unset as Done column' : 'Set as Done column'}
              {isDoneColumn && <Check className="h-3.5 w-3.5 ml-auto text-green-500" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRenameColumn} className="gap-2">
              <Pencil className="h-3.5 w-3.5" />
              Rename column
            </DropdownMenuItem>
            {!isProtected && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDeleteColumn} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete column
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-1 pt-3 pb-3">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
              showApprove={isManager && isDoneColumn && !isTaskConfirmed(task)}
              onApprove={() => onApprove(task.id)}
              approving={approvingId === task.id}
              showProjectPill={showProjectPill}
              userStoryTitle={task.userStoryId ? storyTitleById?.[task.userStoryId] : null}
            />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

/**
 * Invisible droppable that sits over the fixed Tasker mascot (bottom-right). It
 * lives inside the board's DndContext so dnd-kit can detect a card dropped on the
 * mascot; the mascot itself (Companion) is rendered in AppLayout, outside this
 * context, and reacts via the store drag-bus.
 */
function MascotDropZone() {
  const { setNodeRef } = useDroppable({ id: 'tasker-dropzone' });
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className="pointer-events-none fixed bottom-2 right-2 z-30 h-[120px] w-[88px]"
    />
  );
}

function listDate(iso: string) {
  if (!iso?.trim()) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function DashStatusChip({ status, columns, doneColumnId }: { status: string; columns: KanbanColumn[]; doneColumnId: string }) {
  const id = status === 'completed' ? doneColumnId : status;
  const col = columns.find(c => c.id === id);
  const label = (col?.label ?? status.replace(/_/g, ' ')).toUpperCase();
  const tone =
    id === 'in_progress' ? 'text-violet-700 dark:text-violet-300' :
    id === 'in_review' ? 'text-sky-700 dark:text-sky-300' :
    id === 'done' || status === 'completed' ? 'text-emerald-700 dark:text-emerald-300' :
    id === 'testing' ? 'text-amber-800 dark:text-amber-300' :
    'text-muted-foreground';
  return <span className={`text-[10px] font-semibold tracking-wide whitespace-nowrap ${tone}`}>{label}</span>;
}

function DashStatusBullet({ status, doneColumnId, dueDate }: { status: string; doneColumnId: string; dueDate?: string }) {
  const id = status === 'completed' ? doneColumnId : status;
  const isDone = id === 'done' || status === 'completed';
  const overdue = !isDone && getDueBucket(dueDate ?? '') === 'overdue';
  const title = overdue ? 'Overdue' : (id.replace(/_/g, ' ') || 'Backlog');
  const dot =
    isDone ? 'bg-emerald-500' :
    overdue ? 'bg-red-500' :
    id === 'in_progress' ? 'bg-violet-500' :
    id === 'in_review' ? 'bg-sky-500' :
    id === 'testing' ? 'bg-amber-500' :
    'border-[1.5px] border-muted-foreground/45 bg-transparent';
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} title={title} aria-hidden />;
}

const LIST_COLS = 'grid grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_5rem_5.5rem] gap-2 items-center';

function DashListTaskRow({
  task, indent, columns, doneColumnId, allTasks, users, onClick, expandedId, onToggleExpand,
}: {
  task: Task;
  indent: number;
  columns: KanbanColumn[];
  doneColumnId: string;
  allTasks: Task[];
  users: { id: string; name: string; avatar: string }[];
  onClick: (t: Task) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
}) {
  const open = expandedId === task.id;
  const kids = childTasksOf(allTasks, task.id).filter(t => !isTaskConfirmed(t));
  const aids = taskAssigneeIds(task);
  const assignees = aids.map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;
  const priority = normalizePriority(task.priority);
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onClick(task)}
        onKeyDown={e => { if (e.key === 'Enter') onClick(task); }}
        className={`${LIST_COLS} min-h-9 mt-1 px-2 py-1 text-sm hover:bg-muted/40 cursor-pointer border-t border-dashed border-border/50`}
        style={{ paddingLeft: 8 + indent * 16 }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {kids.length > 0 ? (
            <button
              type="button"
              className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
              onClick={e => { e.stopPropagation(); onToggleExpand(task.id); }}
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
          <DashStatusBullet status={task.status} doneColumnId={doneColumnId} dueDate={task.dueDate} />
          <span className="truncate font-medium">{task.title}</span>
          {kids.length > 0 && (
            <span className="text-[10px] text-muted-foreground shrink-0">{kids.length}</span>
          )}
        </div>
        <div className="flex items-center gap-1 min-w-0">
          {assignees.slice(0, 2).map(u => (
            <UserAvatar key={u.id} name={u.name} avatar={u.avatar} size="xs" />
          ))}
          {assignees.length === 0 && <span className="text-[11px] text-muted-foreground">—</span>}
        </div>
        <div className="justify-self-start"><DashStatusChip status={task.status} columns={columns} doneColumnId={doneColumnId} /></div>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full justify-self-start ${priorityBadgeStyles[priority]}`}>{priority}</span>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{listDate(task.dueDate)}</span>
      </div>
      {open && kids.map(st => (
        <DashListTaskRow
          key={st.id}
          task={st}
          indent={indent + 1}
          columns={columns}
          doneColumnId={doneColumnId}
          allTasks={allTasks}
          users={users}
          onClick={onClick}
          expandedId={expandedId}
          onToggleExpand={onToggleExpand}
        />
      ))}
    </>
  );
}

const DashboardPage = () => {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const selectProject = useAppStore(s => s.selectProject);
  const tasks = useAppStore(s => s.tasks);
  const selectedProjectId = useAppStore(s => s.selectedProjectId);
  const users = useAppStore(s => s.users);
  const moveTask = useAppStore(s => s.moveTask);
  const kanbanColumns = useAppStore(s => s.kanbanColumns);
  const approveTask = useAppStore(s => s.approveTask);
  const activeTimers = useAppStore(s => s.activeTimers);
  const stopTimer = useAppStore(s => s.stopTimer);
  const addColumn = useAppStore(s => s.addColumn);
  const renameColumn = useAppStore(s => s.renameColumn);
  const removeColumn = useAppStore(s => s.removeColumn);
  const reorderColumns = useAppStore(s => s.reorderColumns);
  const mascotsEnabled = useAppStore(s => s.mascotsEnabled);
  const setMascotDrag = useAppStore(s => s.setMascotDrag);
  const setMascotDropTask = useAppStore(s => s.setMascotDropTask);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  useEffect(() => {
    function handle(e: Event) {
      const taskId = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (!taskId) return;
      const found = tasks.find(t => t.id === taskId);
      if (found) setSelectedTask(found);
    }
    window.addEventListener('zet:open-task', handle);
    return () => window.removeEventListener('zet:open-task', handle);
  }, [tasks]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<'task' | 'column' | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | undefined>();
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Done column selection (persisted)
  const [doneColumnId, setDoneColumnId] = useState<string>(() => localStorage.getItem(DONE_COL_KEY) ?? 'done');

  // Add column modal
  const [addColOpen, setAddColOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const addColInputRef = useRef<HTMLInputElement>(null);

  // Rename column modal
  const [renameColOpen, setRenameColOpen] = useState(false);
  const [renamingCol, setRenamingCol] = useState<KanbanColumn | null>(null);
  const [renameColName, setRenameColName] = useState('');
  const renameColInputRef = useRef<HTMLInputElement>(null);

  const boardColumns = useMemo(() => kanbanColumns.length > 0 ? kanbanColumns
    : [{ id: 'backlog', label: 'Backlog' }, { id: 'in_progress', label: 'In Progress' }, { id: 'in_review', label: 'In Review' }, { id: 'done', label: 'Done' }],
  [kanbanColumns]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const collisionDetection = useCallback<CollisionDetection>(args => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  }, []);

  const userProjects = useMemo(
    () => (currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : []),
    [currentUser, projects],
  );
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const isAllProjects = selectedProjectId === 'all';
  const projectSelected = isAllProjects || (!!selectedProjectId && userProjects.some(p => p.id === selectedProjectId));
  const scopedTasks = useMemo(() => {
    if (!projectSelected) return [];
    const base = isAllProjects
      ? tasks.filter(t => userProjects.some(p => p.id === t.projectId))
      : tasks.filter(t => t.projectId === selectedProjectId);
    // Nested story subtasks stay under their parent — never as top-level cards.
    return base.filter(isTopLevelTask);
  }, [projectSelected, isAllProjects, tasks, userProjects, selectedProjectId]);

  const [dashPriorityFilter, setDashPriorityFilter] = useState<Set<Priority>>(() => new Set());
  const [dashDateFrom, setDashDateFrom] = useState('');
  const [dashDateTo, setDashDateTo] = useState('');
  const [dashAssigneeFilter, setDashAssigneeFilter] = useState<Set<string>>(() => new Set());
  const [dashSprintFilter, setDashSprintFilter] = useState<Set<string>>(() => new Set());
  const [dashStories, setDashStories] = useState<UserStory[]>([]);
  const [dashView, setDashView] = useState<DashView>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    return saved === 'board' || saved === 'list' ? saved : 'list';
  });
  const [expandedStoryId, setExpandedStoryId] = useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set());
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [lockCreateStory, setLockCreateStory] = useState<UserStory | null>(null);
  const [assignStory, setAssignStory] = useState<UserStory | null>(null);
  const [assignIds, setAssignIds] = useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = useState(false);
  const [createStoryOpen, setCreateStoryOpen] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [creatingStory, setCreatingStory] = useState(false);

  const storyTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of dashStories) m[s.id] = s.title;
    return m;
  }, [dashStories]);

  useEffect(() => {
    const ids = !selectedProjectId
      ? []
      : selectedProjectId === 'all'
        ? userProjects.map(p => p.id)
        : [selectedProjectId];
    if (ids.length === 0) {
      setDashStories([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = (await Promise.all(ids.map(id => api.listProjectUserStories(id)))).flat();
        if (!cancelled) setDashStories(rows);
      } catch {
        if (!cancelled) setDashStories([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId, userProjects]);

  const dashStoryMembers = useMemo(() => {
    const pid = assignStory?.projectId
      ?? (selectedProjectId && selectedProjectId !== 'all' ? selectedProjectId : null);
    if (!pid) return [];
    const p = userProjects.find(pr => pr.id === pid);
    if (!p) return [];
    return users.filter(u => p.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [assignStory, selectedProjectId, userProjects, users]);

  const projectTasks = scopedTasks;

  const openAssignStory = (s: UserStory) => {
    setAssignStory(s);
    setAssignIds(new Set(storyAssigneeIds(s)));
  };

  const saveAssignStory = async () => {
    if (!assignStory) return;
    setAssignSaving(true);
    try {
      const updated = await api.patchUserStory(assignStory.id, { assigneeIds: [...assignIds] });
      setDashStories(prev => prev.map(x => (x.id === updated.id ? updated : x)));
      toast.success('User story assignees updated');
      setAssignStory(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update assignees');
    } finally {
      setAssignSaving(false);
    }
  };

  const openCreateStory = () => {
    setNewStoryTitle('');
    setCreateStoryOpen(true);
  };

  const saveNewStory = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    if (!newStoryTitle.trim()) {
      toast.error('Title is required');
      return;
    }
    setCreatingStory(true);
    try {
      const story = await api.createUserStory({
        projectId: selectedProjectId,
        title: newStoryTitle.trim(),
      });
      setDashStories(prev => [story, ...prev]);
      toast.success('User story created');
      setCreateStoryOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create user story');
    } finally {
      setCreatingStory(false);
    }
  };

  const toggleDashSprint = useCallback((value: string) => {
    setDashSprintFilter(prev => {
      const n = new Set(prev);
      if (n.has(value)) n.delete(value);
      else n.add(value);
      return n;
    });
  }, []);

  const dashSprintOptions = useMemo(() => {
    const names = new Set<string>();
    let hasBlank = false;
    for (const t of scopedTasks) {
      const s = (t.sprint ?? '').trim();
      if (s) names.add(s);
      else hasBlank = true;
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), hasBlank };
  }, [scopedTasks]);

  const toggleDashPriority = useCallback((p: Priority) => {
    setDashPriorityFilter(prev => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);

  const toggleDashAssignee = useCallback((userId: string) => {
    setDashAssigneeFilter(prev => {
      const n = new Set(prev);
      if (n.has(userId)) n.delete(userId);
      else n.add(userId);
      return n;
    });
  }, []);

  const dashFilterableMembers = useMemo(() => {
    const memberIds = new Set<string>();
    if (isAllProjects) {
      for (const p of userProjects) {
        for (const id of p.members) memberIds.add(id);
      }
    } else if (selectedProjectId) {
      const p = userProjects.find(pr => pr.id === selectedProjectId);
      if (p) for (const id of p.members) memberIds.add(id);
    }
    return users
      .filter(u => memberIds.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, userProjects, isAllProjects, selectedProjectId]);

  const filteredProjectTasks = useMemo(
    () =>
      projectTasks.filter(
        t =>
          taskMatchesPriorityFilter(t, dashPriorityFilter) &&
          taskMatchesDueDateRange(t, dashDateFrom, dashDateTo) &&
          taskMatchesAssigneeFilter(t, dashAssigneeFilter) &&
          taskMatchesSprintFilter(t, dashSprintFilter),
      ),
    [projectTasks, dashPriorityFilter, dashDateFrom, dashDateTo, dashAssigneeFilter, dashSprintFilter],
  );

  const storyIds = useMemo(() => new Set(dashStories.map(s => s.id)), [dashStories]);
  const orphanTasks = useMemo(
    () => filteredProjectTasks.filter(t => !t.userStoryId || !storyIds.has(t.userStoryId)),
    [filteredProjectTasks, storyIds],
  );
  const listProjectBlocks = useMemo(() => {
    const source = isAllProjects
      ? userProjects
      : userProjects.filter(p => p.id === selectedProjectId);
    return source.map(p => ({
      projectId: p.id,
      projectName: projectPickerLabel(p),
      stories: dashStories.filter(s => s.projectId === p.id),
      orphans: orphanTasks.filter(t => t.projectId === p.id && !isTaskConfirmed(t)),
    })).filter(b => !isAllProjects || b.stories.length > 0 || b.orphans.length > 0);
  }, [isAllProjects, userProjects, dashStories, orphanTasks, selectedProjectId]);

  const tasksForColumn = (colId: string) =>
    filteredProjectTasks.filter(t => t.status === colId && !isTaskConfirmed(t));

  const handleSetDoneColumn = (colId: string) => {
    const next = doneColumnId === colId ? 'done' : colId;
    setDoneColumnId(next);
    localStorage.setItem(DONE_COL_KEY, next);
  };

  const openRename = (col: KanbanColumn) => {
    setRenamingCol(col);
    setRenameColName(col.label);
    setRenameColOpen(true);
  };

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type as 'task' | 'column' | undefined;
    setActiveId(event.active.id as string);
    setActiveType(type === 'column' ? 'column' : 'task');
    // A task drag begins → light up the mascot drop affordance.
    if (mascotsEnabled && type !== 'column') setMascotDrag(true, false);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    const isTaskDrag = active.data.current?.type !== 'column';
    if (mascotsEnabled && isTaskDrag) setMascotDrag(true, over?.id === 'tasker-dropzone');
    if (!over || active.data.current?.type === 'column') { setOverColumnId(null); return; }
    const overId = over.id as string;
    if (overId === 'tasker-dropzone') { setOverColumnId(null); return; }
    if (boardColumns.some(c => c.id === overId)) { setOverColumnId(overId); return; }
    const task = tasks.find(t => t.id === overId);
    setOverColumnId(task ? task.status : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null); setActiveType(null); setOverColumnId(null);
    setMascotDrag(false, false);
    if (!over) return;
    const dragType = active.data.current?.type as 'task' | 'column' | undefined;
    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    // Dropped on the Tasker mascot → open its quick-action menu for this task.
    if (overIdStr === 'tasker-dropzone') {
      if (dragType !== 'column') setMascotDropTask(activeIdStr);
      return;
    }

    if (dragType === 'column') {
      const oldIdx = boardColumns.findIndex(c => c.id === activeIdStr);
      const newIdx = boardColumns.findIndex(c => c.id === overIdStr);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        try { await reorderColumns(arrayMove(boardColumns, oldIdx, newIdx)); }
        catch { toast.error('Could not reorder columns'); }
      }
      return;
    }

    const targetColumn = boardColumns.find(c => c.id === overIdStr);
    if (targetColumn) {
      try {
        if (targetColumn.id === doneColumnId && activeTimers[activeIdStr]) {
          await stopTimer(activeIdStr);
        }
        await moveTask(activeIdStr, targetColumn.id);
        // Tasker mascot animates the move.
      }
      catch { toast.error('Could not move task'); }
      return;
    }
    const targetTask = tasks.find(t => t.id === overIdStr);
    if (targetTask && targetTask.id !== activeIdStr) {
      try {
        if (targetTask.status === doneColumnId && activeTimers[activeIdStr]) {
          await stopTimer(activeIdStr);
        }
        await moveTask(activeIdStr, targetTask.status);
      }
      catch { toast.error('Could not move task'); }
    }
  };

  const handleDragCancel = () => {
    setActiveId(null); setActiveType(null); setOverColumnId(null);
    setMascotDrag(false, false);
  };

  const handleApprove = async (id: string) => {
    const task = tasks.find(t => t.id === id);
    if (task && isTaskConfirmed(task)) return;
    setApprovingId(id);
    try {
      await approveTask(id);
      // Tasker mascot animates the approval.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve task');
    } finally { setApprovingId(null); }
  };

  const handleAddColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newColName.trim();
    if (!name) return;
    try {
      await addColumn(name);
      toast.success(`Column "${name}" added`);
      setNewColName(''); setAddColOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add column'); }
  };

  const handleRenameColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingCol || !renameColName.trim()) return;
    try {
      await renameColumn(renamingCol.id, renameColName.trim());
      toast.success('Column renamed');
      setRenameColOpen(false); setRenamingCol(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not rename column'); }
  };

  const handleDeleteColumn = async (colId: string) => {
    if (!window.confirm('Delete this column? Tasks inside will move to Backlog.')) return;
    try {
      await removeColumn(colId);
      if (doneColumnId === colId) { setDoneColumnId('done'); localStorage.setItem(DONE_COL_KEY, 'done'); }
      toast.success('Column deleted');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not delete column'); }
  };

  const activeTask = activeId && activeType === 'task' ? tasks.find(t => t.id === activeId) : null;
  const activeColumn = activeId && activeType === 'column' ? boardColumns.find(c => c.id === activeId) : null;

  if (!currentUser) return null;

  if (userProjects.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}
        className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center">
        <h1 className="text-2xl font-semibold text-foreground">No project yet</h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">
          {isManager ? 'Create a project first, then pick it in the header to open your dashboard.' : 'You are not in any project yet. Ask a manager to add you to one.'}
        </p>
        {isManager && <Button asChild className="mt-8 rounded-xl"><Link to="/manage">Manage projects</Link></Button>}
      </motion.div>
    );
  }

  if (!projectSelected) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}
        className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center">
        <h1 className="text-2xl font-semibold text-foreground">Select a project</h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">Choose a project from the menu at the top, or pick one here.</p>
        <select value={selectedProjectId || ''} onChange={e => selectProject(e.target.value || null)}
          className="mt-8 rounded-xl border bg-muted/50 px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[240px]">
          <option value="">Choose a project…</option>
          <option value="all">All projects</option>
          {userProjects.map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
        </select>
      </motion.div>
    );
  }

  const selectedProjectName = isAllProjects
    ? 'All projects'
    : (() => {
        const p = userProjects.find(pr => pr.id === selectedProjectId);
        return p ? projectPickerLabel(p) : 'Dashboard';
      })();

  const dashPriorityOptions: Priority[] = ['Urgent', 'High', 'Medium', 'Low'];
  const setView = (v: DashView) => {
    setDashView(v);
    localStorage.setItem(VIEW_KEY, v);
  };
  const toggleStoryExpanded = (id: string) => {
    setExpandedStoryId(prev => (prev === id ? null : id));
    setExpandedTaskId(null);
  };
  const toggleProjectExpanded = (projectId: string) => {
    setCollapsedProjectIds(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
    setExpandedStoryId(null);
    setExpandedTaskId(null);
  };
  const toggleTaskExpanded = (id: string) => {
    setExpandedTaskId(prev => (prev === id ? null : id));
  };

  const openCreateForStory = (story: UserStory | null, status?: string) => {
    setLockCreateStory(story);
    setCreateStatus(status);
    setCreateOpen(true);
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-3 sm:p-4 h-full flex flex-col overflow-hidden">
      <div className="mb-3 shrink-0 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">{selectedProjectName}</h1>
          <div className="inline-flex h-8 shrink-0 rounded-lg border border-border/70 bg-card/70 p-0.5">
            <button
              type="button"
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${dashView === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="h-3.5 w-3.5" /> Tasks List
            </button>
            <button
              type="button"
              onClick={() => setView('board')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${dashView === 'board' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Columns className="h-3.5 w-3.5" /> Progress Board
            </button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <DashFilterSelect
            allLabel="All sprints"
            open={openFilter === 'sprint'}
            onOpenChange={o => setOpenFilter(o ? 'sprint' : null)}
            selected={dashSprintFilter}
            onToggle={toggleDashSprint}
            onClear={() => setDashSprintFilter(new Set())}
            emptyText="No sprints on these tasks yet."
            options={[
              ...(dashSprintOptions.hasBlank
                ? [{ id: NO_SPRINT_FILTER_ID, text: 'No sprint' }]
                : []),
              ...dashSprintOptions.names.map(name => ({ id: name, text: name })),
            ]}
          />
          <DashFilterSelect
            allLabel="All people"
            open={openFilter === 'people'}
            onOpenChange={o => setOpenFilter(o ? 'people' : null)}
            selected={dashAssigneeFilter}
            onToggle={toggleDashAssignee}
            onClear={() => setDashAssigneeFilter(new Set())}
            emptyText="No team members in this view."
            options={[
              {
                id: UNASSIGNED_FILTER_ID,
                text: 'Unassigned',
                label: (
                  <>
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted/60 ring-1 ring-border/50">
                      <Users className="h-3 w-3 text-muted-foreground" />
                    </span>
                    Unassigned
                  </>
                ),
              },
              ...dashFilterableMembers.map(u => ({
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
            onOpenChange={o => setOpenFilter(o ? 'priority' : null)}
            selected={dashPriorityFilter}
            onToggle={id => toggleDashPriority(id as Priority)}
            onClear={() => setDashPriorityFilter(new Set())}
            options={dashPriorityOptions.map(p => ({ id: p, text: p }))}
          />
          <DateRangeField
            from={dashDateFrom}
            to={dashDateTo}
            onChange={(f, t) => { setDashDateFrom(f); setDashDateTo(t); }}
            placeholder="Any due date"
          />
          {dashView === 'list' && !isAllProjects && (
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1 text-xs"
              onClick={openCreateStory}
            >
              <Plus className="h-3.5 w-3.5" /> Add story
            </Button>
          )}
        </div>
      </div>

      {dashView === 'list' ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-[40rem]">
          <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_7.5rem_5rem_5.5rem] gap-2 items-center sticky top-0 z-10 bg-background/95 backdrop-blur px-2 py-1.5 text-[11px] font-medium text-muted-foreground">
            <span>Task</span>
            <span>Assignee</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Due date</span>
          </div>
          {listProjectBlocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <BookOpen className="h-7 w-7 text-muted-foreground/40 mb-2" />
              <p className="text-sm text-muted-foreground">
                No user stories yet. Create one — tasks live under a story.
              </p>
            </div>
          ) : (
            <div className="space-y-4 p-2">
              {listProjectBlocks.map(block => {
                const noneId = `${block.projectId}::none`;
                const empty = block.stories.length === 0 && block.orphans.length === 0;
                const projectExpanded = !collapsedProjectIds.has(block.projectId);
                return (
            <div key={block.projectId} className="rounded-xl border border-dashed border-border p-2 space-y-2">
              <div
                role="button"
                tabIndex={0}
                onClick={() => toggleProjectExpanded(block.projectId)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleProjectExpanded(block.projectId); } }}
                className="flex items-center gap-2 px-2 py-1.5 hover:bg-muted/40 cursor-pointer rounded-lg"
              >
                <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${projectExpanded ? 'rotate-90' : ''}`} />
                <FolderOpen className="h-4 w-4 text-primary shrink-0" />
                <span className="text-sm font-semibold truncate">{block.projectName}</span>
              </div>
              {projectExpanded && empty ? (
                <p className="px-2 pb-2 text-xs text-muted-foreground">
                  No user stories yet. Create one — tasks live under a story.
                </p>
              ) : null}
              {projectExpanded && block.stories.map(s => {
                const storyTasks = filteredProjectTasks.filter(t => t.userStoryId === s.id);
                const openStoryTasks = storyTasks.filter(t => !isTaskConfirmed(t));
                const expanded = expandedStoryId === s.id;
                const aids = storyAssigneeIds(s);
                const doneN = storyTasks.filter(t => t.status === 'done' || t.status === 'completed' || t.status === doneColumnId).length;
                return (
                  <div key={s.id} className="rounded-lg border border-dashed border-border/70 overflow-hidden">
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleStoryExpanded(s.id)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStoryExpanded(s.id); } }}
                      className={`${LIST_COLS} min-h-10 px-2 py-1 hover:bg-muted/40 cursor-pointer`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
                        <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="truncate font-semibold text-sm">{s.title}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{doneN}/{storyTasks.length}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {aids.slice(0, 2).map(id => {
                          const u = users.find(x => x.id === id);
                          return u ? <UserAvatar key={id} name={u.name} avatar={u.avatar} size="xs" /> : null;
                        })}
                      </div>
                      <span className="text-[11px] text-muted-foreground">Story</span>
                      <span />
                      <div className="flex items-center justify-end gap-1">
                        <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={e => { e.stopPropagation(); openAssignStory(s); }}>Assign</Button>
                        <Button type="button" size="sm" variant="ghost" className="h-6 text-[10px] px-1.5" onClick={e => { e.stopPropagation(); openCreateForStory(s, 'backlog'); }}><Plus className="h-3 w-3" /></Button>
                      </div>
                    </div>
                    {expanded && openStoryTasks.map(t => (
                      <DashListTaskRow
                        key={t.id}
                        task={t}
                        indent={1}
                        columns={boardColumns}
                        doneColumnId={doneColumnId}
                        allTasks={tasks}
                        users={users}
                        onClick={setSelectedTask}
                        expandedId={expandedTaskId}
                        onToggleExpand={toggleTaskExpanded}
                      />
                    ))}
                  </div>
                );
              })}
              {projectExpanded && block.orphans.length > 0 && (
                <div className="rounded-lg border border-dashed border-border/70 overflow-hidden">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleStoryExpanded(noneId)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleStoryExpanded(noneId); } }}
                    className={`${LIST_COLS} min-h-10 px-2 py-1 hover:bg-muted/40 cursor-pointer`}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expandedStoryId === noneId ? 'rotate-90' : ''}`} />
                      <span className="truncate font-semibold text-sm text-muted-foreground">No story</span>
                      <span className="text-[10px] text-muted-foreground">{block.orphans.length}</span>
                    </div>
                    <span /><span /><span /><span />
                  </div>
                  {expandedStoryId === noneId && block.orphans.map(t => (
                    <DashListTaskRow
                      key={t.id}
                      task={t}
                      indent={1}
                      columns={boardColumns}
                      doneColumnId={doneColumnId}
                      allTasks={tasks}
                      users={users}
                      onClick={setSelectedTask}
                      expandedId={expandedTaskId}
                      onToggleExpand={toggleTaskExpanded}
                    />
                  ))}
                </div>
              )}
            </div>
                );
              })}
            </div>
          )}
          </div>
        </div>
      ) : (
      <DndContext sensors={sensors} collisionDetection={collisionDetection}
        onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>
        <SortableContext items={boardColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          <KanbanBoardPan className="flex gap-4 lg:gap-3 flex-1 min-h-0 pb-4">
            {boardColumns.map(col => (
              <KanbanColumnPanel
                key={col.id} column={col}
                tasks={tasksForColumn(col.id)}
                onTaskClick={setSelectedTask}
                onNewTask={() => openCreateForStory(null, col.id)}
                isDropTarget={overColumnId === col.id}
                isManager={!!isManager}
                approvingId={approvingId}
                onApprove={handleApprove}
                isDoneColumn={col.id === doneColumnId}
                onSetDoneColumn={() => handleSetDoneColumn(col.id)}
                onRenameColumn={() => openRename(col)}
                onDeleteColumn={() => { void handleDeleteColumn(col.id); }}
                showProjectPill={isAllProjects}
                storyTitleById={storyTitleById}
              />
            ))}
          </KanbanBoardPan>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="w-[280px] sm:w-[320px] cursor-grabbing rotate-1 scale-[1.02] pointer-events-none">
              <TaskCard task={activeTask} onClick={() => {}} showProjectPill={isAllProjects} />
            </div>
          )}
          {activeColumn && (
            <div className="rounded-2xl border-2 border-primary/30 bg-card/95 backdrop-blur-sm p-4 shadow-2xl w-[280px] sm:w-[320px] cursor-grabbing rotate-1 opacity-90">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{activeColumn.label}</span>
              </div>
            </div>
          )}
        </DragOverlay>

        {mascotsEnabled && <MascotDropZone />}
      </DndContext>
      )}

      {/* Add Column Modal */}
      <Dialog open={addColOpen} onOpenChange={setAddColOpen}>
        <DialogContent className="sm:w-[75vw]" onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => addColInputRef.current?.focus(), 50); }}>
          <DialogHeader><DialogTitle>Add Column</DialogTitle></DialogHeader>
          <form onSubmit={e => { void handleAddColumn(e); }} className="space-y-4 pt-1">
            <input
              ref={addColInputRef}
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              placeholder="Column name…"
              className="w-full rounded-xl border bg-muted/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddColOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newColName.trim()}>Add Column</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Column Modal */}
      <Dialog open={renameColOpen} onOpenChange={setRenameColOpen}>
        <DialogContent className="sm:w-[75vw]" onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => renameColInputRef.current?.focus(), 50); }}>
          <DialogHeader><DialogTitle>Rename Column</DialogTitle></DialogHeader>
          <form onSubmit={e => { void handleRenameColumn(e); }} className="space-y-4 pt-1">
            <input
              ref={renameColInputRef}
              value={renameColName}
              onChange={e => setRenameColName(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenameColOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!renameColName.trim()}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal
        open={createOpen}
        initialStatus={createStatus}
        lockStory={lockCreateStory}
        onOpenChange={o => {
          setCreateOpen(o);
          if (!o) setLockCreateStory(null);
        }}
      />

      <Dialog open={!!assignStory} onOpenChange={o => !o && setAssignStory(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign user story</DialogTitle>
          </DialogHeader>
          {assignStory && (
            <div className="space-y-3">
              <p className="text-sm font-medium">{assignStory.title}</p>
              <AssigneeMultiSelect
                members={dashStoryMembers}
                selectedIds={assignIds}
                onChange={setAssignIds}
              />
              <Button type="button" className="w-full" disabled={assignSaving} onClick={() => void saveAssignStory()}>
                Save assignees
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={createStoryOpen} onOpenChange={setCreateStoryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New user story</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <input
                value={newStoryTitle}
                onChange={e => setNewStoryTitle(e.target.value)}
                placeholder="As a user, I want…"
                className="w-full rounded-xl border bg-muted/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={creatingStory || !newStoryTitle.trim()}
              onClick={() => void saveNewStory()}
            >
              {creatingStory ? 'Creating…' : 'Create user story'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default DashboardPage;
