/**
 * ProjectDetailPage — per-project manager dashboard at /manage/:projectId.
 * Health KPIs + four charts (time per section, status breakdown, member
 * workload, completion trend) + member / section management + a task board
 * where tasks move across columns via buttons.
 */
import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { isTaskAssignedTo, taskAssigneeIds } from '@/lib/task-utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { startOfWeek, addWeeks, format } from 'date-fns';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  Cell, PieChart, Pie, AreaChart, Area, CartesianGrid,
} from 'recharts';
import {
  ArrowLeft, Plus, Users, LayoutGrid, ListTodo, Clock, FolderOpen,
  UserPlus, X, Trash2, ChevronLeft, ChevronRight,
  RotateCcw, Check, BarChart2, PieChart as PieIcon, TrendingUp, Search,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import TaskDetailModal from '@/components/TaskDetailModal';
import UserAvatar from '@/components/UserAvatar';
import { api } from '@/lib/api';
import { Task, TimesheetWorkEntry } from '@/types';
import {
  projectAccent, formatHM, hoursDecimal,
  PRIORITY_STYLES, STATUS_PALETTE, activeTasksForUser,
} from '@/lib/manage-utils';

/** Completion / "done" is always green, regardless of project accent. */
const GREEN = '#10b981';

/** Status colour: "completed" is always green; everything else follows the palette. */
const statusColor = (status: string, i: number) =>
  status === 'completed' ? GREEN : STATUS_PALETTE[i % STATUS_PALETTE.length];

// ── Chart tooltip (theme-aware) ─────────────────────────────────────────────────
function ChartTooltip({ active, payload, label, unit }: {
  active?: boolean; payload?: { name?: string; value?: number; payload?: Record<string, unknown> }[]; label?: string; unit?: string;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0];
  const name = (row.payload?.fullName as string) || label || row.name;
  return (
    <div className="rounded-xl border border-border/60 bg-popover px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-foreground mb-0.5 max-w-[200px] truncate">{name}</p>
      <p className="text-muted-foreground">{row.value}{unit ? ` ${unit}` : ''}</p>
    </div>
  );
}

const statusLabel = (id: string, columns: { id: string; label: string }[]) => {
  const c = columns.find(x => x.id === id);
  if (c) return c.label;
  if (id === 'completed') return 'Completed';
  return id.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
};

const statusChipCls = (status: string) =>
  status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
  : status === 'in_progress' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
  : status === 'in_review' ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
  : status === 'done' ? 'bg-green-500/15 text-green-400 border-green-500/25'
  : 'bg-muted text-muted-foreground border-border/40';

const ProjectDetailPage = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    users, projects, tasks, kanbanColumns,
    addSection, removeSection, addMemberToProject, removeMemberFromProject,
    moveTask, approveTask, reopenTaskToBacklog,
  } = useAppStore();

  const project = projects.find(p => p.id === projectId);
  const accent = project ? projectAccent(project.id) : null;

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [memberToRemove, setMemberToRemove] = useState<{ id: string; name: string } | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<{ id: string; name: string } | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [deletingSection, setDeletingSection] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [addMemberOpen, setAddMemberOpen] = useState(false);
  const [addMemberSearch, setAddMemberSearch] = useState('');
  const [sectionDetail, setSectionDetail] = useState<{ id: string; name: string } | null>(null);

  // All timesheet entries for this project (across every member) — the single
  // source of truth for "time" across this page.
  const [timesheet, setTimesheet] = useState<TimesheetWorkEntry[]>([]);
  const [timesheetLoading, setTimesheetLoading] = useState(true);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setTimesheetLoading(true);
    api.getProjectTimesheetEntries(projectId)
      .then(rows => { if (alive) setTimesheet(rows); })
      .catch(() => { if (alive) setTimesheet([]); })
      .finally(() => { if (alive) setTimesheetLoading(false); });
    return () => { alive = false; };
  }, [projectId]);

  const projectTasks = useMemo(
    () => (project ? tasks.filter(t => t.projectId === project.id) : []),
    [project, tasks],
  );

  // Total logged time for the project — purely from the timesheet.
  const projectSeconds = useMemo(() => timesheet.reduce((a, e) => a + (e.seconds || 0), 0), [timesheet]);

  // Hours logged per day across the whole project (all members) — the big trend chart.
  const projectDailyHours = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const e of timesheet) byDate.set(e.workDate, (byDate.get(e.workDate) || 0) + (e.seconds || 0));
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, secs]) => ({ date, label: format(new Date(date), 'MMM d'), hours: hoursDecimal(secs) }));
  }, [timesheet]);
  const hasDailyHours = projectDailyHours.some(d => d.hours > 0);

  // ── Chart data ──────────────────────────────────────────────────────────────
  // Time per section (timesheet seconds, all members). Keeps every section so it
  // is always a click target, plus an "Unsectioned" bucket for orphaned rows.
  const timeBySection = useMemo(() => {
    if (!project) return [];
    const byId = new Map<string, number>();
    for (const e of timesheet) byId.set(e.sectionId, (byId.get(e.sectionId) || 0) + (e.seconds || 0));
    const known = new Set(project.sections.map(s => s.id));
    const rows = project.sections.map(s => {
      const secs = byId.get(s.id) || 0;
      return { id: s.id, name: s.name, fullName: s.name, hours: hoursDecimal(secs), seconds: secs };
    });
    let orphan = 0;
    for (const [id, secs] of byId) if (!known.has(id)) orphan += secs;
    if (orphan > 0) rows.push({ id: '__none__', name: 'Unsectioned', fullName: 'Unsectioned', hours: hoursDecimal(orphan), seconds: orphan });
    return rows.sort((a, b) => b.seconds - a.seconds);
  }, [project, timesheet]);
  const hasSectionTime = timeBySection.some(r => r.seconds > 0);

  // Per-day hours for the section drill-down popup.
  const sectionDailyData = useMemo(() => {
    if (!sectionDetail) return [];
    const byDate = new Map<string, number>();
    for (const e of timesheet) {
      if (e.sectionId !== sectionDetail.id) continue;
      byDate.set(e.workDate, (byDate.get(e.workDate) || 0) + (e.seconds || 0));
    }
    return [...byDate.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, secs]) => ({ date, label: format(new Date(date), 'MMM d'), hours: hoursDecimal(secs) }));
  }, [sectionDetail, timesheet]);

  const statusBreakdown = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of projectTasks) counts.set(t.status, (counts.get(t.status) || 0) + 1);
    const ordered = [...kanbanColumns.map(c => c.id), 'completed'];
    const seen = new Set<string>();
    const rows: { name: string; value: number; status: string }[] = [];
    for (const id of ordered) {
      if (counts.has(id)) { rows.push({ name: statusLabel(id, kanbanColumns), value: counts.get(id)!, status: id }); seen.add(id); }
    }
    for (const [id, v] of counts) if (!seen.has(id)) rows.push({ name: statusLabel(id, kanbanColumns), value: v, status: id });
    return rows;
  }, [projectTasks, kanbanColumns]);

  // Member contribution: every task assigned to a person, regardless of status/column.
  const memberContribution = useMemo(() => {
    if (!project) return [];
    return project.members
      .map(id => {
        const u = users.find(x => x.id === id);
        const name = u?.name || 'Unknown';
        const total = projectTasks.filter(t => isTaskAssignedTo(t, id)).length;
        return { name: name.split(' ')[0], fullName: name, total };
      })
      .sort((a, b) => b.total - a.total);
  }, [project, users, projectTasks]);
  const hasContribution = memberContribution.some(m => m.total > 0);

  const completionTrend = useMemo(() => {
    const weeks = 8;
    const start = startOfWeek(addWeeks(new Date(), -(weeks - 1)), { weekStartsOn: 1 });
    const buckets = Array.from({ length: weeks }, (_, i) => {
      const wStart = addWeeks(start, i);
      return { key: format(wStart, 'yyyy-MM-dd'), label: format(wStart, 'MMM d'), completed: 0 };
    });
    for (const t of projectTasks) {
      if (!t.completedAt) continue;
      const d = new Date(t.completedAt);
      if (Number.isNaN(d.getTime())) continue;
      const wStart = startOfWeek(d, { weekStartsOn: 1 });
      const key = format(wStart, 'yyyy-MM-dd');
      const b = buckets.find(x => x.key === key);
      if (b) b.completed += 1;
    }
    return buckets;
  }, [projectTasks]);
  const hasCompletionData = completionTrend.some(b => b.completed > 0);

  // ── Task grouping ─────────────────────────────────────────────────────────────
  const visibleTasks = useMemo(
    () => (statusFilter === 'all' ? projectTasks : projectTasks.filter(t => t.status === statusFilter)),
    [projectTasks, statusFilter],
  );

  if (!project || !accent) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100dvh-3.5rem)] text-center px-8">
        <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4 border border-border/30">
          <FolderOpen className="h-7 w-7 text-muted-foreground/30" />
        </div>
        <h2 className="text-lg font-bold text-foreground/70 mb-1.5">Project not found</h2>
        <p className="text-sm text-muted-foreground/50 mb-5">It may have been deleted or you don’t have access.</p>
        <button onClick={() => navigate('/manage')} className="text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold hover:opacity-90">
          Back to projects
        </button>
      </div>
    );
  }

  const members = users.filter(u => project.members.includes(u.id));
  const filteredMembers = members.filter(u => u.name.toLowerCase().includes(memberSearch.toLowerCase()));
  const nonMembers = users.filter(u => !project.members.includes(u.id));
  const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))', opacity: 0.55 };

  const handleAddSection = async () => {
    if (!sectionName.trim()) return toast.error('Enter section name');
    try {
      await addSection(project.id, sectionName.trim());
      toast.success('Section added!');
      setAddSectionOpen(false); setSectionName('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add section'); }
  };

  const confirmRemoveMember = async () => {
    if (!memberToRemove) return;
    setRemovingMember(true);
    try {
      await removeMemberFromProject(project.id, memberToRemove.id);
      toast.success(`${memberToRemove.name} removed`);
      setMemberToRemove(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove member'); }
    finally { setRemovingMember(false); }
  };

  const confirmDeleteSection = async () => {
    if (!sectionToDelete) return;
    setDeletingSection(true);
    try {
      await removeSection(project.id, sectionToDelete.id);
      toast.success(`Section "${sectionToDelete.name}" deleted`);
      setSectionToDelete(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete section'); }
    finally { setDeletingSection(false); }
  };

  const doMove = async (task: Task, status: string) => {
    setMovingId(task.id);
    try { await moveTask(task.id, status); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not move task'); }
    finally { setMovingId(null); }
  };
  const doApprove = async (task: Task) => {
    setMovingId(task.id);
    try { await approveTask(task.id); toast.success('Task approved'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not approve'); }
    finally { setMovingId(null); }
  };
  const doReopen = async (task: Task) => {
    setMovingId(task.id);
    try { await reopenTaskToBacklog(task.id); toast.success('Reopened to backlog'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not reopen'); }
    finally { setMovingId(null); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-muted/20 to-transparent">
        <div className={`h-1.5 w-full ${accent.bg}`} />
        <div className="px-8 pt-5 pb-6">
          <Link to="/manage" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground/60 hover:text-foreground transition-colors mb-4">
            <ArrowLeft className="h-3.5 w-3.5" /> All projects
          </Link>
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-start gap-4 min-w-0">
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${accent.light}`}>
                <FolderOpen className={`h-7 w-7 ${accent.text}`} />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-foreground break-words">{projectPickerLabel(project)}</h1>
                {project.description && <p className="text-sm text-muted-foreground/60 mt-1 max-w-xl">{project.description}</p>}
                <div className="flex items-center gap-2 mt-3">
                  <div className="flex -space-x-2">
                    {members.slice(0, 6).map(u => (
                      <div key={u.id} className="ring-2 ring-background rounded-full"><UserAvatar name={u.name} avatar={u.avatar} size="xs" /></div>
                    ))}
                  </div>
                  {members.length > 6 && <span className="text-xs text-muted-foreground/50">+{members.length - 6}</span>}
                  <span className="text-xs text-muted-foreground/50 ml-1">{members.length} {members.length === 1 ? 'member' : 'members'}</span>
                </div>
              </div>
            </div>
            <span
              title="Total time logged on this project (from timesheets)"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground/70 whitespace-nowrap ml-auto pt-1"
            >
              <Clock className="h-3.5 w-3.5 opacity-60" />
              {timesheetLoading ? 'Loading…' : `${formatHM(projectSeconds)} logged`}
            </span>
          </div>
        </div>
      </div>

      <div className="p-8 space-y-8">
        {/* ── Hours per day (full-width trend) ──────────────────────────── */}
        <ChartCard icon={<TrendingUp className="h-4 w-4" />} title="Hours logged per day" accent={accent}
          subtitle={`Daily timesheet hours across all members · total ${formatHM(projectSeconds)}`}>
          {timesheetLoading ? (
            <ChartEmpty msg="Loading timesheets…" />
          ) : !hasDailyHours ? (
            <ChartEmpty msg="No time logged yet" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={projectDailyHours} margin={{ top: 8, right: 16, bottom: 4, left: -10 }}>
                <defs>
                  <linearGradient id="projDayGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={accent.hex} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={accent.hex} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.25} />
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} minTickGap={20} />
                <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} tickFormatter={v => `${v}h`} />
                <RTooltip content={<ChartTooltip unit="h" />} cursor={{ stroke: 'hsl(var(--border))' }} />
                <Area type="monotone" dataKey="hours" stroke={accent.hex} strokeWidth={2.5} fill="url(#projDayGrad)" activeDot={{ r: 4 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* ── Charts grid ───────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Time per section (vertical, colored, click a bar to drill into per-day) */}
          <ChartCard icon={<BarChart2 className="h-4 w-4" />} title="Time per section" accent={accent}
            subtitle="Hours logged per section — click a bar for the daily breakdown">
            {timesheetLoading ? (
              <ChartEmpty msg="Loading timesheets…" />
            ) : !hasSectionTime ? (
              <ChartEmpty msg="No time logged yet" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={timeBySection} margin={{ top: 4, right: 12, bottom: 4, left: -18 }} barCategoryGap="24%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.25} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={axisTick} interval={0}
                    tickFormatter={(v: string) => (v.length > 10 ? v.slice(0, 9) + '…' : v)} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} tickFormatter={v => `${v}h`} />
                  <RTooltip content={<ChartTooltip unit="h" />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }} />
                  <Bar dataKey="hours" radius={[6, 6, 0, 0]} barSize={40} cursor="pointer"
                    onClick={(d: { id?: string; name?: string }) => d?.id && setSectionDetail({ id: d.id, name: d.name || 'Section' })}>
                    {timeBySection.map((_, i) => <Cell key={i} fill={STATUS_PALETTE[i % STATUS_PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Status breakdown */}
          <ChartCard icon={<PieIcon className="h-4 w-4" />} title="Task status breakdown" accent={accent}
            subtitle="How work is distributed across columns">
            {projectTasks.length === 0 ? (
              <ChartEmpty msg="No tasks yet" />
            ) : (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="55%" height={240}>
                  <PieChart>
                    <Pie data={statusBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%"
                      innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                      {statusBreakdown.map((s, i) => <Cell key={i} fill={statusColor(s.status, i)} />)}
                    </Pie>
                    <RTooltip content={<ChartTooltip unit="tasks" />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {statusBreakdown.map((s, i) => (
                    <div key={s.status} className="flex items-center gap-2 text-xs">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: statusColor(s.status, i) }} />
                      <span className="text-muted-foreground/70 flex-1 truncate">{s.name}</span>
                      <span className="font-semibold text-foreground">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </ChartCard>

          {/* Member contribution — every task assigned to a person (any status) */}
          <ChartCard icon={<Users className="h-4 w-4" />} title="Member contribution" accent={accent}
            subtitle="Total tasks assigned per member (any status)">
            {!hasContribution ? (
              <ChartEmpty msg="No assigned tasks yet" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={memberContribution} margin={{ top: 4, right: 12, bottom: 4, left: -18 }} barCategoryGap="28%">
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.25} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={axisTick} interval={0} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                  <RTooltip content={<ChartTooltip unit="tasks" />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.2 }} />
                  <Bar dataKey="total" radius={[6, 6, 0, 0]} barSize={34} fill={accent.hex} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          {/* Completion trend */}
          <ChartCard icon={<TrendingUp className="h-4 w-4" />} title="Completion over time" accent={accent}
            subtitle="Tasks approved per week (last 8 weeks)">
            {!hasCompletionData ? (
              <ChartEmpty msg="No completed tasks in this window" />
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={completionTrend} margin={{ top: 4, right: 12, bottom: 4, left: -18 }}>
                  <defs>
                    <linearGradient id="compGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={GREEN} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={GREEN} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.25} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} interval={0} />
                  <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={axisTick} />
                  <RTooltip content={<ChartTooltip unit="completed" />} cursor={{ stroke: 'hsl(var(--border))' }} />
                  <Area type="monotone" dataKey="completed" stroke={GREEN} strokeWidth={2} fill="url(#compGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* ── Members ───────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border/35 bg-card/40 p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Users className={`h-4 w-4 ${accent.text}`} />
              <h3 className="text-sm font-bold text-foreground">Members <span className="ml-1 text-xs font-normal text-muted-foreground/60">({members.length})</span></h3>
            </div>
            <div className="flex items-center gap-2">
              {members.length > 4 && (
                <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3 py-1.5 w-44">
                  <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                  <input value={memberSearch} onChange={e => setMemberSearch(e.target.value)} placeholder="Search…"
                    className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40" />
                </div>
              )}
              <motion.button transition={snappy} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                onClick={() => { setAddMemberSearch(''); setAddMemberOpen(true); }}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all font-semibold ${accent.pill}`}>
                <UserPlus className="h-3.5 w-3.5" /> Add Member
              </motion.button>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence mode="popLayout">
              {filteredMembers.map(u => {
                const active = activeTasksForUser(projectTasks, u.id);
                return (
                  <motion.div key={u.id} layout transition={snappy}
                    initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
                    className="group rounded-xl border border-border/35 bg-card hover:border-border/60 hover:shadow-sm transition-all p-3.5">
                    <div className="flex items-center gap-3">
                      <UserAvatar name={u.name} avatar={u.avatar} size="md" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-semibold truncate">{u.name}</span>
                          {u.role === 'manager' && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">Mgr</span>}
                        </div>
                        <span className={`text-[11px] ${active > 0 ? 'text-primary/70 font-medium' : 'text-muted-foreground/50'}`}>{active} active {active === 1 ? 'task' : 'tasks'}</span>
                      </div>
                      <button onClick={() => setMemberToRemove({ id: u.id, name: u.name })}
                        className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-all shrink-0" aria-label={`Remove ${u.name}`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {members.length === 0 && (
              <div className="col-span-full text-center py-6 text-sm text-muted-foreground/40 italic border border-dashed border-border/30 rounded-xl">No members yet — add someone below.</div>
            )}
          </div>

          {nonMembers.length > 0 && (
            <div className="mt-5 pt-5 border-t border-border/25">
              <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-3">Add to project</p>
              <div className="flex flex-wrap gap-2">
                {nonMembers
                  .sort((a, b) => ((a.role === 'manager' ? 0 : 1) - (b.role === 'manager' ? 0 : 1)) || a.name.localeCompare(b.name))
                  .map(u => (
                    <motion.button key={u.id} transition={snappy} whileHover={{ scale: 1.03, y: -1 }} whileTap={{ scale: 0.97 }}
                      onClick={() => void addMemberToProject(project.id, u.id).then(() => toast.success(`${u.name} added!`)).catch(e => toast.error(e instanceof Error ? e.message : 'Could not add member'))}
                      className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border border-border/40 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 hover:text-primary text-muted-foreground/70 transition-all font-medium group">
                      <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                      <span>{u.name}</span>
                      <UserPlus className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </motion.button>
                  ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Sections ──────────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border/35 bg-card/40 p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <LayoutGrid className={`h-4 w-4 ${accent.text}`} />
              <h3 className="text-sm font-bold text-foreground">Sections <span className="ml-1 text-xs font-normal text-muted-foreground/60">({project.sections.length})</span></h3>
            </div>
            <motion.button transition={snappy} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              onClick={() => setAddSectionOpen(true)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all font-semibold ${accent.pill}`}>
              <Plus className="h-3 w-3" /> Add Section
            </motion.button>
          </div>
          {project.sections.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground/40 italic border border-dashed border-border/30 rounded-xl">No sections yet</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <AnimatePresence>
                {project.sections.map(s => {
                  const secTasks = projectTasks.filter(t => t.sectionId === s.id).length;
                  return (
                    <motion.span key={s.id} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
                      className="inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-xl border border-border/40 bg-muted/30 font-medium group hover:border-border/60 transition-all">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${accent.bg}`} />
                      <span className="break-words [overflow-wrap:anywhere]">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground/45">{secTasks}</span>
                      <button type="button" onClick={() => setSectionToDelete({ id: s.id, name: s.name })}
                        className="p-0.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-all" aria-label={`Delete section ${s.name}`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </motion.span>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* ── Tasks board ───────────────────────────────────────────────── */}
        <section className="rounded-2xl border border-border/35 bg-card/40 p-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <ListTodo className={`h-4 w-4 ${accent.text}`} />
              <h3 className="text-sm font-bold text-foreground">Tasks <span className="ml-1 text-xs font-normal text-muted-foreground/60">({projectTasks.length})</span></h3>
            </div>
            {/* Status filter chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} label="All" count={projectTasks.length} accent={accent} />
              {statusBreakdown.map(s => (
                <FilterChip key={s.status} active={statusFilter === s.status} onClick={() => setStatusFilter(s.status)} label={s.name} count={s.value} accent={accent} />
              ))}
            </div>
          </div>

          {projectTasks.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground/40 italic border border-dashed border-border/30 rounded-xl">No tasks in this project</div>
          ) : visibleTasks.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground/40 italic">No tasks with this status</div>
          ) : (
            <div className="space-y-2">
              {visibleTasks.map(task => {
                const colIdx = kanbanColumns.findIndex(c => c.id === task.status);
                const prevCol = colIdx > 0 ? kanbanColumns[colIdx - 1] : null;
                const nextCol = colIdx >= 0 && colIdx < kanbanColumns.length - 1 ? kanbanColumns[colIdx + 1] : null;
                const completed = task.status === 'completed';
                const isDoneCol = task.status === 'done';
                const busy = movingId === task.id;
                const assignees = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean);
                const section = project.sections.find(s => s.id === task.sectionId);
                const priStyle = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.Low;
                return (
                  <div key={task.id}
                    className={`group flex items-center gap-3 rounded-xl border border-border/30 bg-card hover:border-border/60 hover:shadow-sm p-3.5 transition-all ${busy ? 'opacity-60' : ''}`}>
                    <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-bold border ${priStyle}`}>{task.priority}</span>
                    <button onClick={() => setSelectedTask(task)} className="flex-1 min-w-0 text-left">
                      <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors break-words [overflow-wrap:anywhere] leading-snug">{task.title}</h4>
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-[11px] text-muted-foreground/55">
                        {assignees.length > 0 && <span>{assignees.map(a => a!.name).join(', ')}</span>}
                        {section && <><span>·</span><span>{section.name}</span></>}
                        {task.timeTracked > 0 && <><span>·</span><span>{formatHM(task.timeTracked)}</span></>}
                      </div>
                    </button>

                    {/* status chip */}
                    <span className={`shrink-0 hidden sm:inline-flex text-[10px] px-2.5 py-1 rounded-full border font-medium capitalize ${statusChipCls(task.status)}`}>
                      {statusLabel(task.status, kanbanColumns)}
                    </span>

                    {/* move controls */}
                    <div className="flex items-center gap-1 shrink-0">
                      {completed ? (
                        <button disabled={busy} onClick={() => void doReopen(task)}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-border/40 bg-muted/30 hover:bg-amber-500/10 hover:border-amber-500/40 hover:text-amber-400 text-muted-foreground/70 transition-all disabled:opacity-40" title="Reopen to backlog">
                          <RotateCcw className="h-3.5 w-3.5" /> Reopen
                        </button>
                      ) : (
                        <>
                          <MoveBtn disabled={busy || !prevCol} onClick={() => prevCol && void doMove(task, prevCol.id)} title={prevCol ? `Move to ${prevCol.label}` : 'At first column'} dir="left" />
                          <MoveBtn disabled={busy || !nextCol} onClick={() => nextCol && void doMove(task, nextCol.id)} title={nextCol ? `Move to ${nextCol.label}` : 'At last column'} dir="right" />
                          {isDoneCol && (
                            <button disabled={busy} onClick={() => void doApprove(task)}
                              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 transition-all disabled:opacity-40" title="Approve & complete">
                              <Check className="h-3.5 w-3.5" /> Approve
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <Dialog open={addSectionOpen} onOpenChange={o => { setAddSectionOpen(o); if (!o) setSectionName(''); }}>
        <DialogContent className="sm:max-w-sm rounded-2xl"
          onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus(); }}>
          <DialogHeader><DialogTitle className="text-xl font-bold">Add Section</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <input autoFocus value={sectionName} onChange={e => setSectionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleAddSection()}
              className="w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-muted-foreground/40"
              placeholder="Section name" />
            <button onClick={() => void handleAddSection()} disabled={!sectionName.trim()}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all shadow-sm">Add Section</button>
          </div>
        </DialogContent>
      </Dialog>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />

      <AlertDialog open={!!memberToRemove} onOpenChange={o => !o && setMemberToRemove(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {memberToRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription>They will lose access to this project. You can re-add them at any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingMember}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={removingMember}
              onClick={e => { e.preventDefault(); void confirmRemoveMember(); }}>
              {removingMember ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!sectionToDelete} onOpenChange={o => !o && setSectionToDelete(null)}>
        <AlertDialogContent className="max-w-[min(100%,28rem)] rounded-2xl overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words [overflow-wrap:anywhere] pr-2">Delete section &quot;{sectionToDelete?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">You can only delete a section if it has no tasks and no timesheet rows. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSection}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deletingSection}
              onClick={e => { e.preventDefault(); void confirmDeleteSection(); }}>
              {deletingSection ? 'Deleting…' : 'Delete section'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Section drill-down: per-day hours logged */}
      <Dialog open={!!sectionDetail} onOpenChange={o => !o && setSectionDetail(null)}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold break-words [overflow-wrap:anywhere]">
              {sectionDetail?.name} — daily time
            </DialogTitle>
          </DialogHeader>
          <div className="pt-1">
            <p className="text-xs text-muted-foreground/55 mb-3">
              Hours logged per day (from timesheets) · total {formatHM(sectionDailyData.reduce((a, d) => a + d.hours * 3600, 0))}
            </p>
            {sectionDailyData.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground/40 italic">No time logged for this section</div>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={sectionDailyData} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                  <defs>
                    <linearGradient id="secGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={accent.hex} stopOpacity={0.4} />
                      <stop offset="100%" stopColor={accent.hex} stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.25} />
                  <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisTick} interval="preserveStartEnd" minTickGap={20} />
                  <YAxis axisLine={false} tickLine={false} tick={axisTick} tickFormatter={v => `${v}h`} />
                  <RTooltip content={<ChartTooltip unit="h" />} cursor={{ stroke: 'hsl(var(--border))' }} />
                  <Area type="monotone" dataKey="hours" stroke={accent.hex} strokeWidth={2} fill="url(#secGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Add member */}
      <Dialog open={addMemberOpen} onOpenChange={o => { setAddMemberOpen(o); if (!o) setAddMemberSearch(''); }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader><DialogTitle className="text-xl font-bold">Add Member</DialogTitle></DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3.5 py-2.5">
              <Search className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <input autoFocus value={addMemberSearch} onChange={e => setAddMemberSearch(e.target.value)} placeholder="Search people…"
                className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40" />
            </div>
            <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1">
              {nonMembers.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground/40 italic">Everyone is already on this project.</div>
              ) : (() => {
                const list = nonMembers
                  .filter(u => u.name.toLowerCase().includes(addMemberSearch.toLowerCase()))
                  .sort((a, b) => ((a.role === 'manager' ? 0 : 1) - (b.role === 'manager' ? 0 : 1)) || a.name.localeCompare(b.name));
                if (list.length === 0) return <div className="text-center py-8 text-sm text-muted-foreground/40 italic">No people match “{addMemberSearch}”.</div>;
                return list.map(u => (
                  <button key={u.id}
                    onClick={() => void addMemberToProject(project.id, u.id).then(() => toast.success(`${u.name} added!`)).catch(e => toast.error(e instanceof Error ? e.message : 'Could not add member'))}
                    className="w-full flex items-center gap-3 rounded-xl border border-border/35 bg-card hover:bg-primary/5 hover:border-primary/30 transition-all p-2.5 text-left group">
                    <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold truncate">{u.name}</span>
                        {u.role === 'manager' && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">Mgr</span>}
                      </div>
                      {u.email && <span className="text-[11px] text-muted-foreground/50 truncate block">{u.email}</span>}
                    </div>
                    <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg border opacity-0 group-hover:opacity-100 transition-opacity ${accent.pill}`}>
                      <Plus className="h-3 w-3" /> Add
                    </span>
                  </button>
                ));
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

// ── Small components ────────────────────────────────────────────────────────────
function ChartCard({ icon, title, subtitle, accent, children }: { icon: React.ReactNode; title: string; subtitle: string; accent: ReturnType<typeof projectAccent>; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/35 bg-card/40 p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className={accent.text}>{icon}</span>
        <h3 className="text-sm font-bold text-foreground">{title}</h3>
      </div>
      <p className="text-[11px] text-muted-foreground/50 mb-4">{subtitle}</p>
      {children}
    </div>
  );
}

function ChartEmpty({ msg }: { msg: string }) {
  return <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground/40 italic">{msg}</div>;
}

function MoveBtn({ dir, onClick, disabled, title }: { dir: 'left' | 'right'; onClick: () => void; disabled?: boolean; title: string }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title}
      className="p-1.5 rounded-lg border border-border/40 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 hover:text-primary text-muted-foreground/60 transition-all disabled:opacity-25 disabled:hover:bg-muted/30 disabled:hover:text-muted-foreground/60 disabled:hover:border-border/40 disabled:cursor-not-allowed">
      {dir === 'left' ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
    </button>
  );
}

function FilterChip({ active, onClick, label, count, accent }: { active: boolean; onClick: () => void; label: string; count: number; accent: ReturnType<typeof projectAccent> }) {
  return (
    <button onClick={onClick}
      className={`text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all ${active ? accent.pill : 'border-border/40 bg-muted/20 text-muted-foreground/60 hover:text-foreground hover:border-border/60'}`}>
      {label} <span className="opacity-60">{count}</span>
    </button>
  );
}

export default ProjectDetailPage;
