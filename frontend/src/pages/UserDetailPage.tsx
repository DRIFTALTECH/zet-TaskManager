/**
 * UserDetailPage — analytics-first profile for a team member.
 * Layout: KPI row → (bar chart | donut) → (priority list | project list)
 *         → task table → timesheet
 */

import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Mail, Briefcase, ChevronLeft, ChevronRight,
  Clock, AlertTriangle, CheckCircle2, Circle, BarChart2,
  CalendarDays, ListChecks, Flame,
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

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: {value:number;name:string}[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border/60 rounded-xl shadow-xl px-3.5 py-2.5 text-xs">
      {label && <p className="font-semibold text-foreground/70 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="font-bold text-foreground">{p.name}: {fmtSecs(p.value)}</p>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

type View = 'analytics' | 'timesheet';

export default function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>();
  const { users, tasks, projects, kanbanColumns } = useAppStore();

  const [view, setView]             = useState<View>('analytics');
  const [wkOff, setWkOff]           = useState(0);
  const [entries, setEntries]       = useState<TimesheetWorkEntry[]>([]);
  const [loadingTS, setLoadingTS]   = useState(false);
  const [barData, setBarData]       = useState<{ day: string; seconds: number }[]>(
    DAY_SHORT.map(d => ({ day: d, seconds: 0 }))
  );

  const TODAY = isoToday();
  const WD    = weekOf(wkOff);
  const visWD = WD.filter(d => d <= TODAY);

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

  const priorityData = useMemo(() =>
    (['Urgent','High','Medium','Low'] as Priority[]).map(p => ({
      priority: p, count: userTasks.filter(t => t.priority === p).length, ...PRIORITY_META[p],
    })),
  [userTasks]);

  const projectStats = useMemo(() =>
    userProjects.map((p, i) => {
      const pt   = userTasks.filter(t => t.projectId === p.id);
      const done = pt.filter(t => t.status === 'completed').length;
      return { p, i, total: pt.length, done, rate: pt.length ? Math.round(done/pt.length*100) : 0 };
    }),
  [userProjects, userTasks]);

  // ── fetch this-week hours ─────────────────────────────────────────────────

  useEffect(() => {
    if (!userId) return;
    let cancel = false;
    const wd0 = weekOf(0);
    void (async () => {
      try {
        const list = await api.getTimesheetWorkEntriesForUser(userId, wd0[0], wd0[6]);
        if (cancel) return;
        setBarData(wd0.map((d, i) => ({
          day: DAY_SHORT[i],
          seconds: list.filter(e => e.workDate === d && d <= TODAY).reduce((a, e) => a + e.seconds, 0),
        })));
      } catch { /* keep zeroes */ }
    })();
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const weekHrs = barData.reduce((a, d) => a + d.seconds, 0);

  // ── timesheet fetch ───────────────────────────────────────────────────────

  const fetchTS = useCallback(async () => {
    if (!userId) return;
    setLoadingTS(true);
    try { setEntries(await api.getTimesheetWorkEntriesForUser(userId, WD[0], WD[6])); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load timesheet'); }
    finally { setLoadingTS(false); }
  }, [userId, WD[0], WD[6]]);

  useEffect(() => { if (view === 'timesheet') void fetchTS(); }, [view, fetchTS]);

  const dayView = visWD
    .map(date => {
      const idx = WD.indexOf(date);
      const es  = entries.filter(e => e.workDate === date);
      return { date, day: DAY_LONG[idx], es, total: es.reduce((a, e) => a + e.seconds, 0) };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const wkTotal  = entries.filter(e => e.workDate <= TODAY).reduce((a, e) => a + e.seconds, 0);
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

              {/* ── Row 2 : bar chart (2/3) + donut (1/3) ────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Weekly activity bar chart */}
                <motion.div
                  initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ ...pageEnter, delay: 0.18 }}
                  className="lg:col-span-2 rounded-2xl border border-border/60 bg-card p-6"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div>
                      <h2 className="text-sm font-semibold text-foreground">Hours logged this week</h2>
                      <p className="text-xs text-muted-foreground/50 mt-0.5">
                        {weekHrs > 0 ? `${fmtSecs(weekHrs)} total` : 'No hours logged yet'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
                      <Clock className="h-3.5 w-3.5" />
                      Current week
                    </div>
                  </div>

                  <div className="mt-4 h-52">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} barCategoryGap="35%" margin={{ top: 4, right: 0, bottom: 0, left: -20 }}>
                        <XAxis
                          dataKey="day"
                          axisLine={false} tickLine={false}
                          tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))', opacity: 0.5 }}
                        />
                        <YAxis
                          tickFormatter={v => v > 0 ? `${Math.floor(v/3600)}h` : ''}
                          axisLine={false} tickLine={false}
                          tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))', opacity: 0.4 }}
                        />
                        <RTooltip
                          content={<ChartTooltip />}
                          formatter={(v: number) => [fmtSecs(v), 'Logged']}
                          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.3, radius: 6 }}
                        />
                        <Bar dataKey="seconds" name="Logged" radius={[6, 6, 0, 0]}>
                          {barData.map((d, i) => {
                            const isToday = weekOf(0)[i] === TODAY;
                            return (
                              <Cell key={i}
                                fill={isToday ? 'hsl(var(--primary))' : d.seconds > 0 ? 'hsl(var(--primary) / 0.35)' : 'hsl(var(--muted) / 0.4)'}
                              />
                            );
                          })}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </motion.div>

                {/* Status donut */}
                <motion.div
                  initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ ...pageEnter, delay: 0.22 }}
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
              </div>

              {/* ── Row 3 : priority list + project list ──────────────── */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Priority distribution */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ ...pageEnter, delay: 0.26 }}
                  className="rounded-2xl border border-border/60 bg-card p-6"
                >
                  <h2 className="text-sm font-semibold text-foreground mb-1">Priority distribution</h2>
                  <p className="text-xs text-muted-foreground/50 mb-5">Breakdown of all assigned tasks</p>

                  <div className="space-y-4">
                    {priorityData.map((p, i) => (
                      <div key={p.priority}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2.5">
                            <span className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${p.bg} ${p.text} ${p.border}`}>
                              {p.label}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground tabular-nums">{p.count}</span>
                            <span className="text-xs text-muted-foreground/35 tabular-nums w-8 text-right">
                              {userTasks.length ? `${Math.round(p.count/userTasks.length*100)}%` : '—'}
                            </span>
                          </div>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${userTasks.length ? (p.count/userTasks.length)*100 : 0}%` }}
                            transition={{ duration: 0.7, delay: 0.4 + i * 0.08, ease: [.34,1.56,.64,1] }}
                            className="h-full rounded-full"
                            style={{ background: p.hex }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>

                {/* Project contributions */}
                <motion.div
                  initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ ...pageEnter, delay: 0.3 }}
                  className="rounded-2xl border border-border/60 bg-card p-6"
                >
                  <h2 className="text-sm font-semibold text-foreground mb-1">Project contributions</h2>
                  <p className="text-xs text-muted-foreground/50 mb-5">Tasks done per project</p>

                  {projectStats.length === 0 ? (
                    <p className="text-sm text-muted-foreground/30 italic">Not in any project yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {projectStats.map((ps, i) => {
                        const col = projColor(ps.p.id);
                        return (
                          <div key={ps.p.id}>
                            <div className="flex items-center justify-between mb-2">
                              <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg border ${col.bg} ${col.text} ${col.border} truncate max-w-[180px]`}>
                                {ps.p.name}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-foreground tabular-nums">{ps.rate}%</span>
                                <span className="text-xs text-muted-foreground/35">{ps.done}/{ps.total}</span>
                              </div>
                            </div>
                            <div className="h-1.5 rounded-full bg-muted/30 overflow-hidden">
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${ps.rate}%` }}
                                transition={{ duration: 0.7, delay: 0.45 + i * 0.07, ease: [.34,1.56,.64,1] }}
                                className="h-full rounded-full"
                                style={{ background: col.hex }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              </div>

              {/* ── Row 4 : task table ─────────────────────────────────── */}
              <motion.div
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ ...pageEnter, delay: 0.34 }}
                className="rounded-2xl border border-border/60 bg-card overflow-hidden"
              >
                {/* header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border/40">
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">All Tasks</h2>
                    <p className="text-xs text-muted-foreground/50 mt-0.5">{active.length} active · {doneTasks.length} completed</p>
                  </div>
                </div>

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
                    {loadingTS && <span className="text-xs text-muted-foreground/40 ml-1">…</span>}
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
      </div>
    </div>
  );
}
