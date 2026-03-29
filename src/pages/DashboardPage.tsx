import { useAppStore } from '@/stores/appStore';
import { Task, Priority, KanbanColumn } from '@/types';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { DndContext, closestCorners, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors, useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus, Trash2, GripVertical, Pencil, X, Check } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { users } = useAppStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const assignee = users.find(u => u.id === task.assignedTo);
  const isOverdue = new Date(task.dueDate) < new Date();

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="group relative rounded-2xl border border-border/50 bg-card p-6 cursor-grab active:cursor-grabbing transition-all duration-300 ease-out hover:border-secondary/50 hover:shadow-[0_8px_40px_-12px_hsl(var(--secondary)/0.25)] hover:-translate-y-1 h-[220px] flex flex-col"
    >
      {/* Hover glow */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-gradient-to-br from-secondary/5 via-transparent to-primary/5" />

      {/* Header */}
      <div className="relative flex items-center justify-between mb-3">
        <span className="text-xs font-mono text-muted-foreground/70 tracking-wider">
          TF-{task.id.replace(/\D/g, '').padStart(3, '0')}
        </span>
        <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[task.priority]}`}>
          {task.priority}
        </span>
      </div>

      {/* Title */}
      <h4 className="relative text-base font-bold leading-snug mb-2 text-foreground line-clamp-2">
        {task.title}
      </h4>

      {/* Description */}
      <p className="relative text-sm text-muted-foreground leading-relaxed line-clamp-2 flex-1">
        {task.description}
      </p>

      {/* Footer */}
      <div className="relative flex items-center justify-between pt-3 mt-auto border-t border-border/30">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-secondary/15 flex items-center justify-center ring-1 ring-secondary/20">
            <span className="text-[11px] font-bold text-secondary">{assignee ? getInitials(assignee.name) : '??'}</span>
          </div>
          <span className="text-sm text-muted-foreground font-medium">{assignee?.name?.split(' ')[0]}</span>
        </div>
        <span className={`text-sm font-mono ${isOverdue ? 'text-destructive' : 'text-muted-foreground/70'}`}>
          {formatDate(task.dueDate)}
        </span>
      </div>
    </div>
  );
}

function Column({
  column,
  tasks,
  onTaskClick,
  onNewTask,
  onDelete,
  onRename,
}: {
  column: KanbanColumn;
  tasks: Task[];
  onTaskClick: (t: Task) => void;
  onNewTask: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-w-[360px] w-[360px] flex flex-col shrink-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-semibold text-foreground">{column.label}</h3>
          <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full font-medium">
            {tasks.length}
          </span>
        </div>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <GripVertical className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[140px]">
            <DropdownMenuItem onClick={onRename}>
              <Pencil className="h-3.5 w-3.5 mr-2" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Cards area */}
      <div ref={setNodeRef} className="space-y-4 flex-1 min-h-[140px] px-0.5">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex items-center justify-center py-16 text-muted-foreground/40 border border-dashed border-border/40 rounded-2xl">
            <p className="text-xs">No tasks</p>
          </div>
        )}
      </div>

      {/* New Task button */}
      <button
        onClick={onNewTask}
        className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-3 rounded-xl border border-dashed border-border/60 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all duration-200"
      >
        <Plus className="h-3.5 w-3.5" /> New Task
      </button>
    </div>
  );
}

const DashboardPage = () => {
  const { tasks, selectedProjectId, moveTask, kanbanColumns, addColumn, removeColumn, renameColumn } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [addColOpen, setAddColOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const [renameTarget, setRenameTarget] = useState<KanbanColumn | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const projectTasks = tasks.filter(t => t.projectId === selectedProjectId && t.isStarted && t.status !== 'completed');

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const overId = over.id as string;

    const targetColumn = kanbanColumns.find(c => c.id === overId);
    if (targetColumn) {
      moveTask(taskId, targetColumn.id);
      toast.info(`Task moved to ${targetColumn.label}`);
      return;
    }

    const targetTask = tasks.find(t => t.id === overId);
    if (targetTask && targetTask.id !== taskId) {
      moveTask(taskId, targetTask.status);
      toast.info(`Task moved to ${kanbanColumns.find(c => c.id === targetTask.status)?.label}`);
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
    if (success) {
      toast.success(`Column "${col.label}" deleted`);
    } else {
      toast.error(`Cannot delete "${col.label}" — it still has tasks`);
    }
  };

  const handleRenameColumn = () => {
    if (!renameTarget || !renameValue.trim()) return;
    renameColumn(renameTarget.id, renameValue.trim());
    toast.success(`Column renamed to "${renameValue.trim()}"`);
    setRenameTarget(null);
    setRenameValue('');
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 h-full flex flex-col">
      <div className="mb-6 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Kanban board for active tasks</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAddColOpen(true)}
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" /> Add Column
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-6 flex-1 overflow-x-auto pb-4" style={{ scrollbarGutter: 'stable' }}>
          {kanbanColumns.map(col => (
            <Column
              key={col.id}
              column={col}
              tasks={projectTasks.filter(t => t.status === col.id)}
              onTaskClick={setSelectedTask}
              onNewTask={() => setCreateOpen(true)}
              onDelete={() => handleDeleteColumn(col)}
              onRename={() => { setRenameTarget(col); setRenameValue(col.label); }}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="rounded-2xl border border-secondary/40 bg-card p-6 shadow-2xl shadow-secondary/15 opacity-90 rotate-2 w-[360px] h-[220px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-muted-foreground/70">TF-{activeTask.id.replace(/\D/g, '').padStart(3, '0')}</span>
                <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[activeTask.priority]}`}>{activeTask.priority}</span>
              </div>
              <h4 className="text-base font-bold text-foreground">{activeTask.title}</h4>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      {/* Add Column Dialog */}
      <Dialog open={addColOpen} onOpenChange={setAddColOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add New Column</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Column name..."
            value={newColName}
            onChange={e => setNewColName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddColumn()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAddColOpen(false)}>Cancel</Button>
            <Button onClick={handleAddColumn} disabled={!newColName.trim()}>Add Column</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename Column Dialog */}
      <Dialog open={!!renameTarget} onOpenChange={o => !o && setRenameTarget(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Rename Column</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="New name..."
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleRenameColumn()}
            autoFocus
          />
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
