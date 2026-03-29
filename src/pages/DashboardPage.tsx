import { useAppStore } from '@/stores/appStore';
import { Task, Priority, KanbanColumn } from '@/types';
import { motion } from 'framer-motion';
import { useState } from 'react';
import {
  DndContext, closestCorners, DragEndEvent, DragOverlay, DragStartEvent, DragOverEvent,
  PointerSensor, useSensor, useSensors, useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Trash2, GripVertical, Pencil } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { toast } from 'sonner';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

const priorityHoverStyles: Record<Priority, string> = {
  Urgent: 'hover:-translate-y-2 hover:shadow-[0_12px_50px_-8px_rgba(239,68,68,0.3)] hover:backdrop-brightness-105',
  High: 'hover:-translate-y-2 hover:shadow-[0_12px_50px_-8px_rgba(249,115,22,0.3)] hover:backdrop-brightness-105',
  Medium: 'hover:-translate-y-2 hover:shadow-[0_12px_50px_-8px_rgba(234,179,8,0.25)] hover:backdrop-brightness-105',
  Low: 'hover:-translate-y-2 hover:shadow-[0_12px_50px_-8px_rgba(34,197,94,0.25)] hover:backdrop-brightness-105',
};

/* ─── Task Card ─── */
function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { users } = useAppStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const assignee = users.find(u => u.id === task.assignedTo);
  const isOverdue = new Date(task.dueDate) < new Date();

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className={`group relative rounded-2xl border border-border/40 bg-card/50 backdrop-blur-sm p-6 cursor-grab active:cursor-grabbing transition-all duration-300 ease-out h-[250px] flex flex-col ${priorityHoverStyles[task.priority]}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-mono text-muted-foreground/60 tracking-wider">
          TF-{task.id.replace(/\D/g, '').padStart(3, '0')}
        </span>
        <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[task.priority]}`}>
          {task.priority}
        </span>
      </div>

      {/* Title */}
      <h4 className="text-base font-bold leading-snug mb-3 text-foreground line-clamp-2">
        {task.title}
      </h4>

      {/* Description */}
      <p className="text-sm text-muted-foreground leading-relaxed flex-1 overflow-hidden text-ellipsis line-clamp-3">
        {task.description || 'No description'}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 mt-auto">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
            <span className="text-[10px] font-bold text-muted-foreground">{assignee ? getInitials(assignee.name) : '??'}</span>
          </div>
          <span className="text-sm text-muted-foreground font-medium">{assignee?.name?.split(' ')[0]}</span>
        </div>
        <span className={`text-sm font-mono ${isOverdue ? 'text-destructive' : 'text-muted-foreground/60'}`}>
          {formatDate(task.dueDate)}
        </span>
      </div>
    </div>
  );
}

/* ─── Sortable Column Wrapper ─── */
function SortableColumn({
  column, tasks, onTaskClick, onNewTask, onDelete, onRename, isDropTarget,
}: {
  column: KanbanColumn; tasks: Task[];
  onTaskClick: (t: Task) => void; onNewTask: () => void;
  onDelete: () => void; onRename: () => void;
  isDropTarget: boolean;
}) {
  const { attributes, listeners, setNodeRef: sortRef, transform, transition, isDragging } = useSortable({ id: column.id });
  const { setNodeRef: dropRef } = useDroppable({ id: column.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={sortRef} style={style} className={`min-w-[380px] w-[380px] flex flex-col shrink-0 rounded-2xl transition-all duration-200 ${isDropTarget ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''}`}>
      {/* Column header */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2.5">
          <button {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing p-0.5 text-muted-foreground/50 hover:text-foreground transition-colors">
            <GripVertical className="h-4 w-4" />
          </button>
          <h3 className="text-sm font-semibold text-foreground">{column.label}</h3>
          <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
            {tasks.length}
          </span>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[140px]">
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Cards area */}
      <div ref={dropRef} className="space-y-4 flex-1 min-h-[140px] px-0.5">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex items-center justify-center py-16 text-muted-foreground/30 border border-dashed border-border/40 rounded-2xl">
            <p className="text-xs">No tasks</p>
          </div>
        )}
      </div>

      {/* New task — right after cards */}
      <button
        onClick={onNewTask}
        className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-2.5 rounded-xl border border-dashed border-border/50 hover:border-foreground/30 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
      >
        <Plus className="h-3.5 w-3.5" /> New Task
      </button>
    </div>
  );
}

/* ─── Add Column Placeholder ─── */
function AddColumnPlaceholder({ onClick }: { onClick: () => void }) {
  return (
    <div className="min-w-[380px] w-[380px] shrink-0 flex flex-col">
      {/* Invisible header spacer to align with column headers */}
      <div className="mb-4 px-1 h-[24px]" />
      <button
        onClick={onClick}
        className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-2.5 rounded-xl border border-dashed border-border/50 hover:border-foreground/30 hover:text-foreground hover:bg-muted/50 transition-all duration-200"
      >
        <Plus className="h-3.5 w-3.5" /> Add Column
      </button>
    </div>
  );
}

