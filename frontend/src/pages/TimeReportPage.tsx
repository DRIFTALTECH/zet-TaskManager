/**
 * ReportsPage — time reporting over timesheet data.
 * Views: Summary, Detailed, Weekly, Client Summary.
 * Filters match Manage/Audit: Employee + date (+ optional project / group-by).
 */
import { useAppStore } from '@/stores/appStore';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { motion } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, BarChart3, ListChecks, CalendarRange, Download,
  FileText, ChevronDown, ChevronRight as ChevRight, Clock, FolderKanban,
  User, ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import DateRangePicker from '@/components/DateRangePicker';
import { formatRangeLabel, resolveRange, type RangeSelection } from '@/lib/date-range';
import type { TimesheetWorkEntry } from '@/types';
import { pageEnter } from '@/lib/motion';
import { ZET, zetStackColor } from '@/lib/zet-charts';
import { cn } from '@/lib/utils';
import { downloadCSV, openPrintWindow, printTable, exportEmployeeReport, type EmployeeReportSummary } from '@/lib/report-export';
import { ClientSummaryPanel } from '@/components/analytics/ClientSummaryPanel';
import UserAvatar, { accentColor } from '@/components/UserAvatar';
import {
  addWeeks, format, parseISO,
  eachDayOfInterval, startOfWeek, endOfWeek,
} from 'date-fns';

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

