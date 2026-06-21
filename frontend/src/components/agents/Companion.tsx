import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion';
import {
  NotebookPen, Play, AlertTriangle, ScrollText, Bell, X,
  Clock, CheckCircle2, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { TaskCreatorModal } from '@/pages/AIPage';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isTaskAssignedTo } from '@/lib/task-utils';
import { daysFromTodayInLocal } from '@/lib/due-date-utils';
import { isCompleted } from '@/lib/manage-utils';
import { idPillColor } from '@/lib/pill-color';
import { api } from '@/lib/api';
import type { Task, DaySummary } from '@/types';
import AgentAvatar from './AgentAvatar';
import { burstConfetti } from './confetti';
import { usePrefersReducedMotion, fmtDur } from './shared';
import { MenuItem, Stat } from './shared-ui';
import type { AgentId, AgentMood } from './agents';

const DONE_COL_KEY = 'tm_done_col';
const LONG_TIMER_HOURS = 4;

// ── Event reactions (props shown above the head) ────────────────────────────────
type Reaction = 'idle' | 'create' | 'approve' | 'move' | 'timer' | 'logging' | 'celebrate';

const MOOD: Record<Reaction, AgentMood> = {
  idle: 'idle', create: 'busy', approve: 'happy', move: 'busy',
  timer: 'busy', logging: 'happy', celebrate: 'happy',
};

function Notebook() {
  return (
    <svg width="62" height="62" viewBox="0 0 62 62" aria-hidden>
      <rect x="10" y="8" width="42" height="48" rx="5" fill="#fff" stroke="#16161a" strokeWidth="2.5" />
      <line x1="22" y1="8" x2="22" y2="56" stroke="#16161a" strokeWidth="1.5" opacity="0.35" />
      {[20, 30, 40].map((y, i) => (
        <motion.line key={y} x1="27" y1={y} x2="46" y2={y} stroke="#6d4dff" strokeWidth="2.5" strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.2 + i * 0.4, duration: 0.4 }} />
      ))}
    </svg>
  );
}
function ThumbsUp() {
  return (
    <motion.svg width="60" height="60" viewBox="0 0 54 54" aria-hidden
      initial={{ scale: 0, rotate: -20 }} animate={{ scale: [0, 1.25, 1], rotate: [-20, 0, 0] }} transition={{ duration: 0.5, ease: 'backOut' }}>
      <path d="M16 24 l8 -14 a4 4 0 0 1 7 3 l-2 9 h11 a4 4 0 0 1 4 5 l-3 13 a5 5 0 0 1 -5 4 H16 Z" fill="#10b981" stroke="#0b7a5b" strokeWidth="1.5" />
      <path d="M16 24 h-6 a3 3 0 0 0 -3 3 v16 a3 3 0 0 0 3 3 h6 Z" fill="#10b981" />
    </motion.svg>
  );
}
function MovingCard() {
  return (
    <svg width="72" height="60" viewBox="0 0 66 56" aria-hidden>
      <rect x="4" y="10" width="24" height="42" rx="4" fill="#fff" stroke="#16161a" strokeWidth="2" opacity="0.5" />
      <rect x="38" y="10" width="24" height="42" rx="4" fill="#fff" stroke="#16161a" strokeWidth="2" opacity="0.5" />
      <motion.rect width="18" height="12" rx="3" fill="#f97316" stroke="#16161a" strokeWidth="1.5"
        initial={{ x: 7, y: 16 }} animate={{ x: [7, 24, 42], y: [16, 2, 16] }} transition={{ duration: 1.2, ease: 'easeInOut', repeat: Infinity, repeatDelay: 0.3 }} />
    </svg>
  );
}
function Stopwatch() {
  return (
    <motion.svg width="60" height="60" viewBox="0 0 60 60" aria-hidden
      initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 14 }}>
      <rect x="26" y="3" width="8" height="6" rx="2" fill="#16161a" />
      <circle cx="30" cy="34" r="20" fill="#fff" stroke="#16161a" strokeWidth="3" />
      <motion.circle r="3" fill="#f97316"
        animate={{ cx: [30, 44, 30, 16, 30], cy: [18, 34, 50, 34, 18] }}
        transition={{ repeat: Infinity, duration: 2, ease: 'linear' }} />
      <circle cx="30" cy="34" r="2.5" fill="#16161a" />
    </motion.svg>
  );
}
function PartyPopper() {
  return (
    <motion.svg width="64" height="64" viewBox="0 0 64 64" aria-hidden
      initial={{ scale: 0, rotate: -30 }} animate={{ scale: [0, 1.3, 1], rotate: [-30, 8, 0] }} transition={{ duration: 0.55, ease: 'backOut' }}>
      <path d="M10 54 L26 24 L40 38 Z" fill="#f59e0b" stroke="#16161a" strokeWidth="2" strokeLinejoin="round" />
      {[['#6d4dff', 46, 14], ['#10b981', 54, 26], ['#f43f5e', 40, 10], ['#38bdf8', 56, 16]].map(([c, x, y], i) => (
        <motion.circle key={i} cx={x as number} cy={y as number} r="3" fill={c as string}
          animate={{ y: [(y as number), (y as number) - 6, (y as number)] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.12 }} />
      ))}
    </motion.svg>
  );
}

