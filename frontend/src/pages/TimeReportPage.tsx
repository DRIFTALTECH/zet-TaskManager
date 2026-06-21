/**
 * ReportsPage — Clockify-style reporting over timesheet data.
 * Three views: Summary (chart + breakdown + donut), Detailed (entry table),
 * Weekly (project/user × day matrix). Filters: Team · Project · Section ·
 * Billable · Description. Export to PDF (print) or CSV. Live client-side filtering.
 */
import { useAppStore } from '@/stores/appStore';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, BarChart3, ListChecks, CalendarRange, Download,
  FileText, Search, ChevronDown, ChevronRight as ChevRight, Clock, FolderKanban,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TimesheetWorkEntry } from '@/types';
import { pageEnter } from '@/lib/motion';
import { ZET, zetStackColor } from '@/lib/zet-charts';
import { cn } from '@/lib/utils';
import { downloadCSV, openPrintWindow, printTable } from '@/lib/report-export';
import {
  subDays, addDays, addWeeks, addMonths, format, parseISO,
  eachDayOfInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth,
} from 'date-fns';
import type { DateRange } from 'react-day-picker';

// ── time helpers ────────────────────────────────────────────────────────────
const iso = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};
const fmtHMS = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
};
const hoursDec = (s: number) => Math.round((s / 3600) * 100) / 100;

type Tab = 'summary' | 'detailed' | 'weekly';
type Preset = 'today' | 'week' | 'month' | 'last30' | 'custom';
type GroupBy = 'project' | 'section' | 'user' | 'billable';
type WeeklyBy = 'project' | 'user';
type Billable = 'all' | 'billable' | 'nonbillable';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function presetRange(preset: Preset, off: number, custom: DateRange | undefined): { start: string; end: string; label: string } {
  const today = new Date();
  if (preset === 'today') {
    const d = addDays(today, off);
    return { start: iso(d), end: iso(d), label: format(d, 'EEE, MMM d, yyyy') };
  }
  if (preset === 'month') {
    const base = addMonths(today, off);
    return { start: iso(startOfMonth(base)), end: iso(endOfMonth(base)), label: format(base, 'MMMM yyyy') };
  }
  if (preset === 'last30') {
    const end = addDays(today, off * 30);
    const start = subDays(end, 29);
    return { start: iso(start), end: iso(end), label: `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}` };
  }
  if (preset === 'custom' && custom?.from) {
    const f = custom.from, t = custom.to ?? custom.from;
    return { start: iso(f), end: iso(t), label: `${format(f, 'MMM d')} – ${format(t, 'MMM d, yyyy')}` };
  }
  // week (default)
  const base = addWeeks(today, off);
  const s = startOfWeek(base, { weekStartsOn: 1 }), e = endOfWeek(base, { weekStartsOn: 1 });
  return { start: iso(s), end: iso(e), label: `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}` };
}

function weekRange(off: number): { start: string; end: string; label: string; days: string[] } {
  const base = addWeeks(new Date(), off);
  const s = startOfWeek(base, { weekStartsOn: 1 }), e = endOfWeek(base, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: s, end: e }).map(iso);
  return { start: iso(s), end: iso(e), label: `${format(s, 'MMM d')} – ${format(e, 'MMM d, yyyy')}`, days };
}

const tooltipStyle = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '10px',
  fontSize: '12px',
  color: 'hsl(var(--foreground))',
};

