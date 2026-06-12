import { useAppStore } from '@/stores/appStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
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
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, BarChart3, TrendingUp } from 'lucide-react';
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
  }, [tab]);

  const activeRange = tab === 'summary' ? { start: rangeStart, end: rangeEnd } : trendBounds;

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
  }, [currentUser, selectedUserId, isManager, activeRange.start, activeRange.end]);

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

  const pieData = useMemo(
    () =>
      topProjects.map(p => ({
        name: p.name,
        value: p.seconds,
      })),
    [topProjects],
  );

  const rangeTitle =
    tab === 'summary'
      ? `${format(parseISO(rangeStart), 'MMM d, yyyy')} – ${format(parseISO(rangeEnd), 'MMM d, yyyy')}`
      : `${format(parseISO(trendBounds.start), 'MMM d, yyyy')} – ${format(parseISO(trendBounds.end), 'MMM d, yyyy')}`;

  const selectedUserName = users.find(u => u.id === selectedUserId)?.name ?? 'User';

  if (!currentUser) return null;

  return (
    <motion.div className="min-h-full bg-background" {...pageEnter}>
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
              <div className="flex items-center gap-2 min-w-[200px]">
                <span className="text-xs text-muted-foreground uppercase shrink-0">Person</span>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger className="h-9 w-[220px]">
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

            <div className="flex items-center gap-2 min-w-[200px]">
              <span className="text-xs text-muted-foreground uppercase shrink-0">Project</span>
              <Select value={projectFilter} onValueChange={setProjectFilter}>
                <SelectTrigger className="h-9 w-[220px]">
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
                <span className="text-xs text-muted-foreground">Hours · stacked by project</span>
              </div>
              <div className="h-[320px] w-full min-w-0">
                {topProjects.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                    No timesheet rows in this range — add entries on Timesheet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={0} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}h`} width={40} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number, name: string) => [`${value}h`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      {topProjects.map((p, i) => (
                        <Bar
                          key={p.projectId}
                          dataKey={p.projectId}
                          name={p.name}
                          stackId="day"
                          fill={zetStackColor(i)}
                          radius={i === topProjects.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
                <h2 className="text-sm font-semibold mb-2">By project</h2>
                <div className="relative h-[280px] w-full">
                  {pieData.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                      No project split yet
                    </div>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={pieData}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={68}
                            outerRadius={100}
                            paddingAngle={2}
                            stroke="hsl(var(--card))"
                            strokeWidth={2}
                          >
                            {pieData.map((_, i) => (
                              <Cell key={i} fill={zetStackColor(i)} />
                            ))}
                          </Pie>
                          <Tooltip
                            contentStyle={chartTooltipStyle}
                            formatter={(v: number) => formatHMS(v)}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
                        <div>
                          <p className="text-xs text-muted-foreground">Timesheet</p>
                          <p className="text-lg font-bold tabular-nums">{formatHMS(timesheetTotal)}</p>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm space-y-4">
                <h2 className="text-sm font-semibold">Project share</h2>
                <div className="space-y-4">
                  {topProjects.length === 0 && (
                    <p className="text-sm text-muted-foreground">No timesheet data in this range.</p>
                  )}
                  {topProjects.map((p, i) => {
                    const pct = timesheetTotal > 0 ? (p.seconds / timesheetTotal) * 100 : 0;
                    return (
                      <div key={p.projectId}>
                        <div className="flex justify-between text-sm mb-1 gap-4">
                          <span className="truncate font-medium">{p.name}</span>
                          <span className="tabular-nums text-muted-foreground shrink-0">
                            {formatHMS(p.seconds)} · {pct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: zetStackColor(i) }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="trend" className="mt-0 space-y-6 outline-none">
            <div className="rounded-xl border border-border/80 bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold">Hours over time · by project</h2>
                <span className="text-xs text-muted-foreground">Rolling 42 days</span>
              </div>
              <div className="h-[360px] w-full min-w-0">
                {topProjects.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg">
                    No timesheet data in this range — add entries on Timesheet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${v}h`} width={40} />
                      <Tooltip
                        contentStyle={chartTooltipStyle}
                        formatter={(value: number, name: string) => [`${value}h`, name]}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="top" align="right" />
                      {topProjects.map((p, i) => (
                        <Bar
                          key={p.projectId}
                          dataKey={p.projectId}
                          name={p.name}
                          stackId="day"
                          fill={zetStackColor(i)}
                          radius={i === topProjects.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                        />
                      ))}
                    </BarChart>
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
