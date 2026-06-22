import { useAppStore } from '@/stores/appStore';
import { Task, Priority } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { Clock, Layers, Plus, CheckCircle2, Play, Square, RotateCcw, List, CalendarDays, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import CalendarView from '@/components/CalendarView';
import { toast } from 'sonner';
import { isTaskAssignedTo } from '@/lib/task-utils';
import { snappy, snappyLayout, pageEnter, cardMotion } from '@/lib/motion';

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

function TaskTimerButton({ task, currentUserId }: { task: Task; currentUserId: string }) {
  const { activeTimers, startTimer, stopTimer } = useAppStore();
  const isActive = !!activeTimers[task.id];
  const epochStart = activeTimers[task.id] ?? null;
  const elapsed = useElapsedTime(epochStart);
  const canUse = isTaskAssignedTo(task, currentUserId) && task.status !== 'completed' && task.status !== 'done';

  if (!canUse) return null;

  return isActive ? (
    <button
      onClick={e => { e.stopPropagation(); void stopTimer(task.id); }}
      className="flex items-center gap-2 px-4 py-2 min-h-10 rounded-lg bg-destructive/15 text-destructive text-sm font-semibold border border-destructive/20 hover:bg-destructive/25 transition-colors"
    >
      <Square className="h-4 w-4 fill-current shrink-0" />
      Stop · {elapsed}
    </button>
  ) : (
    <button
      onClick={e => { e.stopPropagation(); void startTimer(task.id); }}
      className="flex items-center gap-2 px-4 py-2 min-h-10 rounded-lg bg-primary/10 text-primary text-sm font-semibold border border-primary/20 hover:bg-primary/20 transition-colors"
    >
      <Play className="h-4 w-4 fill-current shrink-0" />
      Start
    </button>
  );
}

const priorityBadge: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

const MyTasksPage = () => {
  const { currentUser, tasks, projects, reopenTaskToBacklog, updateTask, searchQuery, setSearchQuery } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'calendar'>('list');

  // Listen for notification-driven task opens (zet:open-task custom event)
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

  if (!currentUser) return null;

  const isMyActiveTask = (t: Task) =>
    t.status !== 'completed' &&
    (isTaskAssignedTo(t, currentUser.id) || t.createdBy === currentUser.id);

  const isMyCompletedTask = (t: Task) =>
    t.status === 'completed' && isTaskAssignedTo(t, currentUser.id);

  const canMoveCompletedToBacklog = (t: Task) =>
    t.status === 'completed' &&
    (t.createdBy === currentUser.id ||
      isTaskAssignedTo(t, currentUser.id) ||
      currentUser.role === 'manager' || currentUser.role === 'admin');

  // Search by task title, project name, or section name (case-insensitive).
  const q = searchQuery.trim().toLowerCase();
  const matchesSearch = (t: Task) => {
    if (!q) return true;
    const proj = projects.find(p => p.id === t.projectId);
    const sec = proj?.sections.find(s => s.id === t.sectionId);
    return (
      t.title.toLowerCase().includes(q) ||
      (proj?.name.toLowerCase().includes(q) ?? false) ||
      (sec?.name.toLowerCase().includes(q) ?? false)
    );
  };

  const myTasks = tasks.filter(t => (isMyActiveTask(t) || isMyCompletedTask(t)) && matchesSearch(t));
  const userProjects = projects.filter(p => myTasks.some(t => t.projectId === p.id));

  // Most recently completed first (completedAt is an ISO string → lexical sort works).
  const byRecentCompleted = (a: Task, b: Task) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '');

  const formatTime = (s: number) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-4 sm:p-6 flex flex-col h-[calc(100dvh-4rem)] min-h-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5 sm:mb-6 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">My Tasks</h1>
          <p className="text-sm text-muted-foreground mt-1">{myTasks.length} total tasks across {userProjects.length} projects</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-xl border border-border/40 bg-muted/30 p-0.5">
            <button
              onClick={() => setView('list')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                view === 'list' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              onClick={() => setView('calendar')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                view === 'calendar' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <CalendarDays className="h-3.5 w-3.5" /> Calendar
            </button>
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
      </div>

      {/* Search */}
      <div className="relative mb-4 sm:mb-5 shrink-0">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by task, project, or section…"
          className="w-full rounded-xl border border-border/50 bg-muted/30 pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-background transition-colors"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Calendar view */}
      {view === 'calendar' && (
        <div className="flex-1 min-h-0 overflow-auto">
          <CalendarView
            tasks={myTasks}
            onTaskClick={setSelectedTask}
            onTaskDrop={(taskId, newDate) => {
              void updateTask(taskId, { dueDate: newDate })
                .then(() => toast.success('Task rescheduled'))
                .catch((e: unknown) => toast.error(e instanceof Error ? e.message : 'Could not reschedule'));
            }}
          />
        </div>
      )}

      {/* Project-grouped tasks (list view) */}
      {view === 'list' && (
        <div className="flex-1 overflow-auto min-h-0">
          <div className="space-y-8">
            {userProjects.map(project => {
              const projTasks = myTasks.filter(t => t.projectId === project.id);
              const activeTasks = projTasks.filter(t => isMyActiveTask(t));
              const completedTasks = projTasks.filter(t => isMyCompletedTask(t)).sort(byRecentCompleted);

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
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold border shrink-0 ${priorityBadge[task.priority]}`}>
                                  {task.priority}
                                </span>
                                <h4 className="text-sm font-semibold truncate">{task.title}</h4>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <TaskTimerButton task={task} currentUserId={currentUser.id} />
                                <span className="px-2 py-0.5 rounded-lg bg-muted/50">{task.status.replace('_', ' ')}</span>
                                <span>{formatDate(task.dueDate)}</span>
                              </div>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground ml-0 sm:ml-[52px]">
                              {section && <span>{section.name}</span>}
                              <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTime(task.timeTracked)}</span>
                              {task.tags.length > 0 && (
                                <div className="flex flex-wrap gap-1">
                                  {task.tags.slice(0, 3).map(t => (
                                    <span key={t} className="px-2 py-0.5 rounded-full border bg-muted/50 text-[10px]">{t}</span>
                                  ))}
                                </div>
                              )}
                            </div>
                            {task.description && (
                              <p className="mt-2 text-xs text-muted-foreground line-clamp-1 ml-0 sm:ml-[52px]">{task.description}</p>
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
                            <div className="flex items-center justify-between gap-3 flex-wrap">
                              <div className="flex items-center gap-3 min-w-0">
                                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                <h4 className="text-sm font-medium line-through truncate">{task.title}</h4>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                {canMoveCompletedToBacklog(task) && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg gap-1.5 text-xs"
                                    disabled={reopeningId === task.id}
                                    onClick={e => {
                                      e.stopPropagation();
                                      setReopeningId(task.id);
                                      void reopenTaskToBacklog(task.id)
                                        .then(() => { toast.success('Task moved to backlog on the dashboard'); })
                                        .catch(err => { toast.error(err instanceof Error ? err.message : 'Could not reopen task'); })
                                        .finally(() => { setReopeningId(null); });
                                    }}
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    {reopeningId === task.id ? '…' : 'Backlog'}
                                  </Button>
                                )}
                                <span className="text-xs text-muted-foreground">{task.completedAt ? formatDate(task.completedAt) : ''}</span>
                              </div>
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
        </div>
      )}

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

export default MyTasksPage;