const ReportsPage = () => {
  const currentUser = useAppStore(s => s.currentUser);
  const users = useAppStore(s => s.users);
  const projects = useAppStore(s => s.projects);
  const navigate = useNavigate();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'admin';

  const [tab, setTab] = useState<Tab>('summary');
  const [preset, setPreset] = useState<Preset>('week');
  const [presetOff, setPresetOff] = useState(0);
  const [custom, setCustom] = useState<DateRange | undefined>();
  const [weekOff, setWeekOff] = useState(0);

  const [team, setTeam] = useState<string>(isManager ? 'all' : 'me');
  const [projectFilter, setProjectFilter] = useState('all');
  const [sectionFilter, setSectionFilter] = useState('all');
  const [billable, setBillable] = useState<Billable>('all');
  const [query, setQuery] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [weeklyBy, setWeeklyBy] = useState<WeeklyBy>('project');

  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // ── name / color maps ──────────────────────────────────────────────────────
  const projectName = useCallback((id: string) => projects.find(p => p.id === id)?.name ?? 'No project', [projects]);
  const userName = useCallback((id: string) => users.find(u => u.id === id)?.name ?? 'Unknown', [users]);
  const sectionNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) for (const s of p.sections) m.set(s.id, s.name);
    return m;
  }, [projects]);
  const sectionName = useCallback((id: string) => sectionNameMap.get(id) ?? 'No section', [sectionNameMap]);

  // ── active range ───────────────────────────────────────────────────────────
  const range = useMemo(() => {
    if (tab === 'weekly') return weekRange(weekOff);
    return presetRange(preset, presetOff, custom);
  }, [tab, weekOff, preset, presetOff, custom]);

  // ── fetch ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const { start, end } = range;
      let list: TimesheetWorkEntry[];
      if (team === 'me' || !isManager) list = await api.getTimesheetWorkEntries(start, end);
      else if (team === 'all') list = await api.getTeamTimesheetEntries(start, end);
      else list = await api.getTimesheetWorkEntriesForUser(team, start, end);
      setEntries(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load reports');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser, isManager, team, range]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setExpanded(new Set()); }, [tab, weeklyBy, team, range]);

  // ── filtering (live) ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter(e =>
      (projectFilter === 'all' || e.projectId === projectFilter) &&
      (sectionFilter === 'all' || e.sectionId === sectionFilter) &&
      (billable === 'all' || (billable === 'billable' ? e.billable : !e.billable)) &&
      (!q || e.description.toLowerCase().includes(q)),
    );
  }, [entries, projectFilter, sectionFilter, billable, query]);

  const total = useMemo(() => filtered.reduce((a, e) => a + e.seconds, 0), [filtered]);
  const billableSec = useMemo(() => filtered.filter(e => e.billable).reduce((a, e) => a + e.seconds, 0), [filtered]);

  // ── grouping for Summary ───────────────────────────────────────────────────
  const groupKey = useCallback((e: TimesheetWorkEntry) => {
    if (groupBy === 'project') return e.projectId;
    if (groupBy === 'section') return e.sectionId;
    if (groupBy === 'user') return e.userId;
    return e.billable ? '_billable' : '_nonbillable';
  }, [groupBy]);
  const groupLabel = useCallback((key: string) => {
    if (key === '_billable') return 'Billable';
    if (key === '_nonbillable') return 'Non-billable';
    if (key === '_other') return 'Other';
    if (groupBy === 'project') return projectName(key);
    if (groupBy === 'section') return sectionName(key);
    if (groupBy === 'user') return userName(key);
    return key;
  }, [groupBy, projectName, sectionName, userName]);

  const groupTotals = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of filtered) m.set(groupKey(e), (m.get(groupKey(e)) ?? 0) + e.seconds);
    return [...m.entries()].map(([key, seconds]) => ({ key, name: groupLabel(key), seconds }))
      .sort((a, b) => b.seconds - a.seconds);
  }, [filtered, groupKey, groupLabel]);

  const topGroups = useMemo(() => {
    const top = groupTotals.slice(0, 6);
    const rest = groupTotals.slice(6);
    const other = rest.reduce((a, r) => a + r.seconds, 0);
    if (other > 0) top.push({ key: '_other', name: 'Other', seconds: other });
    return top;
  }, [groupTotals]);
  const topKeys = useMemo(() => new Set(topGroups.filter(g => g.key !== '_other').map(g => g.key)), [topGroups]);

  const chartDays = useMemo(
    () => eachDayOfInterval({ start: parseISO(range.start), end: parseISO(range.end) }).map(iso),
    [range.start, range.end],
  );
  const barData = useMemo(() => chartDays.map(d => {
    const row: Record<string, string | number> = { label: format(parseISO(d), chartDays.length > 10 ? 'MMM d' : 'EEE d') };
    for (const g of topGroups) {
      const secs = filtered.filter(e =>
        e.workDate === d && (g.key === '_other' ? !topKeys.has(groupKey(e)) : groupKey(e) === g.key),
      ).reduce((a, e) => a + e.seconds, 0);
      row[g.key] = hoursDec(secs);
    }
    return row;
  }), [chartDays, topGroups, topKeys, filtered, groupKey]);

  // ── Weekly matrix ──────────────────────────────────────────────────────────
  const weekDays = useMemo(() => (tab === 'weekly' ? weekRange(weekOff).days : []), [tab, weekOff]);
  const primaryKey = useCallback((e: TimesheetWorkEntry) => (weeklyBy === 'project' ? e.projectId : e.userId), [weeklyBy]);
  const secondaryKey = useCallback((e: TimesheetWorkEntry) => (weeklyBy === 'project' ? e.userId : e.projectId), [weeklyBy]);
  const primaryLabel = useCallback((k: string) => (weeklyBy === 'project' ? projectName(k) : userName(k)), [weeklyBy, projectName, userName]);
  const secondaryLabel = useCallback((k: string) => (weeklyBy === 'project' ? userName(k) : projectName(k)), [weeklyBy, userName, projectName]);

  const weekly = useMemo(() => {
    const groups = new Map<string, { total: number; days: Record<string, number>; subs: Map<string, { total: number; days: Record<string, number> }> }>();
    for (const e of filtered) {
      const pk = primaryKey(e), sk = secondaryKey(e);
      let g = groups.get(pk);
      if (!g) { g = { total: 0, days: {}, subs: new Map() }; groups.set(pk, g); }
      g.total += e.seconds; g.days[e.workDate] = (g.days[e.workDate] ?? 0) + e.seconds;
      let sub = g.subs.get(sk);
      if (!sub) { sub = { total: 0, days: {} }; g.subs.set(sk, sub); }
      sub.total += e.seconds; sub.days[e.workDate] = (sub.days[e.workDate] ?? 0) + e.seconds;
    }
    return [...groups.entries()].map(([key, g]) => ({ key, ...g })).sort((a, b) => b.total - a.total);
  }, [filtered, primaryKey, secondaryKey]);

  const colTotals = useMemo(() => weekDays.map(d => filtered.filter(e => e.workDate === d).reduce((a, e) => a + e.seconds, 0)), [weekDays, filtered]);

  // ── Detailed (sorted) ──────────────────────────────────────────────────────
  const detailed = useMemo(
    () => [...filtered].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.timeFrom.localeCompare(a.timeFrom)),
    [filtered],
  );

  // ── exports ────────────────────────────────────────────────────────────────
  const rangeLabel = range.label;
  const doStep = (dir: -1 | 1) => (tab === 'weekly' ? setWeekOff(w => w + dir) : setPresetOff(o => o + dir));
  const resetStep = () => (tab === 'weekly' ? setWeekOff(0) : setPresetOff(0));

  const exportCSV = () => {
    if (tab === 'summary') {
      downloadCSV(`reports-summary_${range.start}_${range.end}`,
        [groupBy === 'user' ? 'User' : groupBy === 'section' ? 'Section' : groupBy === 'billable' ? 'Billability' : 'Project', 'Duration', 'Hours', '%'],
        groupTotals.map(g => [g.name, fmtHMS(g.seconds), hoursDec(g.seconds), `${total ? Math.round((g.seconds / total) * 100) : 0}%`]));
    } else if (tab === 'detailed') {
      downloadCSV(`reports-detailed_${range.start}_${range.end}`,
        ['Description', 'Project', 'Section', 'User', 'Date', 'From', 'To', 'Duration', 'Billable'],
        detailed.map(e => [e.description || '—', projectName(e.projectId), sectionName(e.sectionId), userName(e.userId), e.workDate, e.timeFrom, e.timeTo, fmtHMS(e.seconds), e.billable ? 'Yes' : 'No']));
    } else {
      downloadCSV(`reports-weekly_${range.start}_${range.end}`,
        [weeklyBy === 'project' ? 'Project' : 'User', ...weekDays.map(d => format(parseISO(d), 'EEE MMM d')), 'Total'],
        weekly.map(g => [primaryLabel(g.key), ...weekDays.map(d => g.days[d] ? fmtHMS(g.days[d]) : '—'), fmtHMS(g.total)]));
    }
    toast.success('CSV exported');
  };

  const exportPDF = () => {
    try {
      let sections: string[] = [];
      if (tab === 'summary') {
        sections = [printTable(
          [{ label: groupBy === 'user' ? 'User' : groupBy === 'section' ? 'Section' : groupBy === 'billable' ? 'Billability' : 'Project' }, { label: 'Duration', align: 'right' }, { label: '%', align: 'right' }],
          groupTotals.map(g => [g.name, fmtHMS(g.seconds), `${total ? Math.round((g.seconds / total) * 100) : 0}%`]),
          ['Total', fmtHMS(total), '100%'],
        )];
      } else if (tab === 'detailed') {
        sections = [printTable(
          [{ label: 'Description' }, { label: 'Project · Section' }, { label: 'User' }, { label: 'Date' }, { label: 'Time' }, { label: 'Duration', align: 'right' }],
          detailed.map(e => [e.description || '—', `${projectName(e.projectId)} · ${sectionName(e.sectionId)}`, userName(e.userId), format(parseISO(e.workDate), 'EEE, MMM d'), `${e.timeFrom}–${e.timeTo}`, fmtHMS(e.seconds)]),
        )];
      } else {
        sections = [printTable(
          [{ label: weeklyBy === 'project' ? 'Project' : 'User' }, ...weekDays.map(d => ({ label: format(parseISO(d), 'EEE d'), align: 'right' as const })), { label: 'Total', align: 'right' as const }],
          weekly.map(g => [primaryLabel(g.key), ...weekDays.map(d => g.days[d] ? fmtHMS(g.days[d]) : '—'), fmtHMS(g.total)]),
          ['Total', ...colTotals.map(c => fmtHMS(c)), fmtHMS(total)],
        )];
      }
      openPrintWindow({ title: `Reports — ${tab[0].toUpperCase()}${tab.slice(1)}`, subtitle: rangeLabel, total: fmtHMS(total), sections });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not open print view');
    }
  };

  const sectionsForFilter = useMemo(
    () => (projectFilter === 'all' ? [] : projects.find(p => p.id === projectFilter)?.sections ?? []),
    [projectFilter, projects],
  );
  useEffect(() => { setSectionFilter('all'); }, [projectFilter]);

  if (!currentUser) return null;

  const toggle = (k: string) => setExpanded(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="min-h-full">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6 space-y-5">

        {/* Header row: tabs + range + export */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
            <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
              <TabsList className="h-9">
                <TabsTrigger value="summary" className="gap-1.5 text-xs"><BarChart3 className="size-3.5" /> Summary</TabsTrigger>
                <TabsTrigger value="detailed" className="gap-1.5 text-xs"><ListChecks className="size-3.5" /> Detailed</TabsTrigger>
                <TabsTrigger value="weekly" className="gap-1.5 text-xs"><CalendarRange className="size-3.5" /> Weekly</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Range control */}
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 p-1">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => doStep(-1)}><ChevronLeft className="size-4" /></Button>
              {tab === 'weekly' ? (
                <span className="text-xs font-semibold tabular-nums px-2 min-w-[170px] text-center">{rangeLabel}</span>
              ) : (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-xs font-semibold tabular-nums px-2 min-w-[170px] text-center hover:text-primary transition-colors">{rangeLabel}</button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="center">
                    <div className="flex flex-col p-2 gap-1 border-b border-border/50">
                      {([['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['last30', 'Last 30 days']] as [Preset, string][]).map(([p, lbl]) => (
                        <button key={p} onClick={() => { setPreset(p); setPresetOff(0); }}
                          className={cn('text-left text-xs px-3 py-1.5 rounded-lg hover:bg-muted transition-colors', preset === p && 'bg-muted font-semibold')}>{lbl}</button>
                      ))}
                    </div>
                    <Calendar mode="range" selected={custom} onSelect={r => { setCustom(r); if (r?.from) setPreset('custom'); }} numberOfMonths={1} />
                  </PopoverContent>
                </Popover>
              )}
              <Button variant="ghost" size="icon" className="size-7" onClick={() => doStep(1)}><ChevronRight className="size-4" /></Button>
              <Button variant="ghost" size="sm" className="text-[11px] h-7 px-2" onClick={resetStep}>{tab === 'weekly' ? 'This week' : 'Now'}</Button>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs"><Download className="size-3.5" /> Export</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportPDF}><FileText className="size-3.5 mr-2" /> Export PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV}><Download className="size-3.5 mr-2" /> Export CSV</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-card/50 p-2.5">
          {isManager && (
            <Select value={team} onValueChange={setTeam}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All team</SelectItem>
                <SelectItem value="me">Me</SelectItem>
                {users.filter(u => u.id !== currentUser.id).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={sectionFilter} onValueChange={setSectionFilter} disabled={projectFilter === 'all'}>
            <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs"><SelectValue placeholder="Section" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {sectionsForFilter.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={billable} onValueChange={v => setBillable(v as Billable)}>
            <SelectTrigger className="h-8 w-auto min-w-[110px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="billable">Billable</SelectItem>
              <SelectItem value="nonbillable">Non-billable</SelectItem>
            </SelectContent>
          </Select>
          <div className="relative flex-1 min-w-[160px]">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search description…" className="h-8 pl-8 text-xs" />
          </div>
          {tab === 'summary' && (
            <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="project">Group: Project</SelectItem>
                <SelectItem value="section">Group: Section</SelectItem>
                <SelectItem value="user">Group: User</SelectItem>
                <SelectItem value="billable">Group: Billability</SelectItem>
              </SelectContent>
            </Select>
          )}
          {tab === 'weekly' && (
            <Select value={weeklyBy} onValueChange={v => setWeeklyBy(v as WeeklyBy)}>
              <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="project">By Project</SelectItem>
                <SelectItem value="user">By User</SelectItem>
              </SelectContent>
            </Select>
          )}
          {loading && <span className="text-[11px] text-muted-foreground animate-pulse">Loading…</span>}
        </div>

        {/* KPI cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi label="Total" value={fmtHMS(total)} sub={`${hoursDec(total)} h`} color={ZET.indigo} />
          <Kpi label="Billable" value={fmtHMS(billableSec)} sub={`${total ? Math.round((billableSec / total) * 100) : 0}% of total`} color="#16a34a" />
          <Kpi label="Non-billable" value={fmtHMS(total - billableSec)} sub={`${total ? Math.round(((total - billableSec) / total) * 100) : 0}% of total`} color="#e11d48" />
          <Kpi label="Entries" value={String(filtered.length)} sub={`${rangeLabel}`} color={ZET.indigo} />
        </div>

        {/* ── SUMMARY ── */}
        {tab === 'summary' && (
          <div className="space-y-5">
            <Card title="Daily breakdown" right={`Hours · by ${groupBy}`}>
              <div className="h-[300px] w-full min-w-0">
                {topGroups.length === 0 ? <Empty /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" minTickGap={16} />
                      <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickFormatter={v => `${v}h`} width={42} />
                      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} formatter={(v: number, n: string) => [`${v}h`, n]} />
                      {topGroups.map((g, i) => (
                        <Bar key={g.key} dataKey={g.key} name={g.name} stackId="a" fill={zetStackColor(i)} radius={i === topGroups.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} maxBarSize={48} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <div className="grid gap-5 lg:grid-cols-2">
              <Card title="Distribution" right={`by ${groupBy}`}>
                <div className="relative h-[260px]">
                  {topGroups.length === 0 ? <Empty /> : (
                    <>
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie data={topGroups.map(g => ({ name: g.name, value: g.seconds }))} dataKey="value" nameKey="name" innerRadius={66} outerRadius={100} paddingAngle={2} stroke="hsl(var(--card))" strokeWidth={2}>
                            {topGroups.map((_, i) => <Cell key={i} fill={zetStackColor(i)} />)}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtHMS(v)} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-center">
                        <div><p className="text-[11px] text-muted-foreground">Total</p><p className="text-lg font-bold tabular-nums">{fmtHMS(total)}</p></div>
                      </div>
                    </>
                  )}
                </div>
              </Card>

              <Card title="Breakdown" right={`${groupTotals.length} groups`}>
                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {groupTotals.length === 0 ? <Empty /> : groupTotals.map((g, i) => {
                    const pct = total ? (g.seconds / total) * 100 : 0;
                    // Project groups are clickable for managers → open the project page.
                    const clickable = groupBy === 'project' && g.key !== '_other' && isManager;
                    return (
                      <div
                        key={g.key}
                        role={clickable ? 'button' : undefined}
                        tabIndex={clickable ? 0 : undefined}
                        onClick={clickable ? () => navigate(`/manage/${g.key}`) : undefined}
                        onKeyDown={clickable ? e => { if (e.key === 'Enter') navigate(`/manage/${g.key}`); } : undefined}
                        className={cn(
                          'rounded-lg border border-border/60 bg-muted/10 p-3',
                          clickable && 'cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors',
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: zetStackColor(i) }} />
                          <span className="truncate text-sm font-medium flex-1">{g.name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground shrink-0">{fmtHMS(g.seconds)} · {pct.toFixed(0)}%</span>
                          {clickable && <ChevRight className="size-3.5 text-muted-foreground/40 shrink-0" />}
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: zetStackColor(i) }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── DETAILED ── */}
        {tab === 'detailed' && (
          <Card title="Time entries" right={`${detailed.length} entries · ${fmtHMS(total)}`}>
            {detailed.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="text-left font-semibold py-2 px-2">Time entry</th>
                      <th className="text-left font-semibold py-2 px-2 hidden md:table-cell">User</th>
                      <th className="text-left font-semibold py-2 px-2 hidden sm:table-cell">Time</th>
                      <th className="text-right font-semibold py-2 px-2">Duration</th>
                      <th className="text-center font-semibold py-2 px-2 w-10">$</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailed.map(e => (
                      <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 px-2 max-w-[420px]">
                          <p className="font-medium truncate">{e.description || <span className="italic text-muted-foreground/50">No description</span>}</p>
                          <p className="text-xs text-muted-foreground truncate">{projectName(e.projectId)} · {sectionName(e.sectionId)}</p>
                        </td>
                        <td className="py-2.5 px-2 text-muted-foreground hidden md:table-cell">{userName(e.userId)}</td>
                        <td className="py-2.5 px-2 hidden sm:table-cell">
                          <span className="font-mono text-xs tabular-nums">{e.timeFrom}–{e.timeTo}</span>
                          <span className="block text-[11px] text-muted-foreground">{format(parseISO(e.workDate), 'dd/MM/yyyy')}</span>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono font-bold tabular-nums">{fmtHMS(e.seconds)}</td>
                        <td className="py-2.5 px-2 text-center"><span className={cn('text-base font-bold', e.billable ? 'text-green-500' : 'text-muted-foreground/30')}>$</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {/* ── WEEKLY ── */}
        {tab === 'weekly' && (
          <Card title="Weekly matrix" right={weeklyBy === 'project' ? 'Project × day' : 'User × day'}>
            {weekly.length === 0 ? <Empty /> : (
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                      <th className="text-left font-semibold py-2 px-2 min-w-[180px]">{weeklyBy === 'project' ? 'Project' : 'User'}</th>
                      {weekDays.map((d, i) => <th key={d} className="text-right font-semibold py-2 px-2 tabular-nums whitespace-nowrap">{DAY_LABELS[i]}<span className="block text-[10px] font-normal opacity-60">{format(parseISO(d), 'MMM d')}</span></th>)}
                      <th className="text-right font-semibold py-2 px-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {weekly.map((g, gi) => (
                      <Fragment key={g.key}>
                        <tr className="border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => toggle(g.key)}>
                          <td className="py-2.5 px-2">
                            <div className="flex items-center gap-2">
                              {expanded.has(g.key) ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevRight className="size-3.5 text-muted-foreground" />}
                              <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: zetStackColor(gi) }} />
                              <span className="font-semibold truncate">{primaryLabel(g.key)}</span>
                            </div>
                          </td>
                          {weekDays.map(d => <td key={d} className="py-2.5 px-2 text-right font-mono text-xs tabular-nums text-muted-foreground">{g.days[d] ? fmtHMS(g.days[d]) : '—'}</td>)}
                          <td className="py-2.5 px-2 text-right font-mono font-bold tabular-nums">{fmtHMS(g.total)}</td>
                        </tr>
                        {expanded.has(g.key) && [...g.subs.entries()].sort((a, b) => b[1].total - a[1].total).map(([sk, sub]) => (
                          <tr key={`${g.key}-${sk}`} className="border-b border-border/30 bg-muted/10">
                            <td className="py-2 px-2 pl-9 text-muted-foreground truncate">{secondaryLabel(sk)}</td>
                            {weekDays.map(d => <td key={d} className="py-2 px-2 text-right font-mono text-xs tabular-nums text-muted-foreground/70">{sub.days[d] ? fmtHMS(sub.days[d]) : '—'}</td>)}
                            <td className="py-2 px-2 text-right font-mono text-xs tabular-nums text-muted-foreground">{fmtHMS(sub.total)}</td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    <tr className="border-t-2 border-border font-bold">
                      <td className="py-2.5 px-2">Total</td>
                      {colTotals.map((c, i) => <td key={i} className="py-2.5 px-2 text-right font-mono tabular-nums">{fmtHMS(c)}</td>)}
                      <td className="py-2.5 px-2 text-right font-mono tabular-nums" style={{ color: ZET.indigo }}>{fmtHMS(total)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </motion.div>
  );
};

// ── small presentational helpers ──────────────────────────────────────────────
function Kpi({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1 truncate" style={{ color }}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1 truncate">{sub}</p>
    </div>
  );
}
function Card({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold flex items-center gap-2"><FolderKanban className="size-3.5 text-primary/60" />{title}</h2>
        {right && <span className="text-xs text-muted-foreground">{right}</span>}
      </div>
      {children}
    </div>
  );
}
function Empty() {
  return (
    <div className="h-full min-h-[160px] flex flex-col items-center justify-center text-sm text-muted-foreground border border-dashed border-border rounded-lg gap-2">
      <Clock className="size-7 opacity-30" />
      No time logged in this range — add entries on the Timesheet.
    </div>
  );
}

export default ReportsPage;
