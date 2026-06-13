/**
 * UserDetailPage — analytics-first profile for a team member.
 * Weekly work (nav + charts + day drill-down) → KPIs → status / priority
 * → tasks by project → completed work → all tasks; separate timesheet tab.
 */

import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Briefcase, ChevronLeft, ChevronRight,
  Clock, AlertTriangle, CheckCircle2, Circle, BarChart2,
  CalendarDays, ListChecks, Flame, FolderKanban, Trophy,
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  Cell, PieChart, Pie,
} from 'recharts';
import { pageEnter, snappy } from '@/lib/motion';
import { isTaskAssignedTo } from '@/lib/task-utils';
import type { TimesheetWorkEntry, Priority, Task, Project } from '@/types';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ─── colour helpers ───────────────────────────────────────────────────────────

const PROJECT_PALETTE = [
  { hex: '#6366f1', ring: 'ring-indigo-500/40',  bg: 'bg-indigo-500/10',  text: 'text-indigo-400',  border: 'border-indigo-500/25'  },
  { hex: '#f59e0b', ring: 'ring-amber-500/40',   bg: 'bg-amber-500/10',   text: 'text-amber-400',   border: 'border-amber-500/25'   },
  { hex: '#06b6d4', ring: 'ring-cyan-500/40',    bg: 'bg-cyan-500/10',    text: 'text-cyan-400',    border: 'border-cyan-500/25'    },
  { hex: '#10b981', ring: 'ring-emerald-500/40', bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/25' },
  { hex: '#f43f5e', ring: 'ring-rose-500/40',    bg: 'bg-rose-500/10',    text: 'text-rose-400',    border: 'border-rose-500/25'    },
  { hex: '#8b5cf6', ring: 'ring-violet-500/40',  bg: 'bg-violet-500/10',  text: 'text-violet-400',  border: 'border-violet-500/25'  },
  { hex: '#ec4899', ring: 'ring-pink-500/40',    bg: 'bg-pink-500/10',    text: 'text-pink-400',    border: 'border-pink-500/25'    },
];
function projColor(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

const STATUS_META: Record<string, { label: string; hex: string }> = {
  backlog:     { label: 'Backlog',     hex: '#64748b' },
  in_progress: { label: 'In Progress', hex: '#3b82f6' },
  in_review:   { label: 'In Review',   hex: '#f59e0b' },
  done:        { label: 'Done',        hex: '#8b5cf6' },
  completed:   { label: 'Completed',   hex: '#10b981' },
};

const PRIORITY_META: Record<Priority, { hex: string; label: string; bg: string; text: string; border: string }> = {
  Urgent: { hex: '#ef4444', label: 'Urgent', bg: 'bg-red-500/10',    text: 'text-red-400',    border: 'border-red-500/20'    },
  High:   { hex: '#f97316', label: 'High',   bg: 'bg-orange-500/10', text: 'text-orange-400', border: 'border-orange-500/20' },
  Medium: { hex: '#eab308', label: 'Medium', bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20' },
  Low:    { hex: '#22c55e', label: 'Low',    bg: 'bg-green-500/10',  text: 'text-green-400',  border: 'border-green-500/20'  },
};

const PRI_RANK: Record<Priority, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

// ─── date utils ───────────────────────────────────────────────────────────────

const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_LONG  = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function weekOf(offset: number): string[] {
  const now = new Date();
  const dow = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return DAY_SHORT.map((_, i) => { const d = new Date(mon); d.setDate(mon.getDate() + i); return isoOf(d); });
}
function fmtISO(iso: string): string {
  const [y, m, d] = iso.split('-');
  return y ? `${d}-${m}-${y}` : iso;
}
function fmtSecs(s: number): string {
  if (s <= 0) return '—';
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Minutes from midnight; accepts "HH:MM" or "H:MM". */
function timeToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(x => parseInt(x, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  return h * 60 + m;
}

function projectHoursForDay(
  entries: TimesheetWorkEntry[],
  iso: string,
  projectList: Project[],
): { projectId: string; name: string; seconds: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) {
    if (e.workDate !== iso) continue;
    m.set(e.projectId, (m.get(e.projectId) ?? 0) + e.seconds);
  }
  return [...m.entries()]
    .map(([projectId, seconds]) => ({
      projectId,
      name: projectList.find(p => p.id === projectId)?.name ?? 'Project',
      seconds,
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

function projectHoursForWeek(
  entries: TimesheetWorkEntry[],
  weekIsos: string[],
  projectList: Project[],
): { projectId: string; name: string; seconds: number }[] {
  const set = new Set(weekIsos);
  const m = new Map<string, number>();
  for (const e of entries) {
    if (!set.has(e.workDate)) continue;
    m.set(e.projectId, (m.get(e.projectId) ?? 0) + e.seconds);
  }
  return [...m.entries()]
    .map(([projectId, seconds]) => ({
      projectId,
      name: projectList.find(p => p.id === projectId)?.name ?? 'Project',
      seconds,
    }))
    .sort((a, b) => b.seconds - a.seconds);
}

type DayBlock = {
  entry: TimesheetWorkEntry;
  startMin: number;
  endMin: number;
  lane: number;
};

function buildDayTimeline(entries: TimesheetWorkEntry[]): DayBlock[] {
  const sorted = [...entries].sort(
    (a, b) => timeToMinutes(a.timeFrom) - timeToMinutes(b.timeFrom),
  );
  const laneEnds: number[] = [];
  const out: DayBlock[] = [];
  for (const entry of sorted) {
    const start = Math.max(0, Math.min(24 * 60, timeToMinutes(entry.timeFrom)));
    const durMin = Math.max(1, Math.ceil(entry.seconds / 60));
    const end = Math.min(24 * 60, start + durMin);
    let lane = laneEnds.findIndex(le => le <= start);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(end);
    } else {
      laneEnds[lane] = end;
    }
    out.push({ entry, startMin: start, endMin: end, lane });
  }
  return out;
}

// ─── CountUp ─────────────────────────────────────────────────────────────────

function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!to) { setN(0); return; }
    const t0 = performance.now();
    const run = (now: number) => {
      const p = Math.min((now - t0) / 900, 1);
      setN(Math.round(to * (1 - (1 - p) ** 3)));
      if (p < 1) raf.current = requestAnimationFrame(run); else setN(to);
    };
    raf.current = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf.current);
  }, [to]);
  return <>{n}{suffix}</>;
}

// ─── Custom Recharts tooltip ──────────────────────────────────────────────────

function WeeklyBarTooltip({
  active,
  payload,
  projects,
  entries,
}: {
  active?: boolean;
  payload?: { payload?: { isoDate: string; day: string; seconds: number } }[];
  projects: Project[];
  entries: TimesheetWorkEntry[];
}) {
  if (!active || !payload?.[0]?.payload) return null;
  const { isoDate, day, seconds } = payload[0].payload;
  const byProj = projectHoursForDay(entries, isoDate, projects);
  const dayEntries = entries.filter(e => e.workDate === isoDate);
  return (
    <div className="bg-popover border border-border/60 rounded-xl shadow-xl px-3.5 py-3 text-xs min-w-[200px] max-w-[280px]">
      <p className="font-semibold text-foreground mb-0.5">{day}</p>
      <p className="text-[10px] font-mono text-muted-foreground/50 mb-2">{fmtISO(isoDate)}</p>
      <p className="text-sm font-bold text-primary tabular-nums mb-2">{fmtSecs(seconds)} logged</p>
      {byProj.length === 0 ? (
        <p className="text-muted-foreground/40 italic">No entries</p>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">By project</p>
          {byProj.map(row => {
            const col = projColor(row.projectId);
            return (
              <div key={row.projectId} className="flex items-center justify-between gap-2">
                <span className={cn('truncate text-[11px] font-medium border rounded-md px-1.5 py-0.5', col.bg, col.text, col.border)}>
                  {row.name}
                </span>
                <span className="tabular-nums font-semibold shrink-0">{fmtSecs(row.seconds)}</span>
              </div>
            );
          })}
        </div>
      )}
      {dayEntries.length > 1 && (
        <p className="text-[10px] text-muted-foreground/40 mt-2">{dayEntries.length} blocks · click bar for timeline</p>
      )}
    </div>
  );
}

function DayTimelineDialog({
  open,
  onOpenChange,
  isoDate,
  entries,
  projects,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  isoDate: string | null;
  entries: TimesheetWorkEntry[];
  projects: Project[];
}) {
  const dayEntries = useMemo(
    () => (isoDate ? entries.filter(e => e.workDate === isoDate) : []),
    [entries, isoDate],
  );
  const blocks = useMemo(() => buildDayTimeline(dayEntries), [dayEntries]);
  const maxLane = blocks.reduce((m, b) => Math.max(m, b.lane), -1);
  const laneCount = Math.max(1, maxLane + 1);
  const rowH = 36;
  const axisH = 28;
  const totalH = axisH + laneCount * rowH + 8;
  const dow = isoDate ? new Date(`${isoDate}T12:00:00`).getDay() : 0;
  const monIdx = dow === 0 ? 6 : dow - 1;
  const dayLong = isoDate ? DAY_LONG[monIdx] : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[70vw] max-w-[70vw] border-border/60 bg-card sm:rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl">
            <CalendarDays className="h-5 w-5 text-primary" />
            {isoDate ? `${dayLong}` : 'Day'}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {isoDate ? fmtISO(isoDate) : ''} · 24-hour timeline (timesheet blocks)
          </DialogDescription>
        </DialogHeader>

        {dayEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground/50 py-8 text-center italic">No work logged this day.</p>
        ) : (
          <div className="space-y-4">
            <div
              className="relative rounded-xl border border-border/40 bg-muted/10 overflow-hidden"
              style={{ height: totalH }}
            >
              <div
                className="absolute left-0 right-0 top-0 border-b border-border/30 bg-muted/20"
                style={{ height: axisH }}
              >
                {[0, 6, 12, 18, 24].map(hour => {
                  const pct = (hour / 24) * 100;
                  const edge = hour === 0 ? 'left' : hour === 24 ? 'right' : null;
                  return (
                    <span
                      key={hour}
                      className={cn(
                        'absolute bottom-1 text-[10px] font-mono text-muted-foreground/45',
                        edge === null && '-translate-x-1/2',
                      )}
                      style={edge ? { [edge]: 4 } : { left: `${pct}%` }}
                    >
                      {String(hour).padStart(2, '0')}:00
                    </span>
                  );
                })}
              </div>
              <div
                className="absolute left-0 right-0 px-1 pointer-events-none z-0"
                style={{ top: axisH, height: laneCount * rowH }}
              >
                {[25, 50, 75].map(pct => (
                  <div
                    key={pct}
                    className="absolute top-0 bottom-0 w-px bg-border/25"
                    style={{ left: `${pct}%` }}
                  />
                ))}
              </div>
              <div
                className="absolute left-0 right-0 px-1 z-10"
                style={{ top: axisH, height: laneCount * rowH }}
              >
                {blocks.map((b, i) => {
                  const col = projColor(b.entry.projectId);
                  const left = (b.startMin / (24 * 60)) * 100;
                  const width = Math.max(0.35, ((b.endMin - b.startMin) / (24 * 60)) * 100);
                  const top = b.lane * rowH + 4;
                  return (
                    <motion.div
                      key={b.entry.id + i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.04, ...pageEnter }}
                      className={cn(
                        'absolute h-[28px] rounded-lg border text-[10px] px-2 flex flex-col justify-center overflow-hidden shadow-sm',
                        col.bg, col.border, col.text,
                      )}
                      style={{
                        left: `calc(${left}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        top,
                        maxWidth: 'calc(100% - 4px)',
                      }}
                      title={`${b.entry.timeFrom}–${b.entry.timeTo} · ${fmtSecs(b.entry.seconds)}`}
                    >
                      <span className="truncate font-semibold leading-tight">
                        {projects.find(p => p.id === b.entry.projectId)?.name ?? 'Project'}
                      </span>
                      <span className="truncate opacity-80 text-[9px] font-mono">
                        {b.entry.timeFrom}–{b.entry.timeTo}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            <ul className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
              {dayEntries.map(e => {
                const col = projColor(e.projectId);
                const proj = projects.find(p => p.id === e.projectId);
                const sec = proj?.sections.find(s => s.id === e.sectionId);
                return (
                  <li
                    key={e.id}
                    className="rounded-xl border border-border/35 bg-muted/5 px-3 py-2.5 flex gap-3 items-start"
                  >
                    <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: col.hex }} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground break-words">
                        {e.description?.trim() || <span className="italic text-muted-foreground/35">No description</span>}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {proj && (
                          <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-semibold border', col.bg, col.text, col.border)}>
                            {proj.name}
                          </span>
                        )}
                        {sec && (
                          <span className="text-[10px] text-muted-foreground/55">{sec.name}</span>
                        )}
                        <span className="text-[10px] font-mono text-muted-foreground/45">
                          {e.timeFrom} – {e.timeTo}
                        </span>
                        <span className="text-[10px] font-bold tabular-nums">{fmtSecs(e.seconds)}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type View = 'analytics' | 'timesheet';

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { users, tasks, projects, kanbanColumns } = useAppStore();

  const [view, setView]             = useState<View>('analytics');
  const [wkOff, setWkOff]           = useState(0);
  const [weekEntries, setWeekEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [dayDetailDate, setDayDetailDate] = useState<string | null>(null);

  const TODAY = isoToday();
  const WD    = useMemo(() => weekOf(wkOff), [wkOff]);
  const visWD = useMemo(() => {
    if (wkOff < 0) return WD;
    return WD.filter(d => d <= TODAY);
  }, [wkOff, WD, TODAY]);

  const user = users.find(u => u.id === userId);

  // ── derived ──────────────────────────────────────────────────────────────

  const userProjects = useMemo(
    () => (user ? projects.filter(p => p.members.includes(user.id)) : []),
    [projects, user],
  );

  const userTasks = useMemo(() => {
    if (!user) return [] as Task[];
    return tasks.filter(t => isTaskAssignedTo(t, user.id) || t.createdBy === user.id);
  }, [tasks, user]);

  const doneTasks   = userTasks.filter(t => t.status === 'completed');
  const active      = userTasks.filter(t => t.status !== 'completed');
  const overdue     = active.filter(t => t.dueDate < TODAY);
  const compRate    = userTasks.length ? Math.round(doneTasks.length / userTasks.length * 100) : 0;

  const colLabel = useMemo(() => {
    const base = [
      {id:'backlog',label:'Backlog'},{id:'in_progress',label:'In Progress'},
      {id:'in_review',label:'In Review'},{id:'done',label:'Done'},
    ];
    return Object.fromEntries((kanbanColumns.length ? kanbanColumns : base).map(c => [c.id, c.label]));
  }, [kanbanColumns]);

  const statusData = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of userTasks) m[t.status] = (m[t.status] ?? 0) + 1;
    return Object.entries(m)
      .map(([s, v]) => ({
        name:  STATUS_META[s]?.label ?? colLabel[s] ?? s,
        value: v,
        hex:   STATUS_META[s]?.hex ?? '#6366f1',
      }))
      .sort((a, b) => b.value - a.value);
  }, [userTasks, colLabel]);

  // Most recently completed work (compact glance; full history lives in "Completed tasks").
  const recentActivity = useMemo(
    () => [...doneTasks]
      .filter(t => t.completedAt)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
      .slice(0, 6),
    [doneTasks],
  );

  // Actively moving: started but not yet completed (everything past backlog).
  const inFlight = useMemo(
    () => active
      .filter(t => t.status !== 'backlog')
      .sort((a, b) => (PRI_RANK[a.priority] - PRI_RANK[b.priority]) || (a.dueDate || '').localeCompare(b.dueDate || '')),
    [active],
  );

  // Open tasks already overdue, or due within the next 3 days — worst first.
  const soon = useMemo(() => {
    const d = new Date(`${TODAY}T12:00:00`);
    d.setDate(d.getDate() + 3);
    return d.toISOString().slice(0, 10);
  }, [TODAY]);
  const atRisk = useMemo(
    () => active
      .filter(t => t.dueDate && t.dueDate <= soon)
      .map(t => ({ t, overdue: t.dueDate < TODAY }))
      .sort((a, b) => (a.t.dueDate || '').localeCompare(b.t.dueDate || '')),
    [active, soon, TODAY],
  );

  const tasksByProject = useMemo(
    () =>
      userProjects
        .map(p => ({
          project: p,
          tasks: userTasks.filter(t => t.projectId === p.id),
        }))
        .filter(x => x.tasks.length > 0)
        .sort((a, b) => b.tasks.length - a.tasks.length),
    [userProjects, userTasks],
  );

  const barData = useMemo(
    () =>
      WD.map((iso, i) => ({
        day: DAY_SHORT[i],
        isoDate: iso,
        seconds: weekEntries.filter(e => e.workDate === iso).reduce((a, e) => a + e.seconds, 0),
      })),
    [WD, weekEntries],
  );

  const weekHrs = useMemo(
    () =>
      (wkOff < 0 ? WD : WD.filter(d => d <= TODAY)).reduce(
        (sum, iso) => sum + weekEntries.filter(e => e.workDate === iso).reduce((a, e) => a + e.seconds, 0),
        0,
      ),
    [WD, weekEntries, wkOff, TODAY],
  );

  const weekProjectHours = useMemo(
    () => projectHoursForWeek(weekEntries, WD, projects),
    [weekEntries, WD, projects],
  );

  const daysWithLogs = useMemo(
    () => WD.filter(iso => weekEntries.some(e => e.workDate === iso)).length,
    [WD, weekEntries],
  );

  useEffect(() => {
    setDayDetailDate(null);
  }, [wkOff]);

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    setLoadingWeek(true);
    void (async () => {
      try {
        const list = await api.getTimesheetWorkEntriesForUser(userId, WD[0], WD[6]);
        if (cancel) return;
        setWeekEntries(list);
      } catch (e) {
        if (!cancel) {
          setWeekEntries([]);
          toast.error(e instanceof Error ? e.message : 'Could not load timesheet');
        }
      } finally {
        if (!cancel) setLoadingWeek(false);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [userId, WD]);

  const dayView = visWD
    .map(date => {
      const idx = WD.indexOf(date);
      const es  = weekEntries.filter(e => e.workDate === date);
      return { date, day: DAY_LONG[idx], es, total: es.reduce((a, e) => a + e.seconds, 0) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const wkTotal = useMemo(() => {
    if (wkOff < 0) return weekEntries.reduce((a, e) => a + e.seconds, 0);
    return weekEntries.filter(e => e.workDate <= TODAY).reduce((a, e) => a + e.seconds, 0);
  }, [weekEntries, wkOff, TODAY]);

  const wkLabel  = visWD.length
    ? `${fmtISO(visWD[0])} — ${fmtISO(visWD[visWD.length-1])}`
    : `${fmtISO(WD[0])} — ${fmtISO(WD[6])}`;

  // ── not found ─────────────────────────────────────────────────────────────

  if (!userId || !user) {
    return (
      <div className="flex items-center justify-center h-[calc(100dvh-3.5rem)]">
        <div className="text-center space-y-3">
          <p className="text-sm text-muted-foreground">User not found.</p>
          <Link to="/users" className="text-sm text-primary flex items-center justify-center gap-1.5 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to team
          </Link>
        </div>
      </div>
    );
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-background">
      <div className="max-w-7xl mx-auto px-6 pb-16">

        {/* ── breadcrumb + name ──────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
          transition={pageEnter}
          className="pt-8 pb-6"
        >
          <Link to="/users"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors mb-4 group">
            <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
            Team members
          </Link>

          <div className="flex items-end justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground">{user.name}</h1>
              <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground/60">
                <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{user.email}</span>
                <span className="flex items-center gap-1.5"><Briefcase className="h-3.5 w-3.5" />{userProjects.length} project{userProjects.length !== 1 ? 's' : ''}</span>
                <span className={`flex items-center gap-1.5 font-medium capitalize ${
                  user.role === 'manager' ? 'text-primary' : 'text-muted-foreground/60'
                }`}>
                  {user.role}
                </span>
              </div>
            </div>

            {/* tab switcher */}
            <div className="flex items-center gap-1 bg-muted/40 border border-border/40 rounded-xl p-1">
              {([
                { id: 'analytics' as View, label: 'Analytics', icon: BarChart2 },
                { id: 'timesheet' as View, label: 'Timesheet', icon: CalendarDays },
              ]).map(t => (
                <button key={t.id} type="button" onClick={() => setView(t.id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    view === t.id
                      ? 'bg-card border border-border/60 text-foreground shadow-sm'
                      : 'text-muted-foreground/60 hover:text-foreground'
                  }`}>
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </motion.div>

        <AnimatePresence mode="wait">

          {/* ════════════════════════════════════════════════════════════════
              ANALYTICS VIEW
          ════════════════════════════════════════════════════════════════ */}
          {view === 'analytics' && (
            <motion.div
              key="analytics"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={pageEnter}
              className="space-y-5"
            >

              {/* ── Weekly work (hero) ─────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={pageEnter}
                className="rounded-3xl border border-border/50 bg-gradient-to-br from-card via-card to-primary/[0.03] p-1 shadow-[0_20px_60px_-24px_rgba(0,0,0,0.45)]"
              >
                <div className="rounded-[1.35rem] border border-border/40 bg-card/80 backdrop-blur-sm p-6 sm:p-8 space-y-6">
                  <div className="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-5">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 text-primary">
                        <Sparkles className="h-5 w-5" />
                        <span className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground/60">Workload</span>
                      </div>
                      <h2 className="text-2xl font-bold tracking-tight text-foreground">Week at a glance</h2>
                      <p className="text-sm text-muted-foreground/55 max-w-xl">
                        Navigate weeks, hover a day for project breakdown, click a bar to open a 24-hour timeline of timesheet blocks.
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row flex-wrap items-stretch gap-3">
                      <div className="flex items-center rounded-2xl border border-border/45 bg-muted/15 px-1.5 py-1.5 gap-0.5 shadow-inner">
                        <motion.button type="button" transition={snappy} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                          onClick={() => setWkOff(w => w - 1)}
                          className="p-2.5 rounded-xl hover:bg-background/80 transition-colors"
                          aria-label="Previous week">
                          <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                        </motion.button>
                        <span className="min-w-[200px] sm:min-w-[240px] text-center px-2">
                          <span className="text-sm font-semibold text-foreground/90">{wkLabel}</span>
                          {loadingWeek && (
                            <span className="block text-[10px] text-muted-foreground/35 mt-0.5">Loading…</span>
                          )}
                        </span>
                        <motion.button type="button" transition={snappy} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}
                          onClick={() => setWkOff(w => Math.min(0, w + 1))}
                          disabled={wkOff >= 0}
                          className="p-2.5 rounded-xl hover:bg-background/80 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                          aria-label="Next week">
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </motion.button>
                      </div>
                      {wkOff !== 0 && (
                        <button type="button" onClick={() => setWkOff(0)}
                          className="rounded-2xl border border-primary/25 bg-primary/10 px-4 py-2.5 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors">
                          Jump to this week
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[0, -1, -2, -3, -4].map(off => (
                      <button
                        key={off}
                        type="button"
                        onClick={() => setWkOff(off)}
                        className={cn(
                          'rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-all',
                          wkOff === off
                            ? 'border-primary/40 bg-primary/15 text-primary shadow-sm'
                            : 'border-border/50 bg-muted/20 text-muted-foreground hover:text-foreground hover:border-border',
                        )}
                      >
                        {off === 0 ? 'This week' : `${Math.abs(off)} week${Math.abs(off) === 1 ? '' : 's'} ago`}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    <div className="lg:col-span-2 space-y-3">
                      <div className="h-56 sm:h-64">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={barData}
                            barCategoryGap="32%"
                            margin={{ top: 8, right: 8, bottom: 4, left: -18 }}
                            onClick={state => {
                              const p = state?.activePayload?.[0]?.payload as
                                | { isoDate?: string; seconds?: number }
                                | undefined;
                              if (!p?.isoDate || !(p.seconds > 0)) return;
                              if (wkOff === 0 && p.isoDate > TODAY) return;
                              setDayDetailDate(p.isoDate);
                            }}
                          >
                            <XAxis
                              dataKey="day"
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', opacity: 0.55 }}
                            />
                            <YAxis
                              tickFormatter={v => (v > 0 ? `${Math.floor(v / 3600)}h` : '')}
                              axisLine={false}
                              tickLine={false}
                              tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', opacity: 0.4 }}
                            />
                            <RTooltip
                              content={<WeeklyBarTooltip projects={projects} entries={weekEntries} />}
                              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.22, radius: 8 }}
                            />
                            <Bar dataKey="seconds" name="Logged" radius={[8, 8, 0, 0]} cursor="pointer">
                              {barData.map((d, i) => {
                                const isFuture = wkOff === 0 && d.isoDate > TODAY;
                                const isTodayCell = d.isoDate === TODAY;
                                let fill = 'hsl(var(--muted) / 0.38)';
                                if (isFuture) fill = 'hsl(var(--muted) / 0.12)';
                                else if (d.seconds > 0)
                                  fill = isTodayCell ? 'hsl(var(--primary))' : 'hsl(var(--primary) / 0.42)';
                                return <Cell key={i} fill={fill} className={isFuture ? 'opacity-60' : undefined} />;
                              })}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <p className="text-[11px] text-muted-foreground/40 text-center">
                        Tip: Click any bar with logged time to see that day on a 24h axis.
                      </p>
                    </div>

                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-2xl border border-border/40 bg-muted/10 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">Week total</p>
                          <p className="text-xl font-bold tabular-nums text-foreground mt-1">{fmtSecs(weekHrs)}</p>
                        </div>
                        <div className="rounded-2xl border border-border/40 bg-muted/10 p-4">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/45">Days w/ logs</p>
                          <p className="text-xl font-bold tabular-nums text-foreground mt-1">{daysWithLogs}<span className="text-muted-foreground/35 text-sm font-medium"> / {wkOff < 0 ? 7 : visWD.length}</span></p>
                        </div>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-foreground mb-3 flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-primary/70" />
                          Hours by project
                        </p>
                        {weekProjectHours.length === 0 ? (
                          <p className="text-xs text-muted-foreground/35 italic py-4">No time logged this range.</p>
                        ) : (
                          <ul className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                            {weekProjectHours.map(row => {
                              const col = projColor(row.projectId);
                              const pct = weekHrs > 0 ? Math.round((row.seconds / weekHrs) * 100) : 0;
                              return (
                                <li key={row.projectId}>
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className={cn('truncate text-[11px] font-semibold px-2 py-0.5 rounded-lg border max-w-[70%]', col.bg, col.text, col.border)}>
                                      {row.name}
                                    </span>
                                    <span className="text-[11px] font-bold tabular-nums shrink-0">{fmtSecs(row.seconds)}</span>
                                  </div>
                                  <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                                    <motion.div
                                      initial={{ width: 0 }}
                                      animate={{ width: `${pct}%` }}
                                      transition={{ duration: 0.65, ease: [0.34, 1.56, 0.64, 1] }}
                                      className="h-full rounded-full"
                                      style={{ background: col.hex }}
                                    />
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* ── Row 1 : 4 KPI cards ───────────────────────────────── */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  {
                    label: 'Total Tasks', value: userTasks.length,
                    sub: `${compRate}% completed`,
                    icon: ListChecks,
                    iconBg: 'bg-indigo-500/10', iconColor: 'text-indigo-400',
                    trend: null,
                  },
                  {
                    label: 'Active', value: active.length,
                    sub: 'currently in progress',
                    icon: Flame,
                    iconBg: 'bg-blue-500/10', iconColor: 'text-blue-400',
                    trend: null,
                  },
                  {
                    label: 'Completed', value: doneTasks.length,
                    sub: 'tasks finished',
                    icon: CheckCircle2,
                    iconBg: 'bg-emerald-500/10', iconColor: 'text-emerald-400',
                    trend: null,
                  },
                  {
                    label: 'Overdue', value: overdue.length,
                    sub: overdue.length > 0 ? 'need immediate attention' : 'none overdue',
                    icon: AlertTriangle,
                    iconBg: overdue.length > 0 ? 'bg-red-500/10' : 'bg-muted/30',
                    iconColor: overdue.length > 0 ? 'text-red-400' : 'text-muted-foreground/30',
                    trend: null,
                  },
                ].map((card, i) => (
                  <motion.div key={card.label}
                    initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ ...pageEnter, delay: i * 0.06 }}
                    className="group rounded-2xl border border-border/60 bg-card p-5 flex flex-col gap-4 hover:border-border hover:shadow-[0_8px_30px_rgba(0,0,0,0.3)] transition-all duration-200"
                  >
                    <div className="flex items-start justify-between">
                      <div className={`h-10 w-10 rounded-xl flex items-center justify-center ${card.iconBg}`}>
                        <card.icon className={`h-5 w-5 ${card.iconColor}`} />
                      </div>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1">
                        {card.label}
                      </p>
                      <p className="text-4xl font-bold tabular-nums text-foreground">
                        <CountUp to={card.value} />
                      </p>
                      <p className="text-xs text-muted-foreground/40 mt-1">{card.sub}</p>
                    </div>
                  </motion.div>
                ))}
              </div>

              {/* ── Task status + week snapshot ───────────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Status donut */}
                <motion.div
                  initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ ...pageEnter, delay: 0.12 }}
                  className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col"
                >
                  <div className="mb-1">
                    <h2 className="text-sm font-semibold text-foreground">Task status</h2>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">{userTasks.length} total tasks</p>
                  </div>

                  {userTasks.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <p className="text-sm text-muted-foreground/30 italic">No tasks yet</p>
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 flex items-center justify-center py-2">
                        <div className="relative">
                          <PieChart width={150} height={150}>
                            <Pie
                              data={statusData}
                              cx={70} cy={70}
                              innerRadius={48} outerRadius={68}
                              paddingAngle={3}
                              dataKey="value"
                              strokeWidth={0}
                              animationBegin={300}
                              animationDuration={900}
                            >
                              {statusData.map((s, i) => <Cell key={i} fill={s.hex} />)}
                            </Pie>
                          </PieChart>
                          {/* center label */}
                          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-2xl font-bold text-foreground">{userTasks.length}</span>
                            <span className="text-[10px] text-muted-foreground/40">tasks</span>
                          </div>
                        </div>
                      </div>

                      {/* legend */}
                      <div className="space-y-2">
                        {statusData.map(s => (
                          <div key={s.name} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.hex }} />
                            <span className="text-xs text-muted-foreground/60 flex-1 truncate">{s.name}</span>
                            <span className="text-xs font-bold text-foreground tabular-nums">{s.value}</span>
                            <span className="text-[10px] text-muted-foreground/35 w-8 text-right tabular-nums">
                              {Math.round(s.value / userTasks.length * 100)}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ ...pageEnter, delay: 0.16 }}
                  className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <Flame className="h-4 w-4 text-blue-400" />
                    <h2 className="text-sm font-semibold text-foreground">Currently in flight</h2>
                  </div>
                  <p className="text-xs text-muted-foreground/50 mb-4">Tasks actively being worked — highest priority first</p>
                  {inFlight.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-6">
                      <p className="text-sm text-muted-foreground/30 italic">Nothing in progress right now</p>
                    </div>
                  ) : (
                    <ul className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {inFlight.map(t => {
                        const proj = projects.find(p => p.id === t.projectId);
                        const col = proj ? projColor(proj.id) : PROJECT_PALETTE[0];
                        const pm = PRIORITY_META[t.priority];
                        return (
                          <li key={t.id} className="flex items-center gap-3 rounded-xl border border-border/35 bg-muted/5 px-3 py-2.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_META[t.status]?.hex ?? '#6366f1' }} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                {proj && (
                                  <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-semibold border', col.bg, col.text, col.border)}>{proj.name}</span>
                                )}
                                <span className="text-[10px] text-muted-foreground/45">{STATUS_META[t.status]?.label ?? t.status}</span>
                              </div>
                            </div>
                            <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-bold border shrink-0', pm.bg, pm.text, pm.border)}>{pm.label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </motion.div>
              </div>

              {/* ── Row 3 : at-risk + recent activity ─────────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Overdue & at-risk */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ ...pageEnter, delay: 0.26 }}
                  className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                    <h2 className="text-sm font-semibold text-foreground">Overdue &amp; at-risk</h2>
                  </div>
                  <p className="text-xs text-muted-foreground/50 mb-4">Open tasks past due or due within 3 days</p>
                  {atRisk.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-6">
                      <p className="text-sm text-muted-foreground/30 italic">All caught up — nothing overdue or due soon</p>
                    </div>
                  ) : (
                    <ul className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {atRisk.map(({ t, overdue }) => {
                        const proj = projects.find(p => p.id === t.projectId);
                        const col = proj ? projColor(proj.id) : PROJECT_PALETTE[0];
                        return (
                          <li key={t.id} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5', overdue ? 'border-red-500/25 bg-red-500/[0.06]' : 'border-border/35 bg-muted/5')}>
                            <AlertTriangle className={cn('h-3.5 w-3.5 shrink-0', overdue ? 'text-red-400' : 'text-amber-400')} />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                {proj && (
                                  <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-semibold border', col.bg, col.text, col.border)}>{proj.name}</span>
                                )}
                                <span className={cn('text-[10px] font-semibold', overdue ? 'text-red-400' : 'text-amber-400')}>
                                  {overdue ? 'Overdue' : 'Due'} {fmtISO(t.dueDate)}
                                </span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </motion.div>

                {/* Recent activity */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ ...pageEnter, delay: 0.3 }}
                  className="rounded-2xl border border-border/60 bg-card p-6 flex flex-col"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    <h2 className="text-sm font-semibold text-foreground">Recent activity</h2>
                  </div>
                  <p className="text-xs text-muted-foreground/50 mb-4">Most recently completed work</p>
                  {recentActivity.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-6">
                      <p className="text-sm text-muted-foreground/30 italic">No completed tasks yet</p>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {recentActivity.map(t => {
                        const proj = projects.find(p => p.id === t.projectId);
                        const col = proj ? projColor(proj.id) : PROJECT_PALETTE[0];
                        return (
                          <li key={t.id} className="flex items-center gap-3 rounded-xl border border-border/35 bg-muted/5 px-3 py-2.5">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{t.title}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                {proj && (
                                  <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-semibold border', col.bg, col.text, col.border)}>{proj.name}</span>
                                )}
                                <span className="text-[10px] font-mono text-muted-foreground/40">
                                  {t.completedAt ? fmtISO(t.completedAt.slice(0, 10)) : ''}
                                </span>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </motion.div>
              </div>

              {/* ── Tasks by project ───────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ ...pageEnter, delay: 0.32 }}
                className="rounded-2xl border border-border/60 bg-card p-6 sm:p-7"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
                  <div>
                    <div className="flex items-center gap-2 text-primary mb-1">
                      <FolderKanban className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">Portfolio</span>
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">Tasks by project</h2>
                    <p className="text-xs text-muted-foreground/50 mt-1 max-w-lg">
                      Every task assigned to or raised by this person, grouped under the project it belongs to.
                    </p>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground/45 border border-border/40 rounded-full px-3 py-1">
                    {tasksByProject.length} project{tasksByProject.length !== 1 ? 's' : ''}
                  </span>
                </div>

                {tasksByProject.length === 0 ? (
                  <p className="text-sm text-muted-foreground/35 italic py-6 text-center">No project tasks yet.</p>
                ) : (
                  <div className="space-y-3">
                    {tasksByProject.map(({ project: p, tasks: pt }, gi) => {
                      const col = projColor(p.id);
                      const open = pt.filter(t => t.status !== 'completed').length;
                      return (
                        <motion.div
                          key={p.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ ...pageEnter, delay: Math.min(0.04 * gi, 0.35) }}
                        >
                        <details
                          className="group rounded-2xl border border-border/45 bg-muted/[0.12] overflow-hidden open:bg-muted/15 transition-colors"
                        >
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5 [&::-webkit-details-marker]:hidden">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className={cn('shrink-0 rounded-xl border px-2.5 py-1 text-xs font-bold', col.bg, col.text, col.border)}>
                                {p.name}
                              </span>
                              <span className="text-xs text-muted-foreground/50 tabular-nums">
                                {pt.length} task{pt.length !== 1 ? 's' : ''} · {open} active
                              </span>
                            </div>
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/35 group-open:text-primary/80">
                              Toggle
                            </span>
                          </summary>
                          <div className="border-t border-border/30 px-4 py-3 sm:px-5 space-y-2 bg-background/30">
                            {pt
                              .slice()
                              .sort((a, b) => {
                                const ad = a.status === 'completed' ? 1 : 0;
                                const bd = b.status === 'completed' ? 1 : 0;
                                if (ad !== bd) return ad - bd;
                                return a.dueDate.localeCompare(b.dueDate);
                              })
                              .map(t => {
                                const sm = STATUS_META[t.status];
                                const pm = PRIORITY_META[t.priority];
                                const isDone = t.status === 'completed';
                                return (
                                  <div
                                    key={t.id}
                                    className={cn(
                                      'flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-xl border border-border/25 px-3 py-2.5',
                                      isDone ? 'opacity-70' : '',
                                    )}
                                  >
                                    <p className={cn('text-sm font-medium text-foreground min-w-0 flex-1 truncate', isDone && 'line-through decoration-muted-foreground/25')}>
                                      {t.title}
                                    </p>
                                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                                      <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold border', pm.bg, pm.text, pm.border)}>
                                        {t.priority}
                                      </span>
                                      <span className={cn(
                                        'text-[10px] px-2.5 py-0.5 rounded-full font-bold border whitespace-nowrap',
                                        isDone
                                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                          : `${sm?.bg ?? 'bg-muted/20'} ${sm?.text ?? 'text-muted-foreground'} border-border/30`,
                                      )}>
                                        {isDone ? 'Done' : (sm?.label ?? t.status)}
                                      </span>
                                      {!isDone && (
                                        <span className="text-[10px] font-mono text-muted-foreground/40">Due {fmtISO(t.dueDate)}</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                          </div>
                        </details>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </motion.div>

              {/* ── Completed work ─────────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
                transition={{ ...pageEnter, delay: 0.36 }}
                className="rounded-2xl border border-border/60 bg-gradient-to-br from-emerald-500/[0.04] via-card to-card p-6 sm:p-7"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap mb-5">
                  <div>
                    <div className="flex items-center gap-2 text-emerald-500/80 mb-1">
                      <Trophy className="h-4 w-4" />
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/50">Shipped</span>
                    </div>
                    <h2 className="text-lg font-semibold text-foreground">Completed tasks</h2>
                    <p className="text-xs text-muted-foreground/50 mt-1">
                      Work this teammate has already finished — newest completions first.
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {doneTasks.length}
                  </span>
                </div>

                {doneTasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground/35 italic py-6 text-center">No completed tasks yet.</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {[...doneTasks]
                      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
                      .map((t, i) => {
                        const proj = projects.find(p => p.id === t.projectId);
                        const col = proj ? projColor(proj.id) : PROJECT_PALETTE[0];
                        return (
                          <motion.div
                            key={t.id}
                            initial={{ opacity: 0, scale: 0.98 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ ...pageEnter, delay: Math.min(i * 0.03, 0.35) }}
                            className="rounded-2xl border border-border/50 bg-card/90 p-4 flex flex-col gap-2 shadow-sm"
                          >
                            <p className="text-sm font-semibold text-foreground leading-snug">{t.title}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              {proj && (
                                <span className={cn('text-[10px] px-2 py-0.5 rounded-md font-semibold border', col.bg, col.text, col.border)}>
                                  {proj.name}
                                </span>
                              )}
                              <span className="text-[10px] font-mono text-muted-foreground/40">
                                {t.completedAt ? `Completed ${fmtISO(t.completedAt.slice(0, 10))}` : `Due ${fmtISO(t.dueDate)}`}
                              </span>
                            </div>
                          </motion.div>
                        );
                      })}
                  </div>
                )}
              </motion.div>

              {/* ── Row 4 : task table ─────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ ...pageEnter, delay: 0.38 }}
              >
                <details className="group rounded-2xl border border-border/60 bg-card overflow-hidden">
                {/* header */}
                <summary className="flex cursor-pointer list-none items-center justify-between px-6 py-4 border-b border-border/40 [&::-webkit-details-marker]:hidden">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">All Tasks</h2>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">{active.length} active · {doneTasks.length} completed</p>
                  </div>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/35 group-open:text-primary/80">
                    Toggle
                  </span>
                </summary>

                {/* column headers */}
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-6 py-2.5 bg-muted/20 border-b border-border/30">
                  {['Task', 'Project', 'Status', 'Priority'].map(h => (
                    <p key={h} className="text-[11px] font-semibold text-muted-foreground/40 uppercase tracking-widest">{h}</p>
                  ))}
                </div>

                {userTasks.length === 0 ? (
                  <div className="py-16 text-center">
                    <Circle className="h-10 w-10 text-muted/40 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground/40">No tasks assigned.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-border/20">
                    {/* active first, then done */}
                    {[...active, ...doneTasks].map((t, i) => {
                      const proj   = projects.find(p => p.id === t.projectId);
                      const sm     = STATUS_META[t.status];
                      const pm     = PRIORITY_META[t.priority];
                      const isDone = t.status === 'completed';
                      const isOvrd = !isDone && t.dueDate < TODAY;
                      return (
                        <motion.div key={t.id}
                          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          transition={{ ...pageEnter, delay: Math.min(i * 0.025, 0.4) }}
                          className={`grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-6 py-3.5 hover:bg-muted/20 transition-colors ${isDone ? 'opacity-50' : ''}`}
                        >
                          {/* title */}
                          <div className="min-w-0">
                            <p className={`text-sm font-medium text-foreground truncate ${isDone ? 'line-through decoration-muted-foreground/30' : ''}`}>
                              {t.title}
                            </p>
                            {isOvrd && (
                              <p className="text-[10px] text-red-400 font-semibold flex items-center gap-0.5 mt-0.5">
                                <AlertTriangle className="h-2.5 w-2.5" /> Overdue · {fmtISO(t.dueDate)}
                              </p>
                            )}
                            {!isDone && !isOvrd && t.dueDate && (
                              <p className="text-[10px] text-muted-foreground/35 font-mono mt-0.5">Due {fmtISO(t.dueDate)}</p>
                            )}
                          </div>

                          {/* project */}
                          <div>
                            {proj ? (() => {
                              const col = projColor(proj.id);
                              return (
                                <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border whitespace-nowrap ${col.bg} ${col.text} ${col.border}`}>
                                  {proj.name}
                                </span>
                              );
                            })() : <span className="text-[10px] text-muted-foreground/30">—</span>}
                          </div>

                          {/* status */}
                          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold whitespace-nowrap ${
                            isDone
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : `${sm?.bg ?? 'bg-muted/20'} ${sm?.text ?? 'text-muted-foreground'} border border-border/30`
                          }`}>
                            {isDone ? 'Completed' : (sm?.label ?? t.status)}
                          </span>

                          {/* priority */}
                          <span className={`text-[10px] px-2.5 py-1 rounded-full font-bold border whitespace-nowrap ${pm.bg} ${pm.text} ${pm.border}`}>
                            {t.priority}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
                </details>
              </motion.div>

            </motion.div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              TIMESHEET VIEW
          ════════════════════════════════════════════════════════════════ */}
          {view === 'timesheet' && (
            <motion.div
              key="timesheet"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={pageEnter}
              className="space-y-5"
            >

              {/* week nav */}
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center rounded-xl border border-border/40 bg-card px-1 py-1 gap-1">
                  <motion.button type="button" transition={snappy} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={() => setWkOff(w => w - 1)}
                    className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors">
                    <ChevronLeft className="h-4 w-4 text-muted-foreground" />
                  </motion.button>
                  <span className="min-w-[210px] text-center text-sm font-medium text-foreground/80 px-2">
                    {wkLabel}
                    {loadingWeek && <span className="text-xs text-muted-foreground/40 ml-1">…</span>}
                  </span>
                  <motion.button type="button" transition={snappy} whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    onClick={() => setWkOff(w => Math.min(0, w + 1))} disabled={wkOff >= 0}
                    className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-30 disabled:pointer-events-none">
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </motion.button>
                </div>

                <div className="flex items-center gap-2 rounded-xl border border-border/40 bg-card px-4 py-2 text-sm">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground/50" />
                  <span className="text-muted-foreground/60">Week total</span>
                  <span className="font-bold tabular-nums text-foreground">{fmtSecs(wkTotal)}</span>
                </div>

                {wkOff !== 0 && (
                  <button type="button" onClick={() => setWkOff(0)}
                    className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
                    This week
                  </button>
                )}
              </div>

              {/* days */}
              {visWD.length === 0
                ? <p className="text-sm text-muted-foreground/40 italic py-8 text-center">Nothing to show.</p>
                : (
                  <div className="space-y-3">
                    {dayView.map((day, di) => (
                      <motion.div key={day.date}
                        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ ...pageEnter, delay: di * 0.04 }}
                        className="rounded-2xl border border-border/60 bg-card overflow-hidden"
                      >
                        {/* day header */}
                        <div className="flex items-center justify-between px-6 py-3.5 border-b border-border/30 bg-muted/10">
                          <div className="flex items-center gap-3">
                            <span className="text-sm font-semibold text-foreground">{day.day}</span>
                            <span className="text-xs font-mono text-muted-foreground/40">{fmtISO(day.date)}</span>
                          </div>
                          <div className="flex items-center gap-3">
                            {day.total > 0 && (
                              <div className="w-24 h-1 rounded-full bg-muted/40 overflow-hidden">
                                <div className="h-full rounded-full bg-primary/50"
                                  style={{ width: `${Math.min(day.total/28800*100, 100)}%` }} />
                              </div>
                            )}
                            <span className={`text-sm font-bold tabular-nums ${day.total > 0 ? 'text-foreground' : 'text-muted-foreground/25'}`}>
                              {day.total > 0 ? fmtSecs(day.total) : '—'}
                            </span>
                          </div>
                        </div>

                        {/* entries */}
                        {day.es.length > 0
                          ? (
                            <div className="divide-y divide-border/20">
                              {day.es.map(e => {
                                const proj = projects.find(p => p.id === e.projectId);
                                const sec  = proj?.sections.find(s => s.id === e.sectionId);
                                const col  = proj ? projColor(proj.id) : null;
                                const scol = sec  ? projColor(e.sectionId) : null;
                                return (
                                  <div key={e.id} className="flex items-start justify-between gap-4 px-6 py-4 hover:bg-muted/10 transition-colors">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium text-foreground break-words">
                                        {e.description?.trim() || <span className="italic text-muted-foreground/35">No description</span>}
                                      </p>
                                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                        {col && proj && (
                                          <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border ${col.bg} ${col.text} ${col.border}`}>
                                            {proj.name}
                                          </span>
                                        )}
                                        {scol && sec && (
                                          <span className={`text-[10px] px-2 py-0.5 rounded-md font-semibold border opacity-80 ${scol.bg} ${scol.text} ${scol.border}`}>
                                            {sec.name}
                                          </span>
                                        )}
                                        <span className="text-[10px] font-mono text-muted-foreground/35">{e.timeFrom} – {e.timeTo}</span>
                                      </div>
                                    </div>
                                    <span className="text-sm font-bold font-mono tabular-nums shrink-0 text-foreground/70 pt-0.5">
                                      {fmtSecs(e.seconds)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )
                          : <p className="px-6 py-5 text-sm text-muted-foreground/25 italic">No entries</p>
                        }
                      </motion.div>
                    ))}
                  </div>
                )
              }
            </motion.div>
          )}

        </AnimatePresence>

        <DayTimelineDialog
          open={dayDetailDate !== null}
          onOpenChange={open => {
            if (!open) setDayDetailDate(null);
          }}
          isoDate={dayDetailDate}
          entries={weekEntries}
          projects={projects}
        />
      </div>
    </div>
  );
}