/* ─── Main Page ─── */
const DashboardPage = () => {
  const { tasks, selectedProjectId, moveTask, kanbanColumns, addColumn, removeColumn, renameColumn, reorderColumns } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragType, setDragType] = useState<'task' | 'column' | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [renameTarget, setRenameTarget] = useState<KanbanColumn | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const projectTasks = tasks.filter(t => t.projectId === selectedProjectId && t.isStarted && t.status !== 'completed');

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string;
    setActiveId(id);
    setDragType(kanbanColumns.some(c => c.id === id) ? 'column' : 'task');
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (dragType !== 'task') return;
    const { over } = event;
    if (!over) { setOverColumnId(null); return; }
    const overId = over.id as string;
    // If over a column directly
    if (kanbanColumns.some(c => c.id === overId)) {
      setOverColumnId(overId);
    } else {
      // Over a task — find which column it belongs to
      const task = tasks.find(t => t.id === overId);
      if (task) setOverColumnId(task.status);
      else setOverColumnId(null);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setDragType(null);
    setOverColumnId(null);
    if (!over) return;

    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    // Column reorder
    if (kanbanColumns.some(c => c.id === activeIdStr)) {
      if (activeIdStr === overIdStr) return;
      const oldIdx = kanbanColumns.findIndex(c => c.id === activeIdStr);
      let newIdx = kanbanColumns.findIndex(c => c.id === overIdStr);
      if (newIdx === -1) return;
      const updated = [...kanbanColumns];
      const [moved] = updated.splice(oldIdx, 1);
      updated.splice(newIdx, 0, moved);
      reorderColumns(updated);
      return;
    }

    // Task move
    const targetColumn = kanbanColumns.find(c => c.id === overIdStr);
    if (targetColumn) {
      moveTask(activeIdStr, targetColumn.id);
      toast.info(`Moved to ${targetColumn.label}`);
      return;
    }
    const targetTask = tasks.find(t => t.id === overIdStr);
    if (targetTask && targetTask.id !== activeIdStr) {
      moveTask(activeIdStr, targetTask.status);
    }
  };

  const handleAddColumn = () => {
    if (!newColName.trim()) return;
    addColumn(newColName.trim());
    toast.success(`Column "${newColName.trim()}" added`);
    setNewColName('');
    setAddColOpen(false);
  };

  const handleDeleteColumn = (col: KanbanColumn) => {
    const success = removeColumn(col.id);
    if (success) toast.success(`Column "${col.label}" deleted`);
    else toast.error(`Cannot delete "${col.label}" — it still has tasks`);
  };

  const handleRenameColumn = () => {
    if (!renameTarget || !renameValue.trim()) return;
    renameColumn(renameTarget.id, renameValue.trim());
    toast.success(`Column renamed to "${renameValue.trim()}"`);
    setRenameTarget(null);
    setRenameValue('');
  };

  const activeTask = activeId && dragType === 'task' ? tasks.find(t => t.id === activeId) : null;
  const activeColumn = activeId && dragType === 'column' ? kanbanColumns.find(c => c.id === activeId) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Kanban board for active tasks</p>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
        <div className="flex gap-6 flex-1 overflow-x-auto pb-4">
          <SortableContext items={kanbanColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
            {kanbanColumns.map(col => (
              <SortableColumn
                key={col.id}
                column={col}
                tasks={projectTasks.filter(t => t.status === col.id)}
                onTaskClick={setSelectedTask}
                onNewTask={() => setCreateOpen(true)}
                onDelete={() => handleDeleteColumn(col)}
                onRename={() => { setRenameTarget(col); setRenameValue(col.label); }}
                isDropTarget={overColumnId === col.id}
              />
            ))}
          </SortableContext>

          <AddColumnPlaceholder onClick={() => setAddColOpen(true)} />
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="rounded-2xl border border-border/60 bg-card/80 backdrop-blur-sm p-6 shadow-2xl opacity-90 rotate-2 w-[380px] h-[250px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-muted-foreground/60">TF-{activeTask.id.replace(/\D/g, '').padStart(3, '0')}</span>
                <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[activeTask.priority]}`}>{activeTask.priority}</span>
              </div>
              <h4 className="text-base font-bold text-foreground">{activeTask.title}</h4>
            </div>
          )}
          {activeColumn && (
            <div className="rounded-2xl border border-border bg-card/90 backdrop-blur-sm p-4 shadow-2xl opacity-90 w-[380px]">
              <span className="text-sm font-semibold text-foreground">{activeColumn.label}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Add Column Dialog */}
      <Dialog open={addColOpen} onOpenChange={setAddColOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>Add New Column</DialogTitle></DialogHeader>
          <Input placeholder="Column name..." value={newColName} onChange={e => setNewColName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddColumn()} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddColOpen(false)}>Cancel</Button>
            <Button onClick={handleAddColumn} disabled={!newColName.trim()}>Add Column</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Column Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={o => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader><DialogTitle>Rename Column</DialogTitle></DialogHeader>
          <Input placeholder="New name..." value={renameValue} onChange={e => setRenameValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleRenameColumn()} autoFocus />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Cancel</Button>
            <Button onClick={handleRenameColumn} disabled={!renameValue.trim()}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

export default DashboardPage;