function propFor(r: Reaction) {
  switch (r) {
    case 'create': return <Notebook />;
    case 'approve': return <ThumbsUp />;
    case 'move': return <MovingCard />;
    case 'timer': return <Stopwatch />;
    case 'logging': return <Notebook />;
    case 'celebrate': return <PartyPopper />;
    default: return null;
  }
}

// ── Standup recap modal (feature D) ────────────────────────────────────────────
function StandupModal({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<DaySummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      setData(await api.aiSummarizeDay());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build your recap.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && !data && !loading) void load();
    if (!open) { setData(null); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const lines = (data?.summary ?? '').split('\n').map(l => l.trim()).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-violet-500/15 text-violet-400">
              <ScrollText className="h-4 w-4" />
            </span>
            Your day, wrapped
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}>
              <RefreshCw className="h-6 w-6 text-violet-400" />
            </motion.div>
            <p className="text-sm text-muted-foreground">Tasker is reviewing your day…</p>
          </div>
        ) : error ? (
          <div className="py-8 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button onClick={() => void load()} className="mt-4 text-sm font-medium text-violet-400 hover:underline">Try again</button>
          </div>
        ) : data ? (
          <div className="space-y-4">
            {/* Stat chips */}
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Tasks" value={String(data.taskCount)} />
              <Stat label="Tracked" value={data.trackedSeconds ? fmtDur(data.trackedSeconds) : '—'} />
              <Stat label="Logged" value={data.timesheetSeconds ? fmtDur(data.timesheetSeconds) : '—'} />
            </div>

            {/* Recap text */}
            <div className="rounded-xl border border-border/40 bg-muted/20 p-4 space-y-1.5">
              {lines.map((l, i) =>
                l.startsWith('-') || l.startsWith('•') ? (
                  <div key={i} className="flex gap-2 text-sm text-foreground/90 leading-relaxed">
                    <span className="text-violet-400 mt-0.5">•</span>
                    <span>{l.replace(/^[-•]\s*/, '').replace(/\*\*/g, '')}</span>
                  </div>
                ) : (
                  <p key={i} className="text-sm text-foreground/90 leading-relaxed">{l.replace(/\*\*/g, '')}</p>
                ),
              )}
            </div>

            <div className="flex justify-end">
              <button onClick={() => void load()}
                className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-foreground px-3 py-1.5 rounded-lg hover:bg-muted/40 transition-colors">
                <RefreshCw className="h-3.5 w-3.5" /> Regenerate
              </button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
// ── Companion ───────────────────────────────────────────────────────────────────
/**
 * The Tasker action-hub (Dashboard) + Zani (the /ai assistant).
 *
 * On the Dashboard, Tasker is a real quick-action hub:
 *   A. click → floating action menu (create task, start top task, overdue, recap, notifications)
 *   B. attention badge — overdue tasks / long-running timer / unread notifications
 *   C. drag a kanban card onto him → quick actions (start timer / mark done)
 *   D. "Summarize my day" → AI standup recap (LangChain chain on the backend)
 *   E. celebration — confetti when ALL my tasks sit in the Done column
 *   F. notifications — mirrors the unread bell count, opens the bell panel
 * On /ai, Zani keeps the simple click→create behaviour.
 */
export default function Companion() {
  const location = useLocation();
  const navigate = useNavigate();
  const reduced = usePrefersReducedMotion();
  const controls = useAnimationControls();

  const enabled = useAppStore(s => s.mascotsEnabled);
  const agentEvent = useAppStore(s => s.agentEvent);
  const tasks = useAppStore(s => s.tasks);
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const activeTimers = useAppStore(s => s.activeTimers);
  const startTimer = useAppStore(s => s.startTimer);
  const stopTimer = useAppStore(s => s.stopTimer);
  const moveTask = useAppStore(s => s.moveTask);
  const mascotDrag = useAppStore(s => s.mascotDrag);
  const mascotDropTaskId = useAppStore(s => s.mascotDropTaskId);
  const setMascotDropTask = useAppStore(s => s.setMascotDropTask);

  const agent: AgentId | null =
    location.pathname === '/' ? 'tasker' : location.pathname === '/ai' ? 'zani' : null;
  const isTasker = agent === 'tasker';

  const [reaction, setReaction] = useState<Reaction>('idle');
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [overdueExpanded, setOverdueExpanded] = useState(false);
  const [standupOpen, setStandupOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const lastSeq = useRef(0);
  const revert = useRef<ReturnType<typeof setTimeout>>();
  const celebratedRef = useRef(false);
  const celebrateInitRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Derived task selectors (mine, overdue, top, long timer, all-done) ─────────
  const myTasks = useMemo(
    () => (currentUser ? tasks.filter(t => isTaskAssignedTo(t, currentUser.id)) : []),
    [tasks, currentUser],
  );
  const overdue = useMemo(
    () => myTasks.filter(t => !isCompleted(t) && t.dueDate && daysFromTodayInLocal(t.dueDate) < 0),
    [myTasks],
  );
  const topTask = useMemo(() => {
    const order: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    return myTasks
      .filter(t => !isCompleted(t) && !activeTimers[t.id])
      .sort((a, b) => {
        const ad = a.dueDate ? daysFromTodayInLocal(a.dueDate) : 9999;
        const bd = b.dueDate ? daysFromTodayInLocal(b.dueDate) : 9999;
        if (ad < 0 && bd >= 0) return -1;
        if (ad >= 0 && bd < 0) return 1;
        return (order[a.priority] ?? 4) - (order[b.priority] ?? 4);
      })[0] ?? null;
  }, [myTasks, activeTimers]);
  const longTimer = useMemo(() => {
    const now = Date.now();
    return Object.entries(activeTimers).some(([, ms]) => (now - ms) / 3_600_000 > LONG_TIMER_HOURS);
  }, [activeTimers]);

  const doneColId = (typeof window !== 'undefined' && localStorage.getItem(DONE_COL_KEY)) || 'done';
  const allDone = myTasks.length > 0 && myTasks.every(t => t.status === doneColId);

  // Highest-priority attention indicator.
  const attention = useMemo(() => {
    if (overdue.length) return { count: overdue.length, tone: 'rose' as const };
    if (longTimer) return { count: 0, tone: 'amber' as const };
    if (unread > 0) return { count: unread, tone: 'violet' as const };
    return null;
  }, [overdue.length, longTimer, unread]);

  // ── Notifications poll (feature F + badge) ────────────────────────────────────
  useEffect(() => {
    if (!enabled || !isTasker) return;
    let alive = true;
    const load = async () => {
      try {
        const n = await api.getNotifications();
        if (alive) setUnread(n.filter(x => !x.isRead).length);
      } catch { /* silent */ }
    };
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [enabled, isTasker]);

  // ── Work events → in-place reaction ───────────────────────────────────────────
  useEffect(() => {
    if (!enabled || !agent || !agentEvent || agentEvent.seq === lastSeq.current) return;
    lastSeq.current = agentEvent.seq;
    const map: Record<string, Reaction> = {
      task_approved: 'approve', task_moved: 'move', task_created: 'create',
      task_assigned: 'create', timer_started: 'timer', timer_stopped: 'logging',
    };
    clearTimeout(revert.current);
    setReaction(map[agentEvent.kind] ?? 'create');
    revert.current = setTimeout(() => setReaction('idle'), 2600);
    if (!reduced) void controls.start({ y: [0, -12, 0], transition: { duration: 0.5 } });
  }, [agentEvent, enabled, agent, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Celebration: all my tasks in Done (feature E) ─────────────────────────────
  // Only celebrate a genuine in-session transition into "all done" — never the
  // pre-existing state on first load (that would fire confetti on every visit).
  useEffect(() => {
    if (!enabled || !isTasker || myTasks.length === 0) return;
    if (!celebrateInitRef.current) {
      celebrateInitRef.current = true;
      celebratedRef.current = allDone; // baseline: already-all-done counts as celebrated
      return;
    }
    if (allDone && !celebratedRef.current) {
      celebratedRef.current = true;
      clearTimeout(revert.current);
      setReaction('celebrate');
      revert.current = setTimeout(() => setReaction('idle'), 3200);
      if (!reduced) {
        burstConfetti();
        void controls.start({ y: [0, -22, 0, -10, 0], transition: { duration: 0.9 } });
        toast.success('Everything is in Done — nice work! 🎉');
      }
    } else if (!allDone) {
      celebratedRef.current = false; // re-arm once a task leaves Done
    }
  }, [allDone, myTasks.length, enabled, isTasker, reduced]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drop quick-action menu opens when a card is dropped on the mascot (C) ──────
  const dropTask = mascotDropTaskId ? tasks.find(t => t.id === mascotDropTaskId) ?? null : null;
  useEffect(() => {
    if (mascotDropTaskId) setMenuOpen(false); // drop menu takes over
  }, [mascotDropTaskId]);

  // Close menus on outside click / Escape.
  useEffect(() => {
    if (!menuOpen && !mascotDropTaskId) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false); setOverdueExpanded(false); setMascotDropTask(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setMenuOpen(false); setOverdueExpanded(false); setMascotDropTask(null); }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen, mascotDropTaskId, setMascotDropTask]);

  useEffect(() => () => clearTimeout(revert.current), []);

  if (!enabled || !agent || !currentUser) return null;

  // ── Quick actions used by the drop menu ───────────────────────────────────────
  const openTaskInList = (taskId: string) => {
    setMenuOpen(false); setOverdueExpanded(false);
    navigate('/tasks');
    setTimeout(() => window.dispatchEvent(new CustomEvent('zet:open-task', { detail: { taskId } })), 100);
  };
  const runDropAction = async (kind: 'start' | 'done', task: Task) => {
    setBusyAction(kind);
    try {
      if (kind === 'start') {
        if (activeTimers[task.id]) toast.info('Timer already running');
        else { await startTimer(task.id); toast.success('Timer started'); }
      } else {
        if (activeTimers[task.id]) await stopTimer(task.id);
        await moveTask(task.id, doneColId);
        toast.success('Marked done');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not complete that');
    } finally {
      setBusyAction(null);
      setMascotDropTask(null);
    }
  };
  const startTop = async () => {
    if (!topTask) return;
    setMenuOpen(false);
    try { await startTimer(topTask.id); toast.success(`Started "${topTask.title}"`); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not start'); }
  };

  const mood = MOOD[reaction];
  const prop = propFor(reaction);
  const dragOver = isTasker && mascotDrag.over;
  const dragActive = isTasker && mascotDrag.active && !mascotDropTaskId;

  const bodyAnim = reduced || reaction !== 'idle' ? {} : { scaleY: [1, 1.035, 1], scaleX: [1, 0.99, 1] };
  const bodyTransition = reduced ? {} : reaction === 'idle'
    ? { repeat: Infinity, duration: 3.6, ease: 'easeInOut' as const }
    : { duration: 0.4 };

  const toneRing = dragOver
    ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-background'
    : dragActive ? 'ring-2 ring-violet-400/60' : '';

  return (
    <>
      <TaskCreatorModal open={creatorOpen} onOpenChange={setCreatorOpen} />
      {isTasker && <StandupModal open={standupOpen} onOpenChange={setStandupOpen} />}

      <div ref={rootRef} className="pointer-events-none fixed bottom-4 right-5 z-40 flex flex-col items-end select-none">
        {/* Action menu (A) */}
        <AnimatePresence>
          {isTasker && menuOpen && !mascotDropTaskId && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.92 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-auto mb-3 w-64 origin-bottom-right rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md p-2 shadow-2xl"
            >
              <MenuItem icon={<NotebookPen className="h-4 w-4" />} tone="violet"
                label="Create tasks" sub="Type or drop notes"
                onClick={() => { setMenuOpen(false); setCreatorOpen(true); }} />

              <MenuItem icon={<Play className="h-4 w-4" />} tone="emerald"
                label={topTask ? `Start: ${topTask.title}` : 'Nothing to start'}
                sub={topTask ? 'Begin a timer' : 'All caught up'}
                disabled={!topTask} onClick={() => void startTop()} />

              <MenuItem icon={<AlertTriangle className="h-4 w-4" />} tone={overdue.length ? 'rose' : 'muted'}
                label={overdue.length ? `Overdue · ${overdue.length}` : 'No overdue tasks'}
                sub={overdue.length ? 'Tap to see them' : "You're on track"}
                disabled={!overdue.length}
                onClick={() => setOverdueExpanded(v => !v)} />

              <AnimatePresence>
                {overdueExpanded && overdue.length > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden">
                    <div className="mt-1 mb-1 space-y-1 pl-2 pr-1">
                      {overdue.slice(0, 5).map(t => {
                        const proj = projects.find(p => p.id === t.projectId);
                        const days = Math.abs(daysFromTodayInLocal(t.dueDate));
                        return (
                          <button key={t.id} onClick={() => openTaskInList(t.id)}
                            className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-muted/50 transition-colors">
                            <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded-full border font-semibold ${idPillColor(t.projectId)}`}>
                              {proj?.name?.slice(0, 10) ?? '—'}
                            </span>
                            <span className="flex-1 min-w-0 truncate text-xs text-foreground/90">{t.title}</span>
                            <span className="shrink-0 text-[10px] font-bold text-rose-400">{days}d</span>
                          </button>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <MenuItem icon={<ScrollText className="h-4 w-4" />} tone="violet"
                label="Summarize my day" sub="AI standup recap"
                onClick={() => { setMenuOpen(false); setStandupOpen(true); }} />

              <MenuItem icon={<Bell className="h-4 w-4" />} tone={unread ? 'violet' : 'muted'}
                label={unread ? `Notifications · ${unread}` : 'Notifications'}
                sub={unread ? 'Unread updates' : 'All caught up'}
                onClick={() => { setMenuOpen(false); window.dispatchEvent(new CustomEvent('zet:open-notifications')); }} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Drop quick-action menu (C) */}
        <AnimatePresence>
          {dropTask && (
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.92 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.92 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-auto mb-3 w-60 origin-bottom-right rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md p-2 shadow-2xl"
            >
              <div className="flex items-center justify-between px-2 py-1.5">
                <p className="text-xs font-semibold text-foreground truncate">{dropTask.title}</p>
                <button onClick={() => setMascotDropTask(null)} className="shrink-0 p-0.5 rounded-md hover:bg-muted/50 text-muted-foreground/50">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <MenuItem icon={<Clock className="h-4 w-4" />} tone="emerald" label="Start timer"
                disabled={busyAction !== null} onClick={() => void runDropAction('start', dropTask)} />
              <MenuItem icon={<CheckCircle2 className="h-4 w-4" />} tone="emerald" label="Mark done"
                disabled={busyAction !== null} onClick={() => void runDropAction('done', dropTask)} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* The mascot */}
        <motion.button
          type="button"
          animate={controls}
          onClick={() => {
            if (!isTasker) { setCreatorOpen(true); return; }
            if (mascotDropTaskId) { setMascotDropTask(null); return; }
            setMenuOpen(v => !v); setOverdueExpanded(false);
          }}
          whileHover={reduced ? undefined : { scale: 1.06 }}
          whileTap={reduced ? undefined : { scale: 0.94 }}
          title={isTasker ? 'Tasker — quick actions' : 'Create tasks'}
          aria-label={isTasker ? 'Tasker quick actions' : 'Create tasks'}
          className={`pointer-events-auto relative flex cursor-pointer flex-col items-center bg-transparent border-0 p-0 rounded-2xl transition-shadow ${toneRing}`}
          style={{ transformOrigin: 'bottom center' }}
        >
          {/* Drag hint bubble */}
          <AnimatePresence>
            {dragActive && (
              <motion.div
                initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
                className="absolute -top-9 whitespace-nowrap rounded-full border border-border/50 bg-card px-3 py-1 text-[11px] font-semibold text-foreground shadow-md"
              >
                {dragOver ? 'Drop for actions' : 'Drag here'}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Event prop */}
          <div className="flex h-16 items-end justify-center">
            <AnimatePresence>{prop && (
              <motion.div key={reaction} initial={{ opacity: 0, scale: 0.6, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.6 }}>
                {prop}
              </motion.div>
            )}</AnimatePresence>
          </div>

          <motion.div animate={bodyAnim} transition={bodyTransition} style={{ transformOrigin: 'bottom center' }}>
            <AgentAvatar agent={agent} mood={dragOver ? 'happy' : mood} size={70} still={reduced} />
          </motion.div>

          {/* Attention badge (B) */}
          {isTasker && attention && !menuOpen && !mascotDropTaskId && (
            <motion.span
              key={`${attention.tone}-${attention.count}`}
              initial={{ scale: 0 }} animate={{ scale: 1 }}
              className={`absolute -top-0.5 right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white shadow-md ${
                attention.tone === 'rose' ? 'bg-rose-500' : attention.tone === 'amber' ? 'bg-amber-500' : 'bg-violet-500'
              }`}
            >
              {attention.tone === 'amber' ? '!' : attention.count > 9 ? '9+' : attention.count}
            </motion.span>
          )}

          <div className="h-2 w-12 -translate-y-1 rounded-[50%] bg-black/25 blur-[3px] dark:bg-black/45" />
        </motion.button>
      </div>
    </>
  );
}
