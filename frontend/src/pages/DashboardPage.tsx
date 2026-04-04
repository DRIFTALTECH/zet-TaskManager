import { useAppStore } from '@/stores/appStore';
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
  Plus, CheckCircle, Play, Square, GripVertical,
  MoreHorizontal, Pencil, Trash2, Flag, Check,
} from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
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
import { isTaskAssignedTo, taskAssigneeIds } from '@/lib/task-utils';

const PROTECTED_IDS = new Set(['backlog', 'in_progress', 'in_review', 'done']);
const DONE_COL_KEY = 'tm_done_col';

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

const priorityGlowColor: Record<Priority, string> = {
  Urgent: 'rgba(239,68,68,0.25)',
  High: 'rgba(249,115,22,0.25)',
  Medium: 'rgba(234,179,8,0.2)',
  Low: 'rgba(34,197,94,0.2)',
};

function useElapsedTime(epochStart: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!epochStart) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [epochStart]);
  if (!epochStart) return '';
  const secs = Math.max(0, Math.floor((Date.now() - epochStart) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function TaskCard({
  task, onClick, showApprove, onApprove, approving, canDrag,
  isTimerActive, timerEpochStart, canStartTimer, onStartTimer, onStopTimer,
}: {
  task: Task; onClick: () => void;
  showApprove?: boolean; onApprove?: () => void; approving?: boolean;
  canDrag: boolean;
  isTimerActive: boolean; timerEpochStart: number | null;
  canStartTimer: boolean; onStartTimer: () => void; onStopTimer: () => void;
}) {
  const { users } = useAppStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id, data: { type: 'task' as const }, animateLayoutChanges: () => false, disabled: !canDrag,
  });
  const assigneeList = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;
  const elapsed = useElapsedTime(timerEpochStart);
  const isOverdue = new Date(task.dueDate) < new Date();
  const showTimer = (canStartTimer || isTimerActive) && task.status !== 'completed' && task.status !== 'done';
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined, opacity: isDragging ? 0 : 1, ...(isDragging ? { pointerEvents: 'none' as const } : {}) }}
      {...attributes} {...(canDrag ? listeners : {})}
      onClick={onClick}
      className={`group relative h-[250px] touch-none select-none ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
    >
      <div
        className="rounded-2xl border-2 border-border/70 bg-gradient-to-br from-muted/70 via-card to-muted/40 dark:from-muted/50 dark:via-card dark:to-muted/30 p-6 h-full flex flex-col transition-[transform,box-shadow] duration-200 ease-out will-change-transform group-hover:-translate-y-1.5 group-hover:scale-[1.02] shadow-md group-hover:shadow-xl group-hover:[box-shadow:0_20px_60px_-10px_var(--card-glow)]"
        style={{ ['--card-glow' as string]: priorityGlowColor[task.priority] }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-mono text-muted-foreground/60 tracking-wider">TF-{task.id.replace(/\D/g, '').padStart(3, '0')}</span>
          <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[task.priority]}`}>{task.priority}</span>
        </div>
        <h4 className="text-base font-bold leading-snug mb-3 text-foreground line-clamp-2">{task.title}</h4>
        <p className="text-sm text-muted-foreground leading-relaxed flex-1 overflow-hidden text-ellipsis line-clamp-3">{task.description || 'No description'}</p>
        <div className="flex items-center justify-between pt-4 mt-auto gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex -space-x-2 shrink-0">
              {assigneeList.slice(0, 3).map(u => (
                <div key={u.id} className="w-7 h-7 rounded-full bg-muted border-2 border-card flex items-center justify-center">
                  <span className="text-[10px] font-bold text-muted-foreground">{getInitials(u.name)}</span>
                </div>
              ))}
              {assigneeList.length === 0 && <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center"><span className="text-[10px] text-muted-foreground">?</span></div>}
            </div>
            <span className="text-sm text-muted-foreground font-medium truncate">
              {assigneeList.length === 0 ? 'Unassigned' : assigneeList.length === 1 ? assigneeList[0].name.split(' ')[0] : `${assigneeList.length} people`}
            </span>
          </div>
          <span className={`text-sm font-mono shrink-0 ${isOverdue ? 'text-destructive' : 'text-muted-foreground/60'}`}>{formatDate(task.dueDate)}</span>
        </div>
        {/* Start/Stop timer — bottom of card, assignees only, hidden in done/completed */}
        {showTimer && (
          <div className="pt-3 mt-1 border-t border-border/50" onClick={e => e.stopPropagation()}>
            {isTimerActive ? (
              <Button type="button" size="sm" variant="destructive"
                className="w-full rounded-xl gap-2 h-8 text-xs font-semibold"
                onClick={e => { e.stopPropagation(); onStopTimer(); }}>
                <Square className="h-3.5 w-3.5 fill-current" />
                Stop · {elapsed}
              </Button>
            ) : (
              <Button type="button" size="sm"
                className="w-full rounded-xl gap-2 h-8 text-xs font-semibold bg-primary/90 hover:bg-primary"
                onClick={e => { e.stopPropagation(); onStartTimer(); }}>
                <Play className="h-3.5 w-3.5 fill-current" />
                Start
              </Button>
            )}
          </div>
        )}
        {showApprove && (
          <div className="pt-3 mt-1 border-t border-border/50">
            <Button type="button" size="sm"
              className="w-full rounded-xl gap-1.5 bg-green-600 text-white hover:bg-green-700 border-green-600 shadow-sm"
              disabled={approving}
              onClick={e => { e.stopPropagation(); void onApprove?.(); }}>
              <CheckCircle className="h-3.5 w-3.5" />
              {approving ? 'Approving…' : 'Approve completed'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanColumnPanel({
  column, tasks, onTaskClick, onNewTask, isDropTarget, isManager, currentUserId,
  approvingId, onApprove, activeTimers, onStartTimer, onStopTimer,
  isDoneColumn, onSetDoneColumn, onRenameColumn, onDeleteColumn,
}: {
  column: KanbanColumn; tasks: Task[];
  onTaskClick: (t: Task) => void; onNewTask: () => void;
  isDropTarget: boolean; isManager: boolean; currentUserId: string;
  approvingId: string | null; onApprove: (id: string) => void;
  activeTimers: Record<string, number>; onStartTimer: (id: string) => void; onStopTimer: (id: string) => void;
  isDoneColumn: boolean; onSetDoneColumn: () => void;
  onRenameColumn: () => void; onDeleteColumn: () => void;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: column.id, data: { type: 'column' as const },
  });
  const isProtected = PROTECTED_IDS.has(column.id);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined, opacity: isDragging ? 0.4 : 1 }}
      className={`min-w-[380px] w-[380px] flex flex-col shrink-0 rounded-2xl transition-[box-shadow,background-color] duration-150 ease-out ${isDropTarget ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''}`}
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
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20 font-semibold">✓ Done</span>
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

      <div className="space-y-4 flex-1 px-0.5 min-h-[200px]">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard
              key={task.id} task={task}
              onClick={() => onTaskClick(task)}
              showApprove={isManager && isDoneColumn}
              onApprove={() => onApprove(task.id)}
              approving={approvingId === task.id}
              canDrag={isTaskAssignedTo(task, currentUserId)}
              isTimerActive={!!activeTimers[task.id]}
              timerEpochStart={activeTimers[task.id] ?? null}
              canStartTimer={isTaskAssignedTo(task, currentUserId)}
              onStartTimer={() => onStartTimer(task.id)}
              onStopTimer={() => onStopTimer(task.id)}
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

const DashboardPage = () => {
  const {
    currentUser, projects, selectProject, tasks, selectedProjectId,
    moveTask, kanbanColumns, approveTask,
    activeTimers, startTimer, stopTimer,
    addColumn, renameColumn, removeColumn, reorderColumns,
  } = useAppStore();

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

  const userProjects = currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : [];
  const isManager = currentUser?.role === 'manager';
  const projectSelected = !!selectedProjectId && userProjects.some(p => p.id === selectedProjectId);
  const projectTasks = projectSelected ? tasks.filter(t => t.projectId === selectedProjectId && t.status !== 'completed') : [];

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
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.data.current?.type === 'column') { setOverColumnId(null); return; }
    const overId = over.id as string;
    if (boardColumns.some(c => c.id === overId)) { setOverColumnId(overId); return; }
    const task = tasks.find(t => t.id === overId);
    setOverColumnId(task ? task.status : null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null); setActiveType(null); setOverColumnId(null);
    if (!over) return;
    const dragType = active.data.current?.type as 'task' | 'column' | undefined;
    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

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
        if (targetColumn.id === 'done' && activeTimers[activeIdStr]) {
          await stopTimer(activeIdStr);
        }
        await moveTask(activeIdStr, targetColumn.id);
        toast.info(`Moved to ${targetColumn.label}`);
      }
      catch { toast.error('Could not move task'); }
      return;
    }
    const targetTask = tasks.find(t => t.id === overIdStr);
    if (targetTask && targetTask.id !== activeIdStr) {
      try {
        if (targetTask.status === 'done' && activeTimers[activeIdStr]) {
          await stopTimer(activeIdStr);
        }
        await moveTask(activeIdStr, targetTask.status);
      }
      catch { toast.error('Could not move task'); }
    }
  };

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      await approveTask(id);
      toast.success('Task approved and completed.');
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
          {userProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-6 h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
      </div>

      <DndContext sensors={sensors} collisionDetection={collisionDetection}
        onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <SortableContext items={boardColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-6 flex-1 overflow-x-auto pb-4">
            {boardColumns.map(col => (
              <KanbanColumnPanel
                key={col.id} column={col}
                tasks={projectTasks.filter(t => t.status === col.id)}
                onTaskClick={setSelectedTask}
                onNewTask={() => setCreateOpen(true)}
                isDropTarget={overColumnId === col.id}
                isManager={!!isManager}
                currentUserId={currentUser.id}
                approvingId={approvingId}
                onApprove={handleApprove}
                activeTimers={activeTimers}
                onStartTimer={id => { void startTimer(id); }}
                onStopTimer={id => { void stopTimer(id); }}
                isDoneColumn={col.id === doneColumnId}
                onSetDoneColumn={() => handleSetDoneColumn(col.id)}
                onRenameColumn={() => openRename(col)}
                onDeleteColumn={() => { void handleDeleteColumn(col.id); }}
              />
            ))}

            {/* Add column button */}
            <div className="min-w-[180px] shrink-0 pt-10">
              <motion.button onClick={() => { setNewColName(''); setAddColOpen(true); }}
                transition={snappy} whileHover={{ scale: 1.02, y: -1 }} whileTap={{ scale: 0.98 }}
                className="h-12 w-full flex items-center justify-center gap-2 text-sm text-muted-foreground rounded-2xl border-2 border-dashed border-border/50 hover:border-foreground/30 hover:text-foreground hover:bg-muted/30 transition-colors duration-100">
                <Plus className="h-4 w-4" /> Add Column
              </motion.button>
            </div>
          </div>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="rounded-2xl border-2 border-border/70 bg-card/95 backdrop-blur-sm p-6 shadow-2xl w-[380px] h-[250px] cursor-grabbing rotate-1 scale-[1.02]"
              style={{ boxShadow: `0 25px 60px -10px ${priorityGlowColor[activeTask.priority]}` }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-muted-foreground/60">TF-{activeTask.id.replace(/\D/g, '').padStart(3, '0')}</span>
                <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[activeTask.priority]}`}>{activeTask.priority}</span>
              </div>
              <h4 className="text-base font-bold text-foreground">{activeTask.title}</h4>
            </div>
          )}
          {activeColumn && (
            <div className="rounded-2xl border-2 border-primary/30 bg-card/95 backdrop-blur-sm p-4 shadow-2xl w-[380px] cursor-grabbing rotate-1 opacity-90">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{activeColumn.label}</span>
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Add Column Modal */}
      <Dialog open={addColOpen} onOpenChange={setAddColOpen}>
        <DialogContent className="sm:max-w-sm" onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => addColInputRef.current?.focus(), 50); }}>
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
        <DialogContent className="sm:max-w-sm" onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => renameColInputRef.current?.focus(), 50); }}>
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
    </motion.div>
  );
};

export default DashboardPage;
