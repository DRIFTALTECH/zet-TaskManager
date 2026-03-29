import { useAppStore } from '@/stores/appStore';
import { Task, TaskStatus, Priority } from '@/types';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { DndContext, closestCorners, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Plus } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { toast } from 'sonner';

const columns: { id: TaskStatus; label: string }[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

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

  const getInitials = (name: string) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

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
      className="group relative rounded-2xl border border-border/50 bg-card p-5 cursor-grab active:cursor-grabbing transition-all duration-300 ease-out hover:border-secondary/50 hover:shadow-[0_8px_40px_-12px_hsl(var(--secondary)/0.25)] hover:-translate-y-1"
    >
      {/* Hover glow overlay */}
      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none bg-gradient-to-br from-secondary/5 via-transparent to-primary/5" />

      {/* Header: ID + Priority */}
      <div className="relative flex items-center justify-between mb-4">
        <span className="text-xs font-mono text-muted-foreground/70 tracking-wider">
          TF-{task.id.replace(/\D/g, '').padStart(3, '0')}
        </span>
        <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[task.priority]}`}>
          {task.priority}
        </span>
      </div>

      {/* Title */}
      <h4 className="relative text-[15px] font-bold leading-snug mb-2 text-foreground group-hover:text-foreground transition-colors line-clamp-2">
        {task.title}
      </h4>

      {/* Description */}
      <p className="relative text-[13px] text-muted-foreground leading-relaxed line-clamp-2 mb-6">
        {task.description}
      </p>

      {/* Footer: Assignee + Due date */}
      <div className="relative flex items-center justify-between pt-3 border-t border-border/30">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-secondary/15 flex items-center justify-center ring-1 ring-secondary/20">
            <span className="text-[10px] font-bold text-secondary">{assignee ? getInitials(assignee.name) : '??'}</span>
          </div>
          <span className="text-[13px] text-muted-foreground font-medium">{assignee?.name?.split(' ')[0]}</span>
        </div>
        <span className={`text-[13px] font-mono ${isOverdue ? 'text-red-400' : 'text-muted-foreground/70'}`}>
          {formatDate(task.dueDate)}
        </span>
      </div>
    </div>
  );
}

function Column({ column, tasks, onTaskClick, onNewTask }: {
  column: typeof columns[0];
  tasks: Task[];
  onTaskClick: (t: Task) => void;
  onNewTask: () => void;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });

  return (
    <div className="flex-1 min-w-[320px] flex flex-col">
      {/* Column header */}
      <div className="flex items-center gap-2.5 mb-4 px-1">
        <h3 className="text-sm font-semibold text-foreground">{column.label}</h3>
        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full font-medium">
          {tasks.length}
        </span>
      </div>

      {/* Cards area */}
      <div ref={setNodeRef} className="space-y-4 flex-1 min-h-[120px] px-0.5">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex items-center justify-center py-16 text-muted-foreground/50">
            <p className="text-xs">No tasks</p>
          </div>
        )}
      </div>

      {/* New Task button */}
      <button
        onClick={onNewTask}
        className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground py-2.5 rounded-xl border border-dashed border-border/60 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all duration-200"
      >
        <Plus className="h-3.5 w-3.5" /> New Task
      </button>
    </div>
  );
}

const DashboardPage = () => {
  const { tasks, selectedProjectId, moveTask } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const projectTasks = tasks.filter(t => t.projectId === selectedProjectId && t.isStarted && t.status !== 'completed');

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    const targetColumn = columns.find(c => c.id === overId);
    if (targetColumn) {
      moveTask(taskId, targetColumn.id);
      toast.info(`Task moved to ${targetColumn.label}`);
      return;
    }

    // Check if dropped on another task — move to that task's column
    const targetTask = tasks.find(t => t.id === overId);
    if (targetTask && targetTask.id !== taskId) {
      moveTask(taskId, targetTask.status);
      toast.info(`Task moved to ${columns.find(c => c.id === targetTask.status)?.label}`);
    }
  };

  const activeTask = activeId ? tasks.find(t => t.id === activeId) : null;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 h-full">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Kanban board for active tasks</p>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-6">
          {columns.map(col => (
            <Column
              key={col.id}
              column={col}
              tasks={projectTasks.filter(t => t.status === col.id)}
              onTaskClick={setSelectedTask}
              onNewTask={() => setCreateOpen(true)}
            />
          ))}
        </div>

        <DragOverlay>
          {activeTask && (
            <div className="rounded-2xl border border-secondary/40 bg-card p-5 shadow-2xl shadow-secondary/15 opacity-90 rotate-2 w-[320px]">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-mono text-muted-foreground/70">TF-{activeTask.id.replace(/\D/g, '').padStart(3, '0')}</span>
                <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${priorityBadgeStyles[activeTask.priority]}`}>{activeTask.priority}</span>
              </div>
              <h4 className="text-[15px] font-bold">{activeTask.title}</h4>
            </div>
          )}
        </DragOverlay>
      </DndContext>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

export default DashboardPage;
