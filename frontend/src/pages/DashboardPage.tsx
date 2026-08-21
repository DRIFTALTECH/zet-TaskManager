import { useAppStore } from '@/stores/appStore';
import DateRangeField from '@/components/DateRangeField';
import { projectPickerLabel } from '@/lib/project-utils';
import { Task, Priority, KanbanColumn } from '@/types';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  MoreHorizontal, Pencil, Trash2, Flag, Check,
  ListFilter, Users, BookOpen,
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
import { snappy, pageEnter } from '@/lib/motion';
import {
  taskMatchesDashboardDueFilter,
  taskMatchesDueDateRange,
  taskMatchesPriorityFilter,
  type DashboardDueFilter,
} from '@/lib/due-date-utils';
import { isTopLevelTask, storyAssigneeIds, taskMatchesAssigneeFilter, UNASSIGNED_FILTER_ID } from '@/lib/task-utils';
import UserAvatar from '@/components/UserAvatar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import AssigneeMultiSelect from '@/components/AssigneeMultiSelect';
import { api } from '@/lib/api';
import type { UserStory } from '@/types';

const PROTECTED_IDS = new Set(['backlog', 'in_progress', 'in_review', 'done']);
const DONE_COL_KEY = 'tm_done_col';

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20',
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
          {isDoneColumn && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/20 font-semibold">✓ Done</span>
          )}
        </div>
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

      <div className="space-y-4 flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-1 pt-3 pb-3">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <SortableTaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task)}
              showApprove={isManager && isDoneColumn}
              onApprove={() => onApprove(task.id)}
              approving={approvingId === task.id}
              showProjectPill={showProjectPill}
              userStoryTitle={task.userStoryId ? storyTitleById?.[task.userStoryId] : null}
            />
          ))}
        </SortableContext>
        <motion.button onClick={onNewTask} transition={snappy} whileHover={{ scale: 1.01, y: -1 }} whileTap={{ scale: 0.99 }}
          className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-2.5 rounded-xl border border-dashed border-border/50 hover:border-foreground/30 hover:text-foreground hover:bg-muted/50 transition-colors duration-100">
          <Plus className="h-3.5 w-3.5" /> New Task
        </motion.button>
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
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<'task' | 'column' | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
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
  const projectTasks = useMemo(() => {
    if (!projectSelected) return [];
    const base = isAllProjects
      ? tasks.filter(t => userProjects.some(p => p.id === t.projectId) && t.status !== 'completed')
      : tasks.filter(t => t.projectId === selectedProjectId && t.status !== 'completed');
    // Nested story subtasks stay under their parent — never as top-level cards.
    return base.filter(isTopLevelTask);
  }, [projectSelected, isAllProjects, tasks, userProjects, selectedProjectId]);

  const [dashPriorityFilter, setDashPriorityFilter] = useState<Set<Priority>>(() => new Set());
  const [dashDueFilter, setDashDueFilter] = useState<DashboardDueFilter>('all');
  const [dashDateFrom, setDashDateFrom] = useState('');
  const [dashDateTo, setDashDateTo] = useState('');
  const [dashAssigneeFilter, setDashAssigneeFilter] = useState<Set<string>>(() => new Set());
  const [dashStories, setDashStories] = useState<UserStory[]>([]);
  const [assignStory, setAssignStory] = useState<UserStory | null>(null);
  const [assignIds, setAssignIds] = useState<Set<string>>(new Set());
  const [assignSaving, setAssignSaving] = useState(false);
  const [createStoryOpen, setCreateStoryOpen] = useState(false);
  const [newStoryTitle, setNewStoryTitle] = useState('');
  const [newStorySectionId, setNewStorySectionId] = useState('');
  const [creatingStory, setCreatingStory] = useState(false);

  const storyTitleById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const s of dashStories) m[s.id] = s.title;
    return m;
  }, [dashStories]);

  useEffect(() => {
    if (!selectedProjectId || selectedProjectId === 'all') {
      setDashStories([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const rows = await api.listProjectUserStories(selectedProjectId);
        if (!cancelled) setDashStories(rows);
      } catch {
        if (!cancelled) setDashStories([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const dashStoryMembers = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === 'all') return [];
    const p = userProjects.find(pr => pr.id === selectedProjectId);
    if (!p) return [];
    return users.filter(u => p.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedProjectId, userProjects, users]);

  const selectedProjectSections = useMemo(() => {
    if (!selectedProjectId || selectedProjectId === 'all') return [];
    return userProjects.find(p => p.id === selectedProjectId)?.sections ?? [];
  }, [selectedProjectId, userProjects]);

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
    setNewStorySectionId(selectedProjectSections[0]?.id ?? '');
    setCreateStoryOpen(true);
  };

  const saveNewStory = async () => {
    if (!selectedProjectId || selectedProjectId === 'all') return;
    if (!newStoryTitle.trim() || !newStorySectionId) {
      toast.error('Title and section are required');
      return;
    }
    setCreatingStory(true);
    try {
      const story = await api.createUserStory({
        projectId: selectedProjectId,
        sectionId: newStorySectionId,
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
          taskMatchesDashboardDueFilter(t, dashDueFilter) &&
          taskMatchesDueDateRange(t, dashDateFrom, dashDateTo) &&
          taskMatchesAssigneeFilter(t, dashAssigneeFilter),
      ),
    [projectTasks, dashPriorityFilter, dashDueFilter, dashDateFrom, dashDateTo, dashAssigneeFilter],
  );

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

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-4 sm:p-6 h-full flex flex-col overflow-hidden">
      <div className="mb-6 shrink-0 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">{selectedProjectName}</h1>
          {isAllProjects && (
            <p className="text-sm text-muted-foreground mt-1">Tasks across every project you belong to</p>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-3 sm:justify-end">
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="rounded-xl gap-2 h-9 border-border/80">
                <Users className="h-4 w-4 shrink-0" />
                Person
                {dashAssigneeFilter.size > 0 && (
                  <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md bg-primary/15 text-primary">
                    {dashAssigneeFilter.size}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <p className="text-xs font-semibold text-foreground mb-1">Filter by person</p>
              <p className="text-[10px] text-muted-foreground mb-3">
                Show tasks for selected people, or Unassigned. Leave all off to show everyone.
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto">
                <label className="flex items-center gap-2.5 py-1.5 cursor-pointer rounded-lg hover:bg-muted/50 px-1 -mx-1">
                  <Checkbox
                    checked={dashAssigneeFilter.has(UNASSIGNED_FILTER_ID)}
                    onCheckedChange={() => toggleDashAssignee(UNASSIGNED_FILTER_ID)}
                  />
                  <span className="size-6 rounded-full bg-muted/60 ring-1 ring-border/50 flex items-center justify-center shrink-0">
                    <Users className="h-3 w-3 text-muted-foreground" />
                  </span>
                  <span className="text-sm text-foreground truncate">Unassigned</span>
                </label>
                {dashFilterableMembers.map(u => (
                  <label key={u.id} className="flex items-center gap-2.5 py-1.5 cursor-pointer rounded-lg hover:bg-muted/50 px-1 -mx-1">
                    <Checkbox
                      checked={dashAssigneeFilter.has(u.id)}
                      onCheckedChange={() => toggleDashAssignee(u.id)}
                    />
                    <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                    <span className="text-sm text-foreground truncate">{u.name}</span>
                  </label>
                ))}
                {dashFilterableMembers.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No team members in this view.</p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full mt-3 rounded-lg text-xs"
                onClick={() => setDashAssigneeFilter(new Set())}
              >
                Clear person filter
              </Button>
            </PopoverContent>
          </Popover>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="rounded-xl gap-2 h-9 border-border/80">
                <ListFilter className="h-4 w-4 shrink-0" />
                Priority
                {dashPriorityFilter.size > 0 && (
                  <span className="text-[10px] font-semibold tabular-nums px-1.5 py-0.5 rounded-md bg-primary/15 text-primary">
                    {dashPriorityFilter.size}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64">
              <p className="text-xs font-semibold text-foreground mb-1">Filter by priority</p>
              <p className="text-[10px] text-muted-foreground mb-3">Check one or more. Leave all off to show every priority.</p>
              <div className="space-y-1">
                {dashPriorityOptions.map(p => (
                  <label key={p} className="flex items-center gap-2.5 py-1 cursor-pointer rounded-lg hover:bg-muted/50 px-1 -mx-1">
                    <Checkbox
                      checked={dashPriorityFilter.has(p)}
                      onCheckedChange={() => toggleDashPriority(p)}
                    />
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-md border ${priorityBadgeStyles[p]}`}>{p}</span>
                  </label>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full mt-3 rounded-lg text-xs"
                onClick={() => setDashPriorityFilter(new Set())}
              >
                Clear priority filter
              </Button>
            </PopoverContent>
          </Popover>
          <div className="flex flex-col gap-1 min-w-[11rem]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Due date</span>
            <select
              value={dashDueFilter}
              onChange={e => setDashDueFilter(e.target.value as DashboardDueFilter)}
              className="rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="all">All due dates</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="tomorrow">Due tomorrow</option>
              <option value="this_week">Due this week</option>
              <option value="later">Due in 7+ days</option>
            </select>
          </div>
          <div className="flex flex-col gap-1 min-w-[15rem]">
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Due between</span>
            <DateRangeField
              from={dashDateFrom}
              to={dashDateTo}
              onChange={(f, t) => { setDashDateFrom(f); setDashDateTo(t); }}
              placeholder="Any due date"
            />
          </div>
        </div>
      </div>

      {!isAllProjects && selectedProjectId && (
        <div className="mb-4 shrink-0 rounded-xl border border-border/40 bg-card/40 p-3">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <BookOpen className="h-3.5 w-3.5 text-primary" />
              User Stories
              <span className="font-normal text-muted-foreground/60">({dashStories.length})</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px] gap-1"
              onClick={openCreateStory}
              disabled={selectedProjectSections.length === 0}
            >
              <Plus className="h-3 w-3" /> Add story
            </Button>
          </div>
          {dashStories.length === 0 ? (
            <p className="text-[11px] text-muted-foreground/55">
              No user stories yet. Add one here, or open a task card to link an existing story.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {dashStories.map(s => {
                const aids = storyAssigneeIds(s);
                return (
                  <div
                    key={s.id}
                    className="inline-flex items-center gap-2 rounded-lg border border-border/35 bg-background/60 px-2.5 py-1.5 text-xs"
                  >
                    <span className="font-medium max-w-[14rem] truncate">{s.title}</span>
                    <span className="flex -space-x-1">
                      {aids.slice(0, 3).map(id => {
                        const u = users.find(x => x.id === id);
                        return u ? (
                          <UserAvatar key={id} name={u.name} avatar={u.avatar} size="xs" />
                        ) : null;
                      })}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[10px] px-2"
                      onClick={() => openAssignStory(s)}
                    >
                      Assign
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={collisionDetection}
        onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>
        <SortableContext items={boardColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          <KanbanBoardPan className="flex gap-4 lg:gap-3 flex-1 min-h-0 pb-4">
            {boardColumns.map(col => (
              <KanbanColumnPanel
                key={col.id} column={col}
                tasks={filteredProjectTasks.filter(t => t.status === col.id)}
                onTaskClick={setSelectedTask}
                onNewTask={() => setCreateOpen(true)}
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

            {/* "Add Column" is hidden: it competed for board width with the
                columns themselves, which now share the screen. The dialog and
                addColumn action remain wired up if it is brought back. */}
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
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />

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
              <label className="text-xs font-medium text-muted-foreground">Section</label>
              <select
                value={newStorySectionId}
                onChange={e => setNewStorySectionId(e.target.value)}
                className="w-full rounded-xl border bg-muted/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {selectedProjectSections.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
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
