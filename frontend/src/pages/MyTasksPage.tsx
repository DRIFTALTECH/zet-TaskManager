import { useAppStore } from '@/stores/appStore';
import { Task } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Layers, Plus, CheckCircle2, Search, X, FolderOpen, CheckSquare } from 'lucide-react';
import TaskDetailModal from '@/components/TaskDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { TaskCard } from '@/components/TaskCard';
import { toast } from 'sonner';
import { isTaskAssignedTo } from '@/lib/task-utils';
import { snappy, snappyLayout, pageEnter, cardMotion } from '@/lib/motion';

/** 0 = exact, 1 = prefix, 2 = contains, 3 = fuzzy; null = no match */
function matchRank(name: string, q: string): number | null {
  const n = name.toLowerCase();
  const query = q.toLowerCase().trim();
  if (!query) return null;
  if (n === query) return 0;
  if (n.startsWith(query)) return 1;
  if (n.includes(query)) return 2;
  let i = 0;
  for (const c of n) {
    if (c === query[i]) i++;
    if (i === query.length) return 3;
  }
  return null;
}

type Suggestion =
  | { kind: 'project'; id: string; label: string; rank: number }
  | { kind: 'task'; id: string; label: string; rank: number; projectId: string };

const MyTasksPage = () => {
  const {
    currentUser, tasks, projects, reopenTaskToBacklog,
    searchQuery, setSearchQuery,
  } = useAppStore();
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [reopeningId, setReopeningId] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [focusProjectId, setFocusProjectId] = useState<string | null>(null);
  const searchWrapRef = useRef<HTMLDivElement>(null);
  const projectRefs = useRef<Record<string, HTMLDivElement | null>>({});

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

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!searchWrapRef.current?.contains(e.target as Node)) setSuggestOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const userId = currentUser?.id ?? '';
  const userProjectIds = currentUser?.projectIds ?? [];
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'admin';

  const assignedTasks = useMemo(() => {
    if (!userId) return [];
    return tasks.filter(t =>
      userProjectIds.includes(t.projectId) && isTaskAssignedTo(t, userId),
    );
  }, [tasks, userId, userProjectIds]);

  const suggestions = useMemo((): Suggestion[] => {
    const query = searchQuery.trim();
    if (!query || !userId) return [];

    const out: Suggestion[] = [];
    const projectIdsWithTasks = new Set(assignedTasks.map(t => t.projectId));

    for (const p of projects) {
      if (!userProjectIds.includes(p.id) || !projectIdsWithTasks.has(p.id)) continue;
      const rank = matchRank(p.name, query);
      if (rank !== null) out.push({ kind: 'project', id: p.id, label: p.name, rank });
    }
    for (const t of assignedTasks) {
      const rank = matchRank(t.title, query);
      if (rank !== null) out.push({ kind: 'task', id: t.id, label: t.title, rank, projectId: t.projectId });
    }

    out.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label));
    return out.slice(0, 12);
  }, [searchQuery, assignedTasks, projects, userId, userProjectIds]);

  const selectSuggestion = useCallback((s: Suggestion) => {
    setSuggestOpen(false);
    if (s.kind === 'project') {
      setFocusProjectId(s.id);
      setSearchQuery(s.label);
      requestAnimationFrame(() => {
        projectRefs.current[s.id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return;
    }
    setFocusProjectId(null);
    setSearchQuery('');
    const task = tasks.find(t => t.id === s.id);
    if (task) setSelectedTask(task);
  }, [setSearchQuery, tasks]);

  if (!currentUser) return null;

  const isMyActiveTask = (t: Task) =>
    t.status !== 'completed' && isTaskAssignedTo(t, currentUser.id);

  const isMyCompletedTask = (t: Task) =>
    t.status === 'completed' && isTaskAssignedTo(t, currentUser.id);

  const canMoveCompletedToBacklog = (t: Task) =>
    t.status === 'completed' &&
    (t.createdBy === currentUser.id ||
      isTaskAssignedTo(t, currentUser.id) ||
      isManager);

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

  const myTasks = assignedTasks.filter(t => {
    if (focusProjectId && t.projectId !== focusProjectId) return false;
    return matchesSearch(t);
  });

  const userProjects = projects.filter(
    p => currentUser.projectIds.includes(p.id) && myTasks.some(t => t.projectId === p.id),
  );

  const clearSearch = () => {
    setSearchQuery('');
    setFocusProjectId(null);
    setSuggestOpen(false);
  };

  const byRecentCompleted = (a: Task, b: Task) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '');

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-4 sm:p-6 flex flex-col h-[calc(100dvh-4rem)] min-h-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-5 sm:mb-6 shrink-0">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">My Tasks</h1>
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

      <div ref={searchWrapRef} className="relative mb-4 sm:mb-5 shrink-0 z-20">
        <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/50" />
        <input
          value={searchQuery}
          onChange={e => {
            setSearchQuery(e.target.value);
            setFocusProjectId(null);
            setSuggestOpen(true);
          }}
          onFocus={() => setSuggestOpen(true)}
          placeholder="Search tasks or projects…"
          className="w-full rounded-xl border border-border/50 bg-muted/30 pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-background transition-colors"
          autoComplete="off"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={clearSearch}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {suggestOpen && suggestions.length > 0 && (
          <ul
            role="listbox"
            className="absolute left-0 right-0 top-full mt-1.5 max-h-72 overflow-auto rounded-xl border border-border/50 bg-card shadow-lg py-1"
          >
            {suggestions.map(s => (
              <li key={`${s.kind}-${s.id}`}>
                <button
                  type="button"
                  role="option"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => selectSuggestion(s)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted/50 transition-colors"
                >
                  {s.kind === 'project' ? (
                    <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/20">
                      <FolderOpen className="h-3 w-3" /> Project
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 shrink-0 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                      <CheckSquare className="h-3 w-3" /> Task
                    </span>
                  )}
                  <span className="truncate text-foreground">{s.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex-1 overflow-auto min-h-0">
        <div className="space-y-8">
          {userProjects.map(project => {
            const projTasks = myTasks.filter(t => t.projectId === project.id);
            const activeTasks = projTasks.filter(t => isMyActiveTask(t));
            const completedTasks = projTasks.filter(t => isMyCompletedTask(t)).sort(byRecentCompleted);

            return (
              <motion.div
                key={project.id}
                ref={el => { projectRefs.current[project.id] = el; }}
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

                <div className="space-y-2 mb-3">
                  <AnimatePresence mode="popLayout">
                    {activeTasks.map(task => (
                      <motion.div
                        key={task.id}
                        layout
                        transition={cardMotion}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -8 }}
                        whileHover={{ scale: 1.005, x: 2, boxShadow: '0 4px 20px -4px hsl(var(--foreground) / 0.08)' }}
                        whileTap={{ scale: 0.995 }}
                      >
                        <TaskCard
                          task={task}
                          onClick={() => setSelectedTask(task)}
                          showProjectPill={false}
                        />
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                {completedTasks.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5 px-1">
                      <CheckCircle2 className="h-3 w-3" /> Completed
                    </h3>
                    {completedTasks.map(task => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        completed
                        onClick={() => setSelectedTask(task)}
                        showReopen={canMoveCompletedToBacklog(task)}
                        reopening={reopeningId === task.id}
                        onReopen={() => {
                          setReopeningId(task.id);
                          void reopenTaskToBacklog(task.id)
                            .then(() => { toast.success('Task moved to backlog on the dashboard'); })
                            .catch(err => { toast.error(err instanceof Error ? err.message : 'Could not reopen task'); })
                            .finally(() => { setReopeningId(null); });
                        }}
                      />
                    ))}
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

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />
      <CreateTaskModal open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

export default MyTasksPage;