type Tab = 'summary' | 'detailed' | 'weekly' | 'clients';
type GroupBy = 'project' | 'section' | 'user' | 'billable';
type WeeklyBy = 'project' | 'user';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

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
  const [searchParams] = useSearchParams();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';

  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab');
    if (t === 'clients') return 'clients';
    if (t === 'detailed') return 'detailed';
    if (t === 'weekly') return 'weekly';
    return 'summary';
  });
  const [selection, setSelection] = useState<RangeSelection>({ preset: 'week', offset: 0 });
  const [weekOff, setWeekOff] = useState(0);

  /** Single employee filter — mirrors Manage timesheets / Audit. */
  const [employeeFilter, setEmployeeFilter] = useState(isManager ? 'all' : (currentUser?.id ?? 'all'));
  const [projectFilter, setProjectFilter] = useState('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [weeklyBy, setWeeklyBy] = useState<WeeklyBy>('project');

  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const projectName = useCallback((id: string) => projects.find(p => p.id === id)?.name ?? 'No project', [projects]);
  const userName = useCallback((id: string) => users.find(u => u.id === id)?.name ?? 'Unknown', [users]);
  const userById = useCallback((id: string) => users.find(u => u.id === id), [users]);
  const sectionNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of projects) for (const s of p.sections) m.set(s.id, s.name);
    return m;
  }, [projects]);
  const sectionName = useCallback((id: string) => sectionNameMap.get(id) ?? 'No section', [sectionNameMap]);

  /** Stable color for a user id (falls back to key for special groups). */
  const colorForUser = useCallback((userId: string) => accentColor(userId), []);
  const colorForGroup = useCallback((key: string, index: number, byUser: boolean) => {
    if (key === '_other' || key === '_billable' || key === '_nonbillable') return zetStackColor(index);
    if (byUser) return colorForUser(key);
    return zetStackColor(index);
  }, [colorForUser]);

  const employeeOptions = useMemo(() => {
    if (!currentUser) return [];
    if (!isManager) return [currentUser];
    return [...users].filter(u => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name));
  }, [currentUser, isManager, users]);

  const selectedEmployee = useMemo(
    () => (employeeFilter === 'all' ? null : employeeOptions.find(u => u.id === employeeFilter) ?? null),
    [employeeOptions, employeeFilter],
  );

  useEffect(() => {
    if (currentUser && !isManager) setEmployeeFilter(currentUser.id);
  }, [currentUser, isManager]);

  const range = useMemo(() => {
    if (tab === 'weekly') return weekRange(weekOff);
    const r = resolveRange(selection);
    return { ...r, label: formatRangeLabel(r, selection.preset) };
  }, [tab, weekOff, selection]);

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const { start, end } = range;
      let list: TimesheetWorkEntry[];
      if (!isManager || employeeFilter === currentUser.id) {
        list = await api.getTimesheetWorkEntries(start, end);
      } else if (employeeFilter === 'all') {
        list = await api.getTeamTimesheetEntries(start, end);
      } else {
        list = await api.getTimesheetWorkEntriesForUser(employeeFilter, start, end);
      }
      setEntries(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load reports');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser, isManager, employeeFilter, range]);

  const timesheetEpoch = useAppStore(s => s.timesheetEpoch);
  useEffect(() => { void load(); }, [load, timesheetEpoch]);
  useEffect(() => { setExpanded(new Set()); }, [tab, weeklyBy, employeeFilter, projectFilter, range]);

  const filtered = useMemo(() => {
    return entries.filter(e =>
      (projectFilter === 'all' || e.projectId === projectFilter),
    );
  }, [entries, projectFilter]);

  const total = useMemo(() => filtered.reduce((a, e) => a + e.seconds, 0), [filtered]);
  const billableSec = useMemo(() => filtered.filter(e => e.billable).reduce((a, e) => a + e.seconds, 0), [filtered]);

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

  const detailed = useMemo(
    () => [...filtered].sort((a, b) => b.workDate.localeCompare(a.workDate) || b.timeFrom.localeCompare(a.timeFrom)),
    [filtered],
  );

  const rangeLabel = range.label;

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

  const buildDetailedExportRows = (rows: TimesheetWorkEntry[]) => {
    const header = ['Description', 'Project', 'Section', 'Date', 'From', 'To', 'Duration', 'Billable'];
    const data = rows.map(e => [
      e.description || '—',
      projectName(e.projectId),
      sectionName(e.sectionId),
      e.workDate,
      e.timeFrom,
      e.timeTo,
      fmtHMS(e.seconds),
      e.billable ? 'Yes' : 'No',
    ]);
    return { header, data };
  };

  const buildEmployeeSummary = (personEntries: TimesheetWorkEntry[], employeeName: string): EmployeeReportSummary => {
    const totSec = personEntries.reduce((a, e) => a + e.seconds, 0);
    const billSec = personEntries.filter(e => e.billable).reduce((a, e) => a + e.seconds, 0);
    return {
      employeeName,
      periodLabel: rangeLabel,
      periodStart: range.start,
      periodEnd: range.end,
      totalHours: fmtHMS(totSec),
      billableHours: fmtHMS(billSec),
      nonBillableHours: fmtHMS(totSec - billSec),
      entryCount: personEntries.length,
      projectCount: new Set(personEntries.map(e => e.projectId)).size,
    };
  };

  const exportCurrentEmployeeReport = () => {
    if (!selectedEmployee) return;
    const personEntries = [...filtered].sort(
      (a, b) => b.workDate.localeCompare(a.workDate) || b.timeFrom.localeCompare(a.timeFrom),
    );
    const { header, data } = buildDetailedExportRows(personEntries);
    try {
      exportEmployeeReport({
        format: 'excel',
        summary: buildEmployeeSummary(personEntries, selectedEmployee.name),
        detailHeader: header,
        detailRows: data,
      });
      toast.success('Employee report exported');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not export employee report');
    }
  };

  if (!currentUser) return null;

  const toggle = (k: string) => setExpanded(prev => {
    const n = new Set(prev);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });

  const groupByUser = groupBy === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full flex flex-col"
    >
      {/* Header — same chrome as Audit / Manage timesheets */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Time</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Reports
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              Summary, detailed entries, and weekly matrices for the selected period.
            </p>
          </div>

          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <Tabs value={tab} onValueChange={v => setTab(v as Tab)}>
              <TabsList className="h-9">
                <TabsTrigger value="summary" className="gap-1.5 text-xs"><BarChart3 className="size-3.5" /> Summary</TabsTrigger>
                <TabsTrigger value="detailed" className="gap-1.5 text-xs"><ListChecks className="size-3.5" /> Detailed</TabsTrigger>
                <TabsTrigger value="weekly" className="gap-1.5 text-xs"><CalendarRange className="size-3.5" /> Weekly</TabsTrigger>
                {isManager && (
                  <TabsTrigger value="clients" className="gap-1.5 text-xs"><FolderKanban className="size-3.5" /> Client Summary</TabsTrigger>
                )}
              </TabsList>
            </Tabs>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs rounded-xl">
                  <Download className="size-3.5" /> Export
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={exportPDF}><FileText className="size-3.5 mr-2" /> Export PDF</DropdownMenuItem>
                <DropdownMenuItem onClick={exportCSV}><Download className="size-3.5 mr-2" /> Export CSV</DropdownMenuItem>
                <DropdownMenuSeparator />
                {selectedEmployee ? (
                  <DropdownMenuItem onClick={exportCurrentEmployeeReport}>
                    <User className="size-3.5 mr-2" /> Export Current Employee Report
                  </DropdownMenuItem>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex w-full cursor-not-allowed">
                        <DropdownMenuItem disabled className="w-full opacity-50 pointer-events-none">
                          <User className="size-3.5 mr-2" /> Export Current Employee Report
                        </DropdownMenuItem>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="left">Select an employee to export their report.</TooltipContent>
                  </Tooltip>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Filter bar — Employee + date (+ project / view options) */}
        <div className="flex flex-wrap items-center gap-2 mt-5 rounded-xl border border-border/70 bg-card/50 p-2.5">
          {isManager ? (
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="h-8 w-auto min-w-[160px] text-xs">
                <SelectValue placeholder="Employee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employeeOptions.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    <span className="flex items-center gap-2">
                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: accentColor(u.id) }} />
                      {u.name}{u.id === currentUser.id ? ' (you)' : ''}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div className="flex items-center gap-2 h-8 px-2.5 rounded-lg border border-border/60 bg-muted/30 text-xs">
              <UserAvatar name={currentUser.name} avatar={currentUser.avatar} size="xs" />
              <span className="font-medium truncate max-w-[140px]">{currentUser.name}</span>
            </div>
          )}

          <Select value={projectFilter} onValueChange={setProjectFilter}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
              <SelectValue placeholder="Project" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All projects</SelectItem>
              {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>

          {tab === 'weekly' ? (
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-background/60 p-0.5">
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setWeekOff(w => w - 1)}>
                <ChevronLeft className="size-4" />
              </Button>
              <span className="text-xs font-semibold tabular-nums px-2 min-w-[150px] text-center">{rangeLabel}</span>
              <Button variant="ghost" size="icon" className="size-7" onClick={() => setWeekOff(w => w + 1)}>
                <ChevronRight className="size-4" />
              </Button>
              <Button variant="ghost" size="sm" className="text-[11px] h-7 px-2" onClick={() => setWeekOff(0)}>
                This week
              </Button>
            </div>
          ) : (
            <DateRangePicker
              value={selection}
              onChange={setSelection}
              allowedPresets={['day', 'week', 'lastweek', 'month', 'last30', 'custom']}
            />
          )}

          {tab === 'summary' && (
            <Select value={groupBy} onValueChange={v => setGroupBy(v as GroupBy)}>
              <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs ml-auto">
                <SelectValue />
              </SelectTrigger>
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
              <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs ml-auto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="project">By Project</SelectItem>
                <SelectItem value="user">By User</SelectItem>
              </SelectContent>
            </Select>
          )}
          {loading && <span className="text-[11px] text-muted-foreground animate-pulse">Loading…</span>}
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-8 space-y-5 max-w-[1400px] w-full mx-auto">
        {tab !== 'clients' && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Total" value={fmtHMS(total)} sub={`${hoursDec(total)} h`} color={ZET.indigo} />
            <Kpi label="Billable" value={fmtHMS(billableSec)} sub={`${total ? Math.round((billableSec / total) * 100) : 0}% of total`} color="#16a34a" />
            <Kpi label="Non-billable" value={fmtHMS(total - billableSec)} sub={`${total ? Math.round(((total - billableSec) / total) * 100) : 0}% of total`} color="#e11d48" />
            <Kpi label="Entries" value={String(filtered.length)} sub={rangeLabel} color={ZET.indigo} />
          </div>
        )}

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
                      <RechartsTooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted)/0.4)' }} formatter={(v: number, n: string) => [`${v}h`, n]} />
                      {topGroups.map((g, i) => (
                        <Bar
                          key={g.key}
                          dataKey={g.key}
                          name={g.name}
                          stackId="a"
                          fill={colorForGroup(g.key, i, groupByUser)}
                          radius={i === topGroups.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                          maxBarSize={48}
                        />
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
                            {topGroups.map((g, i) => <Cell key={g.key} fill={colorForGroup(g.key, i, groupByUser)} />)}
                          </Pie>
                          <RechartsTooltip contentStyle={tooltipStyle} formatter={(v: number) => fmtHMS(v)} />
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
                    const clickable = groupBy === 'project' && g.key !== '_other' && isManager;
                    const color = colorForGroup(g.key, i, groupByUser);
                    const person = groupByUser && g.key !== '_other' ? userById(g.key) : null;
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
                          {person ? (
                            <UserAvatar name={person.name} avatar={person.avatar} size="xs" />
                          ) : (
                            <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          )}
                          <span className="truncate text-sm font-medium flex-1">{g.name}</span>
                          <span className="text-xs tabular-nums text-muted-foreground shrink-0">{fmtHMS(g.seconds)} · {pct.toFixed(0)}%</span>
                          {clickable && <ChevRight className="size-3.5 text-muted-foreground/40 shrink-0" />}
                        </div>
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
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
                    {detailed.map(e => {
                      const person = userById(e.userId);
                      return (
                        <tr key={e.id} className="border-b border-border/40 hover:bg-muted/30 transition-colors">
                          <td className="py-2.5 px-2 max-w-[420px]">
                            <p className="font-medium truncate">{e.description || <span className="italic text-muted-foreground/50">No description</span>}</p>
                            <p className="text-xs text-muted-foreground truncate">{projectName(e.projectId)} · {sectionName(e.sectionId)}</p>
                          </td>
                          <td className="py-2.5 px-2 hidden md:table-cell">
                            <div className="flex items-center gap-2 min-w-0">
                              <UserAvatar name={person?.name ?? userName(e.userId)} avatar={person?.avatar} size="xs" />
                              <span className="truncate text-muted-foreground">{userName(e.userId)}</span>
                            </div>
                          </td>
                          <td className="py-2.5 px-2 hidden sm:table-cell">
                            <span className="font-mono text-xs tabular-nums">{e.timeFrom}–{e.timeTo}</span>
                            <span className="block text-[11px] text-muted-foreground">{format(parseISO(e.workDate), 'dd/MM/yyyy')}</span>
                          </td>
                          <td className="py-2.5 px-2 text-right font-mono font-bold tabular-nums">{fmtHMS(e.seconds)}</td>
                          <td className="py-2.5 px-2 text-center"><span className={cn('text-base font-bold', e.billable ? 'text-green-500' : 'text-muted-foreground/30')}>$</span></td>
                        </tr>
                      );
                    })}
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
                    {weekly.map((g, gi) => {
                      const primaryPerson = weeklyBy === 'user' ? userById(g.key) : null;
                      const primaryColor = weeklyBy === 'user' ? colorForUser(g.key) : zetStackColor(gi);
                      return (
                        <Fragment key={g.key}>
                          <tr className="border-b border-border/40 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => toggle(g.key)}>
                            <td className="py-2.5 px-2">
                              <div className="flex items-center gap-2">
                                {expanded.has(g.key) ? <ChevronDown className="size-3.5 text-muted-foreground" /> : <ChevRight className="size-3.5 text-muted-foreground" />}
                                {primaryPerson ? (
                                  <UserAvatar name={primaryPerson.name} avatar={primaryPerson.avatar} size="xs" />
                                ) : (
                                  <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: primaryColor }} />
                                )}
                                <span className="font-semibold truncate">{primaryLabel(g.key)}</span>
                              </div>
                            </td>
                            {weekDays.map(d => <td key={d} className="py-2.5 px-2 text-right font-mono text-xs tabular-nums text-muted-foreground">{g.days[d] ? fmtHMS(g.days[d]) : '—'}</td>)}
                            <td className="py-2.5 px-2 text-right font-mono font-bold tabular-nums">{fmtHMS(g.total)}</td>
                          </tr>
                          {expanded.has(g.key) && [...g.subs.entries()].sort((a, b) => b[1].total - a[1].total).map(([sk, sub]) => {
                            const subPerson = weeklyBy === 'project' ? userById(sk) : null;
                            return (
                              <tr key={`${g.key}-${sk}`} className="border-b border-border/30 bg-muted/10">
                                <td className="py-2 px-2 pl-9">
                                  <div className="flex items-center gap-2 min-w-0 text-muted-foreground">
                                    {subPerson ? (
                                      <UserAvatar name={subPerson.name} avatar={subPerson.avatar} size="xs" />
                                    ) : (
                                      <span className="size-2 rounded-full shrink-0" style={{ backgroundColor: accentColor(sk) }} />
                                    )}
                                    <span className="truncate">{secondaryLabel(sk)}</span>
                                  </div>
                                </td>
                                {weekDays.map(d => <td key={d} className="py-2 px-2 text-right font-mono text-xs tabular-nums text-muted-foreground/70">{sub.days[d] ? fmtHMS(sub.days[d]) : '—'}</td>)}
                                <td className="py-2 px-2 text-right font-mono text-xs tabular-nums text-muted-foreground">{fmtHMS(sub.total)}</td>
                              </tr>
                            );
                          })}
                        </Fragment>
                      );
                    })}
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

        {tab === 'clients' && isManager && (
          <ClientSummaryPanel />
        )}
      </div>
    </motion.div>
  );
};

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
