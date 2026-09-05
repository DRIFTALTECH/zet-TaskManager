/**
 * WipPage.tsx — Who's Working On What
 *
 * Employee rows with inline expand for projects/tasks.
 * Click employee name for full work history sheet.
 */

import { useMemo, useState, Fragment } from 'react';
import { DatePickerInput } from '@/components/DatePickerInput';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  Search, ChevronDown, ChevronRight, Download,
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { analyticsApi } from '@/lib/analyticsApi';
import type { WipRow } from '@/lib/analyticsApi';
import { WorkHistorySheet } from '@/components/analytics/WorkHistorySheet';
import { AIInsightsPanel } from '@/components/analytics/AIInsightsPanel';
import { AnalyticsSection, TASK_STATUS_CHIP, TASK_STATUS_LABEL } from '@/components/analytics/analyticsUi';
import { downloadCSV } from '@/lib/report-export';
import { pageEnter } from '@/lib/motion';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/PageHeader';

const iso = (d: Date) => format(d, 'yyyy-MM-dd');

function defaultRange() {
  const end = new Date();
  return { startDate: iso(subDays(end, 29)), endDate: iso(end) };
}

const STATUS_LABELS: Record<string, { label: string; css: string }> = {
  todo:        { label: TASK_STATUS_LABEL.todo,       css: TASK_STATUS_CHIP.todo },
  in_progress: { label: TASK_STATUS_LABEL.in_progress, css: TASK_STATUS_CHIP.in_progress },
  completed:   { label: TASK_STATUS_LABEL.completed, css: TASK_STATUS_CHIP.completed },
  cancelled:   { label: TASK_STATUS_LABEL.cancelled, css: TASK_STATUS_CHIP.cancelled },
  in_review:   { label: TASK_STATUS_LABEL.in_review, css: TASK_STATUS_CHIP.in_review },
  backlog:     { label: TASK_STATUS_LABEL.backlog,   css: TASK_STATUS_CHIP.backlog },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_LABELS[status] ?? { label: status, css: 'bg-muted/60 text-muted-foreground border border-border/40' };
  return (
    <span className={cn('rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap border', cfg.css)}>
      {cfg.label}
    </span>
  );
}

type ProjectGroup = {
  projectName: string;
  clientName: string;
  totalHours: number;
  tasks: WipRow[];
};

type EmployeeGroup = {
  employeeId: string;
  employeeName: string;
  totalHours: number;
  projects: ProjectGroup[];
};

function groupByEmployee(rows: WipRow[]): EmployeeGroup[] {
  const map = new Map<string, EmployeeGroup>();
  for (const row of rows) {
    let emp = map.get(row.employeeId);
    if (!emp) {
      emp = { employeeId: row.employeeId, employeeName: row.employeeName, totalHours: 0, projects: [] };
      map.set(row.employeeId, emp);
    }
    emp.totalHours += row.loggedHours;
    let proj = emp.projects.find(p => p.projectName === row.projectName);
    if (!proj) {
      proj = { projectName: row.projectName, clientName: row.clientName, totalHours: 0, tasks: [] };
      emp.projects.push(proj);
    }
    proj.totalHours += row.loggedHours;
    proj.tasks.push(row);
  }
  for (const emp of map.values()) {
    emp.projects.sort((a, b) => b.totalHours - a.totalHours);
  }
  return [...map.values()].sort((a, b) => b.totalHours - a.totalHours);
}

