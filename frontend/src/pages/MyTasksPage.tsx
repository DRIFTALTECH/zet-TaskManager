import { useAppStore } from '@/stores/appStore';
import { Task, Priority } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Clock, Layers, Plus, CheckCircle2 } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { toast } from 'sonner';
import { isTaskAssignedTo } from '@/lib/task-utils';
import { snappy, snappyLayout, pageEnter, cardMotion } from '@/lib/motion';

const priorityBadge: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

const MyTasksPage = () => {
  const { currentUser, tasks, projects } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  if (!currentUser) return null;

  const isMyActiveTask = (t: Task) =>
    t.status !== 'completed' &&
    (isTaskAssignedTo(t, currentUser.id) || t.createdBy === currentUser.id);

  const isMyCompletedTask = (t: Task) =>
    t.status === 'completed' && isTaskAssignedTo(t, currentUser.id);

  const myTasks = tasks.filter(t => isMyActiveTask(t) || isMyCompletedTask(t));
  const userProjects = projects.filter(p => myTasks.some(t => t.projectId === p.id));

  const formatTime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">{myTasks.length} total tasks across {userProjects.length} projects</p>
        </div>
        <motion.button
          transition={snappy}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity duration-100"
        >
          <Plus className="h-4 w-4" /> Create Task
        </motion.button>
      </div>

      {/* Project-grouped tasks */}
      <div className="space-y-8">
        {userProjects.map(project => {
          const projTasks = myTasks.filter(t => t.projectId === project.id);
          const activeTasks = projTasks.filter(t => isMyActiveTask(t));
          const completedTasks = projTasks.filter(t => isMyCompletedTask(t));

          return (
            <motion.div
              key={project.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={snappyLayout}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Layers className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">{project.name}</h2>
                  <p className="text-xs text-muted-foreground">{projTasks.length} tasks · {completedTasks.length} completed</p>
                </div>
              </div>

              {/* Active Tasks */}
              <div className="space-y-2 mb-3">
                <AnimatePresence mode="popLayout">
                  {activeTasks.map(task => {
                    const section = project.sections.find(s => s.id === task.sectionId);
                    return (
                      <motion.div
                        key={task.id}
                        layout
                        transition={cardMotion}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        whileHover={{ scale: 1.005, x: 2, boxShadow: '0 4px 20px -4px hsl(var(--foreground) / 0.08)' }}
                        whileTap={{ scale: 0.995 }}
                        onClick={() => setSelectedTask(task)}
                        className="rounded-xl border bg-card p-4 cursor-pointer transition-shadow duration-100"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold border ${priorityBadge[task.priority]}`}>
                              {task.priority}
                            </span>
                            <h4 className="text-sm font-semibold">{task.title}</h4>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="px-2 py-0.5 rounded-lg bg-muted/50">{task.status.replace('_', ' ')}</span>
                            <span>{formatDate(task.dueDate)}</span>
                          </div>
                        </div>
                        <div className="mt-2 flex items-center gap-4 text-[11px] text-muted-foreground ml-[52px]">
                          {section && <span>{section.name}</span>}
                          <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(task.timeTracked)}</span>
                          {task.tags.length > 0 && (
                            <div className="flex gap-1">
                              {task.tags.slice(0, 3).map(t => (
                                <span key={t} className="px-2 py-0.5 rounded-full border bg-muted/50 text-[10px]">{t}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        {task.description && (
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-1 ml-[52px]">{task.description}</p>
                        )}
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>

              {/* Completed Tasks */}
              {completedTasks.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 px-1">
                    <CheckCircle2 className="h-3 w-3" /> Completed
                  </h3>
                  {completedTasks.map(task => {
                    const section = project.sections.find(s => s.id === task.sectionId);
                    return (
                      <motion.div
                        key={task.id}
                        transition={snappy}
                        whileHover={{ scale: 1.005, x: 2 }}
                        onClick={() => setSelectedTask(task)}
                        className="rounded-xl border bg-card/50 p-4 cursor-pointer opacity-60 hover:opacity-80 transition-opacity duration-100"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                            <h4 className="text-sm font-medium line-through">{task.title}</h4>
                          </div>
                          <span className="text-xs text-muted-foreground">{task.completedAt ? formatDate(task.completedAt) : ''}</span>
                        </div>
                        <div className="mt-1.5 ml-[40px] text-[11px] text-muted-foreground flex gap-3">
                          {section && <span>{section.name}</span>}
                          <span>{formatTime(task.timeTracked)}</span>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {myTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <p className="font-medium">No tasks found</p>
          <p className="text-sm">Create a task to get started</p>
        </div>
      )}

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

export default MyTasksPage;
