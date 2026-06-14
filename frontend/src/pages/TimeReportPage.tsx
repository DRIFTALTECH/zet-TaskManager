import { useAppStore } from '@/stores/appStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp, FolderKanban, ChevronRight as ChevRight, ArrowLeft, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TimesheetWorkEntry } from '@/types';
import { pageEnter } from '@/lib/motion';
import { ZET, zetStackColor } from '@/lib/zet-charts';
import { cn } from '@/lib/utils';
import { subDays, format, eachDayOfInterval, parseISO, startOfWeek, endOfWeek, addWeeks } from 'date-fns';

function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatHMS(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function hoursApprox(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** Week containing `anchor` (Monday–Sunday ISO-ish via date-fns). */
function weekBounds(anchor: Date, weekOffset: number): { start: string; end: string; days: string[] } {
  const shifted = addWeeks(anchor, weekOffset);
  const startD = startOfWeek(shifted, { weekStartsOn: 1 });
  const endD = endOfWeek(shifted, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startD, end: endD }).map(localISODate);
  return { start: localISODate(startD), end: localISODate(endD), days };
}

const DAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const chartTooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
};

const TimeReportPage = () => {
  const currentUser = useAppStore(s => s.currentUser);
  const users = useAppStore(s => s.users);
  const projects = useAppStore(s => s.projects);
  const tasks = useAppStore(s => s.tasks);

  const [tab, setTab] = useState<'summary' | 'trend'>('summary');
  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Drill-down: project → section → entries
  const [drillProject, setDrillProject] = useState<string | null>(null);
  const [drillSection, setDrillSection] = useState<string | null>(null);

  const isManager = currentUser?.role === 'manager';

  useEffect(() => {
    if (currentUser && !selectedUserId) setSelectedUserId(currentUser.id);
  }, [currentUser, selectedUserId]);

  const { start: rangeStart, end: rangeEnd, days: weekDays } = useMemo(
    () => weekBounds(new Date(), weekOffset),
    [weekOffset],
  );

  const trendBounds = useMemo(() => {
    const end = new Date();
    const start = subDays(end, 41);
    return { start: localISODate(start), end: localISODate(end) };
  }, []);

  const activeRange = useMemo(
    () => (tab === 'summary' ? { start: rangeStart, end: rangeEnd } : trendBounds),
    [tab, rangeStart, rangeEnd, trendBounds],
  );

  const loadEntries = useCallback(async () => {
    if (!currentUser || !selectedUserId) return;
    setLoading(true);
    try {
      const { start, end } = activeRange;
      let list: TimesheetWorkEntry[];
      if (selectedUserId === currentUser.id) {
        list = await api.getTimesheetWorkEntries(start, end);
      } else if (isManager) {
        list = await api.getTimesheetWorkEntriesForUser(selectedUserId, start, end);
      } else {
        list = [];
      }
      setEntries(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load report');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser, selectedUserId, isManager, activeRange]);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const filteredEntries = useMemo(() => {
    if (projectFilter === 'all') return entries;
    return entries.filter(e => e.projectId === projectFilter);
  }, [entries, projectFilter]);

  const projectLabel = useCallback(
    (projectId: string) => projects.find(p => p.id === projectId)?.name ?? 'Project',
    [projects],
  );

  const timesheetTotal = useMemo(
    () => filteredEntries.reduce((a, e) => a + e.seconds, 0),
    [filteredEntries],
  );

  /** Per-project totals for donut / list */
  const projectTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of filteredEntries) {
      map.set(e.projectId, (map.get(e.projectId) ?? 0) + e.seconds);
    }
    return [...map.entries()]
      .map(([projectId, seconds]) => ({
        projectId,
        name: projectLabel(projectId),
        seconds,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [filteredEntries, projectLabel]);

  const topProjects = useMemo(() => {
    const rows = [...projectTotals];
    const top = rows.slice(0, 5);
    const rest = rows.slice(5);
    const otherSec = rest.reduce((a, r) => a + r.seconds, 0);
    if (otherSec > 0) {
      top.push({ projectId: '_other', name: 'Other projects', seconds: otherSec });
    }
    return top;
  }, [projectTotals]);

  const topProjectIds = useMemo(
    () => new Set(topProjects.filter(p => p.projectId !== '_other').map(p => p.projectId)),
    [topProjects],
  );

  const barData = useMemo(() => {
    const dayList = tab === 'summary' ? weekDays : eachDayOfInterval({
      start: parseISO(activeRange.start),
      end: parseISO(activeRange.end),
    }).map(localISODate);

    return dayList.map((iso, idx) => {
      const row: Record<string, string | number> = {
        key: iso,
        label:
          tab === 'summary'
            ? `${DAY_LABEL[idx] ?? ''}\n${format(parseISO(iso), 'MMM d')}`
            : format(parseISO(iso), 'MMM d'),
      };
      for (const p of topProjects) {
        const secs = filteredEntries
          .filter(
            e =>
              e.workDate === iso &&
              (p.projectId === '_other' ? !topProjectIds.has(e.projectId) : e.projectId === p.projectId),
          )
          .reduce((a, e) => a + e.seconds, 0);
        row[p.projectId] = Math.round((secs / 3600) * 100) / 100;
      }
      return row;
    });
  }, [
    tab,
    weekDays,
    activeRange.start,
    activeRange.end,
    topProjects,
    topProjectIds,
    filteredEntries,
  ]);

  // ── Drill-down derived data ──────────────────────────────────────────────
  const drillProjectName = useMemo(
    () => (drillProject ? projectLabel(drillProject) : ''),
    [drillProject, projectLabel],
  );

  const sectionTotals = useMemo(() => {
    if (!drillProject) return [] as { sectionId: string; name: string; seconds: number }[];
    const proj = projects.find(p => p.id === drillProject);
    const map = new Map<string, number>();
    for (const e of filteredEntries) {
      if (e.projectId !== drillProject) continue;
      map.set(e.sectionId, (map.get(e.sectionId) ?? 0) + e.seconds);
    }
    return [...map.entries()]
      .map(([sectionId, seconds]) => ({
        sectionId,
        name: proj?.sections.find(s => s.id === sectionId)?.name ?? 'No section',
        seconds,
      }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [filteredEntries, drillProject, projects]);

  const drillSectionName = useMemo(
    () => sectionTotals.find(s => s.sectionId === drillSection)?.name ?? '',
    [sectionTotals, drillSection],
  );

  const sectionEntries = useMemo(() => {
    if (!drillProject || !drillSection) return [] as TimesheetWorkEntry[];
    return filteredEntries
      .filter(e => e.projectId === drillProject && e.sectionId === drillSection)
      .sort((a, b) => a.workDate.localeCompare(b.workDate) || a.timeFrom.localeCompare(b.timeFrom));
  }, [filteredEntries, drillProject, drillSection]);

  // Reset drill-down whenever the data range / filter changes underneath it.
  useEffect(() => {
    setDrillProject(null);
    setDrillSection(null);
  }, [selectedUserId, projectFilter, weekOffset, tab]);

  const rangeTitle =
    tab === 'summary'
      ? `${format(parseISO(rangeStart), 'MMM d, yyyy')} – ${format(parseISO(rangeEnd), 'MMM d, yyyy')}`
      : `${format(parseISO(trendBounds.start), 'MMM d, yyyy')} – ${format(parseISO(trendBounds.end), 'MMM d, yyyy')}`;

  const selectedUserName = users.find(u => u.id === selectedUserId)?.name ?? 'User';

  if (!currentUser) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full bg-background"
    >
      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={tab} onValueChange={v => setTab(v as 'summary' | 'trend')} className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.2em] text-muted-foreground uppercase mb-1">ZET · Time report</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Timesheet hours logged per week · broken down by project
            </p>
          </div>

          <TabsList className="grid w-full grid-cols-2 sm:w-auto h-auto">
            <TabsTrigger value="summary" className="gap-1.5">
              <BarChart3 className="size-4" />
              Summary
            </TabsTrigger>
            <TabsTrigger value="trend" className="gap-1.5">
              <TrendingUp className="size-4" />
              Trend
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Toolbar */}
        <div className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:justify-between rounded-xl border border-border/80 bg-card/50 p-4">
          <div className="flex flex-wrap items-center gap-3">
            {tab === 'summary' && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="shrink-0" onClick={() => setWeekOffset(w => w - 1)}>
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="text-sm font-medium tabular-nums px-2 min-w-[200px] text-center">{rangeTitle}</span>
                <Button variant="outline" size="icon" className="shrink-0" onClick={() => setWeekOffset(w => w + 1)}>
                  <ChevronRight className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={() => setWeekOffset(0)}>
                  This week
                </Button>
              </div>
            )}
            {tab === 'trend' && (
              <span className="text-sm font-medium text-muted-foreground">Rolling 42 days · {rangeTitle}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {isManager && (
              <div className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[200px]">
                <span className="text-xs text-muted-foreground uppercase shrink-0">Person</span>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="h-9 w-full sm:w-[220px]">
                    <SelectValue placeholder="User" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map(u => (
                      <SelectItem key={u.id} value={u.id}>
                        {`${u.name} (${u.role})`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-2 w-full sm:w-auto sm:min-w-[200px]">
              <span className="text-xs text-muted-foreground uppercase shrink-0">Project</span>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-9 w-full sm:w-[220px]">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All projects</SelectItem>
                  {projects.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {loading && <span className="text-xs text-muted-foreground">Loading…</span>}
          </div>
        </div>

        {/* Totals */}
        <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm flex items-center gap-6">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {tab === 'summary' ? 'This week · Timesheet' : 'Period · Timesheet'}
            </p>
            <p className="text-3xl font-bold tabular-nums mt-1" style={{ color: ZET.indigo }}>
              {formatHMS(timesheetTotal)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">{hoursApprox(timesheetTotal)} h logged · {selectedUserName}</p>
          </div>
        </div>

          <TabsContent value="summary" className="mt-0 space-y-6 outline-none">
            <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">Daily breakdown</h2>
                <span className="text-xs text-muted-foreground">Hours · per project</span>
              </div>
              <div className="h-[320px] w-full min-w-0">
                {topProjects.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                    No timesheet rows in this range — add entries on Timesheet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        {topProjects.map((p, i) => (
                          <linearGradient key={p.projectId} id={`area-${p.projectId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={zetStackColor(i)} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={zetStackColor(i)} stopOpacity={0.04} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}h`} width={40} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number, name: string) => [`${value}h`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {topProjects.map((p, i) => (
                        <Area
                          key={p.projectId}
                          type="monotone"
                          dataKey={p.projectId}
                          name={p.name}
                          stroke={zetStackColor(i)}
                          strokeWidth={2}
                          fill={`url(#area-${p.projectId})`}
                          fillOpacity={0.85}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* ── Explore: project → section → entries ─────────────────── */}
            <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
              {/* Breadcrumb */}
              <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm min-w-0">
                  {drillProject && (
                    <button
                      type="button"
                      onClick={() => (drillSection ? setDrillSection(null) : setDrillProject(null))}
                      className="mr-1 inline-flex items-center justify-center rounded-md border border-border/70 p-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                      aria-label="Back"
                    >
                      <ArrowLeft className="size-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setDrillProject(null); setDrillSection(null); }}
                    className={drillProject ? 'text-muted-foreground hover:text-foreground transition-colors' : 'font-semibold text-foreground'}
                  >
                    Projects
                  </button>
                  {drillProject && (
                    <>
                      <ChevRight className="size-3.5 text-muted-foreground/50 shrink-0" />
                      <button
                        type="button"
                        onClick={() => setDrillSection(null)}
                        className={cn('truncate', drillSection ? 'text-muted-foreground hover:text-foreground transition-colors' : 'font-semibold text-foreground')}
                      >
                        {drillProjectName}
                      </button>
                    </>
                  )}
                  {drillSection && (
                    <>
                      <ChevRight className="size-3.5 text-muted-foreground/50 shrink-0" />
                      <span className="truncate font-semibold text-foreground">{drillSectionName}</span>
                    </>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {!drillProject ? 'Click a project to explore'
                    : !drillSection ? 'Click a section to see what you did'
                    : `${sectionEntries.length} ${sectionEntries.length === 1 ? 'entry' : 'entries'}`}
                </span>
              </div>

              <AnimatePresence mode="wait">
                {/* Level 1 — projects */}
                {!drillProject && (
                  <motion.div key="lvl-projects"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={pageEnter}
                  >
                    {projectTotals.length === 0 ? (
                      <div className="h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                        No timesheet data in this range.
                      </div>
                    ) : (
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {projectTotals.map((p, i) => {
                          const pct = timesheetTotal > 0 ? (p.seconds / timesheetTotal) * 100 : 0;
                          return (
                            <button
                              key={p.projectId}
                              type="button"
                              onClick={() => { setDrillProject(p.projectId); setDrillSection(null); }}
                              className="group text-left rounded-xl border border-border/70 bg-muted/10 p-4 hover:border-border hover:bg-muted/30 transition-all"
                            >
                              <div className="flex items-center gap-3">
                                <span className="flex size-9 items-center justify-center rounded-lg" style={{ backgroundColor: `${zetStackColor(i)}1a` }}>
                                  <FolderKanban className="size-4" style={{ color: zetStackColor(i) }} />
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-foreground">{p.name}</p>
                                  <p className="text-xs text-muted-foreground tabular-nums">{formatHMS(p.seconds)} · {pct.toFixed(0)}%</p>
                                </div>
                                <ChevRight className="size-4 text-muted-foreground/40 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                              </div>
                              <div className="mt-3 h-1.5 rounded-full bg-muted overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: zetStackColor(i) }} />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                )}

                {/* Level 2 — sections (pie) */}
                {drillProject && !drillSection && (
                  <motion.div key="lvl-sections"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={pageEnter}
                    className="grid gap-6 lg:grid-cols-2"
                  >
                    {sectionTotals.length === 0 ? (
                      <div className="lg:col-span-2 h-[200px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                        No sections logged for this project in range.
                      </div>
                    ) : (
                      <>
                        <div className="relative h-[260px] w-full">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie
                                data={sectionTotals.map(s => ({ name: s.name, value: s.seconds, sectionId: s.sectionId }))}
                                dataKey="value"
                                nameKey="name"
                                innerRadius={64}
                                outerRadius={98}
                                paddingAngle={2}
                                stroke="hsl(var(--card))"
                                strokeWidth={2}
                                onClick={(d: { sectionId?: string }) => d?.sectionId && setDrillSection(d.sectionId)}
                              >
                                {sectionTotals.map((_, i) => (
                                  <Cell key={i} fill={zetStackColor(i)} className="cursor-pointer outline-none" />
                                ))}
                              </Pie>
                              <Tooltip contentStyle={chartTooltipStyle} formatter={(v: number) => formatHMS(v)} />
                            </PieChart>
                          </ResponsiveContainer>
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
                            <div>
                              <p className="text-xs text-muted-foreground">Sections</p>
                              <p className="text-lg font-bold tabular-nums">{sectionTotals.length}</p>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2 self-center">
                          {sectionTotals.map((s, i) => {
                            const projSec = filteredEntries
                              .filter(e => e.projectId === drillProject)
                              .reduce((a, e) => a + e.seconds, 0);
                            const pct = projSec > 0 ? (s.seconds / projSec) * 100 : 0;
                            return (
                              <button
                                key={s.sectionId}
                                type="button"
                                onClick={() => setDrillSection(s.sectionId)}
                                className="group flex w-full items-center gap-3 rounded-lg border border-border/60 bg-muted/10 px-3 py-2 hover:border-border hover:bg-muted/30 transition-all"
                              >
                                <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: zetStackColor(i) }} />
                                <span className="truncate text-sm font-medium text-foreground flex-1 text-left">{s.name}</span>
                                <span className="text-xs tabular-nums text-muted-foreground shrink-0">{formatHMS(s.seconds)} · {pct.toFixed(0)}%</span>
                                <ChevRight className="size-4 text-muted-foreground/40 group-hover:text-foreground transition-colors" />
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </motion.div>
                )}

                {/* Level 3 — entries in section */}
                {drillProject && drillSection && (
                  <motion.div key="lvl-entries"
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    transition={pageEnter}
                    className="space-y-2"
                  >
                    {sectionEntries.length === 0 ? (
                      <div className="h-[160px] flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                        No entries in this section.
                      </div>
                    ) : (
                      <ul className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                        {sectionEntries.map(e => (
                          <li key={e.id} className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-muted/10 px-4 py-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground break-words">
                                {e.description?.trim() || <span className="italic text-muted-foreground/50">No description</span>}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span className="font-mono">{format(parseISO(e.workDate), 'EEE, MMM d')}</span>
                                <span className="inline-flex items-center gap-1 font-mono">
                                  <Clock className="size-3" />{e.timeFrom}–{e.timeTo}
                                </span>
                              </div>
                            </div>
                            <span className="text-sm font-bold font-mono tabular-nums shrink-0 text-foreground/80">
                              {formatHMS(e.seconds)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </TabsContent>

          <TabsContent value="trend" className="mt-0 space-y-6 outline-none">
            <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">Hours over time · by project</h2>
                <span className="text-xs text-muted-foreground">Rolling 42 days · per project</span>
              </div>
              <div className="h-[360px] w-full min-w-0">
                {topProjects.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                    No timesheet data in this range — add entries on Timesheet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={barData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <defs>
                        {topProjects.map((p, i) => (
                          <linearGradient key={p.projectId} id={`area-trend-${p.projectId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={zetStackColor(i)} stopOpacity={0.45} />
                            <stop offset="100%" stopColor={zetStackColor(i)} stopOpacity={0.04} />
                          </linearGradient>
                        ))}
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}h`} width={40} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number, name: string) => [`${value}h`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="right" />
                      {topProjects.map((p, i) => (
                        <Area
                          key={p.projectId}
                          type="monotone"
                          dataKey={p.projectId}
                          name={p.name}
                          stroke={zetStackColor(i)}
                          strokeWidth={2}
                          fill={`url(#area-trend-${p.projectId})`}
                          fillOpacity={0.85}
                          activeDot={{ r: 4 }}
                        />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </motion.div>
  );
};

export default TimeReportPage;
