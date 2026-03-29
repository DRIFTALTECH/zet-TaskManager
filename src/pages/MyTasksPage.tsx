import { useAppStore } from '@/stores/appStore';
import { Task, Priority, TaskStatus } from '@/types';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Clock, Layers, ArrowRight, Plus, Filter } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { toast } from 'sonner';

const priorityColors: Record<Priority, string> = {
  Urgent: 'bg-red-500/10 text-red-500', High: 'bg-orange-500/10 text-orange-500',
  Medium: 'bg-yellow-500/10 text-yellow-500', Low: 'bg-green-500/10 text-green-500',
};
const priorityBorder: Record<Priority, string> = {
  Urgent: 'border-l-red-500', High: 'border-l-orange-500',
  Medium: 'border-l-yellow-500', Low: 'border-l-green-500',
};

const MyTasksPage = () => {
  const { currentUser, tasks, projects, startTask, users } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [filterProject, setFilterProject] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'createdAt'>('dueDate');

  if (!currentUser) return null;

  let myTasks = tasks.filter(t => t.assignedTo === currentUser.id && t.status !== 'completed');
  if (filterProject) myTasks = myTasks.filter(t => t.projectId === filterProject);
  if (filterPriority) myTasks = myTasks.filter(t => t.priority === filterPriority);
  if (filterStatus) myTasks = myTasks.filter(t => t.status === filterStatus);

  const priorityOrder: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
  myTasks.sort((a, b) => {
    if (sortBy === 'dueDate') return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
    if (sortBy === 'priority') return priorityOrder[a.priority] - priorityOrder[b.priority];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const userProjects = projects.filter(p => currentUser.projectIds.includes(p.id));
  const formatTime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">{myTasks.length} tasks assigned to you</p>
        </div>
        <button onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" /> Create Task
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
          className="rounded-xl border bg-muted/50 px-3 py-1.5 text-xs focus:outline-none">
          <option value="">All Projects</option>
          {userProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={filterPriority} onChange={e => setFilterPriority(e.target.value)}
          className="rounded-xl border bg-muted/50 px-3 py-1.5 text-xs focus:outline-none">
          <option value="">All Priorities</option>
          {['Low', 'Medium', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="rounded-xl border bg-muted/50 px-3 py-1.5 text-xs focus:outline-none">
          <option value="">All Statuses</option>
          {['backlog', 'in_progress', 'in_review', 'done'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          className="rounded-xl border bg-muted/50 px-3 py-1.5 text-xs focus:outline-none">
          <option value="dueDate">Sort: Due Date</option>
          <option value="priority">Sort: Priority</option>
          <option value="createdAt">Sort: Created</option>
        </select>
      </div>

      {/* Task Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {myTasks.map((task, i) => {
          const project = projects.find(p => p.id === task.projectId);
          const section = project?.sections.find(s => s.id === task.sectionId);
          return (
            <motion.div key={task.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={`rounded-2xl border border-l-4 ${priorityBorder[task.priority]} bg-card p-5 card-hover`}
            >
              <div onClick={() => setSelectedTask(task)} className="cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{section?.name}</span>
                  <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-medium ${priorityColors[task.priority]}`}>{task.priority}</span>
                </div>
                <h3 className="font-bold mb-2">{task.title}</h3>
                <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{task.description}</p>

                <div className="flex flex-wrap gap-1.5 mb-4">
                  {task.tags.map(tag => (
                    <span key={tag} className="text-[10px] px-2.5 py-1 rounded-full border bg-muted/50 font-medium">{tag}</span>
                  ))}
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatTime(task.timeTracked)}</span>
                    <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {project?.name}</span>
                  </div>
                </div>
              </div>

              {/* Start button */}
              <div className="mt-4 pt-3 border-t">
                {task.isStarted ? (
                  <span className="text-xs px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-500 font-medium">
                    {task.status.replace('_', ' ')}
                  </span>
                ) : (
                  <button onClick={() => { startTask(task.id); toast.success('Task started! It now appears on the Dashboard.'); }}
                    className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:text-primary/80 transition-colors"
                  >
                    Start <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      {myTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <div className="text-5xl mb-4">🎯</div>
          <p className="font-medium">No tasks found</p>
          <p className="text-sm">Create a task or adjust your filters</p>
        </div>
      )}

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

export default MyTasksPage;
