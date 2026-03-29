import { useAppStore } from '@/stores/appStore';
import { Task, TaskStatus, Priority } from '@/types';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { DndContext, closestCorners, DragEndEvent, DragOverlay, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Clock, Calendar, CheckCircle2 } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import { toast } from 'sonner';

const columns: { id: TaskStatus; label: string; color: string }[] = [
  { id: 'backlog', label: 'Backlog', color: 'bg-muted' },
  { id: 'in_progress', label: 'In Progress', color: 'bg-blue-500/10' },
  { id: 'in_review', label: 'In Review', color: 'bg-purple-500/10' },
  { id: 'done', label: 'Done', color: 'bg-green-500/10' },
];

const priorityBorderColors: Record<Priority, string> = {
  Urgent: 'border-l-red-500', High: 'border-l-orange-500',
  Medium: 'border-l-yellow-500', Low: 'border-l-green-500',
};

const priorityBadgeColors: Record<Priority, string> = {
  Urgent: 'bg-red-500/10 text-red-500', High: 'bg-orange-500/10 text-orange-500',
  Medium: 'bg-yellow-500/10 text-yellow-500', Low: 'bg-green-500/10 text-green-500',
};

function TaskCard({ task, onClick }: { task: Task; onClick: () => void }) {
  const { users, projects, currentUser, approveTask } = useAppStore();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  const assignee = users.find(u => u.id === task.assignedTo);
  const project = projects.find(p => p.id === task.projectId);
  const section = project?.sections.find(s => s.id === task.sectionId);
  const isOverdue = new Date(task.dueDate) < new Date();
  const isDueSoon = !isOverdue && (new Date(task.dueDate).getTime() - Date.now()) < 2 * 86400000;
  const formatTime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const isManagerDone = task.status === 'done' && currentUser?.role === 'manager';
  const isEmployeeDone = task.status === 'done' && currentUser?.role === 'employee';

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`rounded-xl border border-l-4 ${priorityBorderColors[task.priority]} bg-card p-3 cursor-grab active:cursor-grabbing card-hover group`}
    >
      <div onClick={onClick} className="cursor-pointer">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{section?.name}</span>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${priorityBadgeColors[task.priority]}`}>{task.priority}</span>
        </div>
        <h4 className="text-sm font-semibold mb-1 line-clamp-2">{task.title}</h4>
        <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{task.description}</p>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-3">
          {task.tags.slice(0, 3).map(tag => (
            <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full border bg-muted/50">{tag}</span>
          ))}
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center text-xs">{assignee?.avatar}</div>
            <span className="text-[10px] text-muted-foreground">{assignee?.name?.split(' ')[0]}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {formatTime(task.timeTracked)}
            </span>
            <span className={`flex items-center gap-0.5 text-[10px] ${isOverdue ? 'text-red-500' : isDueSoon ? 'text-yellow-500' : 'text-muted-foreground'}`}>
              <Calendar className="h-3 w-3" /> {task.dueDate}
            </span>
          </div>
        </div>
      </div>

      {/* Manager approve */}
      {isManagerDone && (
        <button onClick={(e) => { e.stopPropagation(); approveTask(task.id); toast.success('Task approved & archived!'); }}
          className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs py-1.5 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors"
        >
          <CheckCircle2 className="h-3 w-3" /> Approve Completion
        </button>
      )}
      {isEmployeeDone && (
        <div className="mt-2 text-center text-[10px] py-1.5 rounded-lg bg-muted text-muted-foreground">
          ⏳ Pending Manager Approval
        </div>
      )}
    </div>
  );
}

function Column({ column, tasks, onTaskClick }: { column: typeof columns[0]; tasks: Task[]; onTaskClick: (t: Task) => void }) {
  const { setNodeRef } = useDroppable({ id: column.id });
  return (
    <div className="flex-1 min-w-[260px]">
      <div className={`flex items-center gap-2 mb-3 px-2`}>
        <div className={`w-2 h-2 rounded-full ${column.color}`} />
        <h3 className="text-sm font-semibold">{column.label}</h3>
        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">{tasks.length}</span>
      </div>
      <div ref={setNodeRef} className="space-y-2 min-h-[200px] p-1">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <TaskCard key={task.id} task={task} onClick={() => onTaskClick(task)} />
          ))}
        </SortableContext>
        {tasks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <div className="text-3xl mb-2">📋</div>
            <p className="text-xs">No tasks here</p>
          </div>
        )}
      </div>
    </div>
  );
}

const DashboardPage = () => {
  const { tasks, selectedProjectId, moveTask } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const projectTasks = tasks.filter(t => t.projectId === selectedProjectId && t.isStarted && t.status !== 'completed');

  const handleDragStart = (event: DragStartEvent) => setActiveId(event.active.id as string);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const taskId = active.id as string;
    const targetColumn = over.id as TaskStatus;
    if (columns.some(c => c.id === targetColumn)) {
      moveTask(taskId, targetColumn);
      toast.info(`Task moved to ${columns.find(c => c.id === targetColumn)?.label}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Kanban board for active tasks</p>
      </div>

      <DndContext collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map(col => (
            <Column key={col.id} column={col} tasks={projectTasks.filter(t => t.status === col.id)} onTaskClick={setSelectedTask} />
          ))}
        </div>
      </DndContext>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
    </motion.div>
  );
};

export default DashboardPage;