function ProjectAccordion({ project }: { project: ProjectGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border/20 bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{project.projectName}</p>
          <p className="text-[10px] text-muted-foreground truncate">{project.clientName}</p>
        </div>
        <span className="text-xs font-semibold tabular-nums text-blue-600 dark:text-blue-400 shrink-0">{project.totalHours.toFixed(1)}h</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-border/15"
          >
            <ul className="divide-y divide-border/10">
              {project.tasks.map(task => (
                <li key={`${task.projectName}-${task.taskTitle}`} className="flex items-center gap-3 px-3 py-2 pl-9">
                  <span className="flex-1 min-w-0 text-sm text-muted-foreground truncate">{task.taskTitle}</span>
                  <StatusBadge status={task.taskStatus} />
                  <span className="text-xs font-semibold tabular-nums shrink-0">{task.loggedHours.toFixed(1)}h</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmployeeRow({
  group,
  expanded,
  onToggle,
  onOpenHistory,
  index,
}: {
  group: EmployeeGroup;
  expanded: boolean;
  onToggle: () => void;
  onOpenHistory: () => void;
  index: number;
}) {
  return (
    <Fragment>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.1, delay: index * 0.02 }}
        className="hover:bg-muted/20 transition-colors"
      >
        <td className="px-3 py-3 w-10">
          <button
            type="button"
            onClick={onToggle}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted/40 transition-colors"
            aria-expanded={expanded}
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        </td>
        <td className="px-3 py-3">
          <button
            type="button"
            onClick={onOpenHistory}
            className="flex items-center gap-2.5 text-left group"
          >
            <div className="h-7 w-7 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
              <span className="text-[11px] font-bold text-primary/70">
                {group.employeeName.charAt(0)}
              </span>
            </div>
            <span className="font-medium text-foreground/80 group-hover:text-primary transition-colors underline-offset-2 group-hover:underline">
              {group.employeeName}
            </span>
          </button>
        </td>
        <td className="px-3 py-3 text-muted-foreground/70 tabular-nums">{group.projects.length}</td>
        <td className="px-3 py-3 tabular-nums font-semibold text-violet-600 dark:text-violet-400">{group.totalHours.toFixed(1)}h</td>
      </motion.tr>
      <AnimatePresence initial={false}>
        {expanded && (
          <tr>
            <td colSpan={4} className="px-3 pb-3 pt-0 bg-muted/5">
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="space-y-2 pl-10 pr-1"
              >
                {group.projects.map(p => (
                  <ProjectAccordion key={p.projectName} project={p} />
                ))}
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </Fragment>
  );
}

export function WipPage() {
  const [range, setRange] = useState(defaultRange);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const [historyUserName, setHistoryUserName] = useState('');
  const [historyWipProjects, setHistoryWipProjects] = useState<EmployeeGroup['projects']>([]);

  const query = useQuery({
    queryKey: ['analytics-wip', range],
    queryFn: () => analyticsApi.getWip(range),
    staleTime: 60_000,
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;

  const employees = useMemo(() => groupByEmployee(rows), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(emp =>
      emp.employeeName.toLowerCase().includes(q) ||
      emp.projects.some(p =>
        p.projectName.toLowerCase().includes(q) ||
        p.clientName.toLowerCase().includes(q) ||
        p.tasks.some(t => t.taskTitle.toLowerCase().includes(q)),
      ),
    );
  }, [employees, search]);

  function toggleExpanded(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const insightContext = useMemo(() => {
    if (!rows.length && !summary) return {};
    const byStatus = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.taskStatus] = (acc[r.taskStatus] ?? 0) + 1;
      return acc;
    }, {});
    return {
      dateRange: range,
      activeEmployees: summary?.activeEmployees ?? employees.length,
      projectsInFlight: summary?.projectsInFlight ?? 0,
      tasksBeingLogged: rows.length,
      tasksByStatus: byStatus,
      topPeople: employees.slice(0, 5).map(e => ({
        name: e.employeeName,
        projectCount: e.projects.length,
        loggedHours: Math.round(e.totalHours * 10) / 10,
      })),
    };
  }, [rows, summary, range, employees]);

  function handleExport() {
    if (!rows.length) return;
    const header = ['Employee', 'Client', 'Project', 'Task', 'Status', 'Hours Logged', 'Billable'];
    const csvRows = rows.map((r) => [
      r.employeeName, r.clientName, r.projectName, r.taskTitle,
      r.taskStatus, r.loggedHours, r.billable ? 'Yes' : 'No',
    ]);
    downloadCSV(`wip_${range.startDate}_${range.endDate}.csv`, header, csvRows);
  }

  function openHistory(group: EmployeeGroup) {
    setHistoryUserId(group.employeeId);
    setHistoryUserName(group.employeeName);
    setHistoryWipProjects(group.projects);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="space-y-4 max-w-screen-xl mx-auto"
    >
      <PageHeader
        icon={Activity}
        title="Who's Working On What"
        subtitle="Your team's active work — expand rows for detail, or click a name for AI insights."
        actions={
          <button
            type="button"
            onClick={handleExport}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          From
          <DatePickerInput
            variant="boxed"
            className="w-auto min-w-[10rem]"
            value={range.startDate}
            max={range.endDate}
            onChange={startDate => setRange(r => ({ ...r, startDate }))}
            clearable={false}
            aria-label="From"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          To
          <DatePickerInput
            variant="boxed"
            className="w-auto min-w-[10rem]"
            value={range.endDate}
            min={range.startDate}
            onChange={endDate => setRange(r => ({ ...r, endDate }))}
            clearable={false}
            aria-label="To"
          />
        </label>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground/40 pointer-events-none" />
        <input
          type="text"
          placeholder="Search employee, project, or task…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-xl border border-border/40 bg-muted/20 pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all placeholder:text-muted-foreground/30"
        />
      </div>

      <AnalyticsSection title="Active Work by Person" icon={Activity} iconClassName="text-blue-600 dark:text-blue-400" tone="muted">
        <div className="rounded-xl border border-border/20 bg-card/50 overflow-hidden">
        {query.isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-7 w-7 rounded-full border-2 border-primary/40 border-t-primary animate-spin" />
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-red-600 dark:text-red-400">
            <p>{(query.error as Error).message}</p>
            <button
              type="button"
              onClick={() => void query.refetch()}
              className="mt-3 rounded-lg border border-red-500/30 bg-red-500/20 px-3 py-1 text-xs"
            >Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground/50">
              {search ? 'No results matching your search.' : 'No activity logged in this period.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/20">
                  <th className="w-10 px-3 py-3" aria-label="Expand" />
                  <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50">Employee</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50">Projects</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/50">Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/10">
                {filtered.map((group, i) => (
                  <EmployeeRow
                    key={group.employeeId}
                    group={group}
                    expanded={expandedIds.has(group.employeeId)}
                    onToggle={() => toggleExpanded(group.employeeId)}
                    onOpenHistory={() => openHistory(group)}
                    index={i}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border/20 text-xs text-muted-foreground/50">
            <span>{filtered.length} employee{filtered.length !== 1 ? 's' : ''}</span>
            <span className="font-semibold text-violet-600 dark:text-violet-400">{filtered.reduce((s, g) => s + g.totalHours, 0).toFixed(1)}h total</span>
          </div>
        )}
        </div>
      </AnalyticsSection>

      {!query.isLoading && rows.length > 0 && (
        <AIInsightsPanel
          scope="workload"
          context={insightContext}
        />
      )}

      <WorkHistorySheet
        userId={historyUserId}
        userName={historyUserName}
        range={range}
        wipProjects={historyWipProjects}
        onClose={() => setHistoryUserId(null)}
      />
    </motion.div>
  );
}
