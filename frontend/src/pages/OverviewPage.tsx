/**
 * OverviewPage.tsx — Task-first team snapshot + weekly trend + top contributors + AI summary.
 */

import { useMemo, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  AlertTriangle, CheckCircle2, Clock, FolderOpen,
  ListTodo, Star, TrendingUp, Award,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { analyticsExtApi } from '@/lib/analyticsApi';
import { AIInsightsPanel } from '@/components/analytics/AIInsightsPanel';
import { NeedsAttentionList } from '@/components/analytics/NeedsAttentionList';
import { AnalyticsKpiCard, AnalyticsSection } from '@/components/analytics/analyticsUi';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import { healthScoreToCondition } from '@/lib/healthStatus';
import { pageEnter } from '@/lib/motion';
import { cn } from '@/lib/utils';
import DateRangePicker from '@/components/DateRangePicker';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { formatRangeLabel, resolveRange, type RangeSelection } from '@/lib/date-range';
import { OverviewSectionTabs } from '@/components/analytics/OverviewSectionTabs';
import TaskOverviewPanel from '@/components/analytics/TaskOverviewPanel';
import UserOverviewPanel from '@/components/analytics/UserOverviewPanel';
import SprintOverviewPanel from '@/components/analytics/SprintOverviewPanel';

const CHART_TOOLTIP = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
};

export default function OverviewPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const users = useAppStore(s => s.users);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: 'project' | 'task' | 'user' | 'sprint' =
    tabParam === 'task' ? 'task'
      : tabParam === 'user' ? 'user'
        : tabParam === 'sprint' ? 'sprint'
          : 'project';

  const [selection, setSelection] = useState<RangeSelection>({ preset: 'last30', offset: 0 });
  const [projectId, setProjectId] = useState('all');
  const [taskProjectId, setTaskProjectId] = useState('');
  const [taskStatus, setTaskStatus] = useState<'all' | 'active' | 'done'>('all');
  const [userId, setUserId] = useState('');
  const [userProjectId, setUserProjectId] = useState('all');
  const [userStatus, setUserStatus] = useState<'all' | 'active' | 'done'>('all');
  const [sprintName, setSprintName] = useState('');
  const [sprintProjectId, setSprintProjectId] = useState('all');
  const [sprintStatus, setSprintStatus] = useState<'all' | 'active' | 'done'>('all');

  const range = useMemo(() => {
    const r = resolveRange(selection);
    return { startDate: r.start, endDate: r.end };
  }, [selection]);

  const visibleProjects = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'superadmin') return projects;
    return projects.filter(p => currentUser.projectIds.includes(p.id));
  }, [currentUser, projects]);

  const visibleUsers = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'superadmin') {
      return users.filter(u => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name));
    }
    const memberIds = new Set(visibleProjects.flatMap(p => p.members));
    return users
      .filter(u => memberIds.has(u.id) && u.isActive !== false)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [currentUser, users, visibleProjects]);

  const effectiveTaskProjectId = visibleProjects.some(p => p.id === taskProjectId)
    ? taskProjectId
    : (visibleProjects[0]?.id ?? '');
  const effectiveUserId = visibleUsers.some(u => u.id === userId)
    ? userId
    : (visibleUsers[0]?.id ?? '');

  const { data: sprintListData } = useQuery({
    queryKey: ['sprints', sprintProjectId],
    queryFn: () => analyticsExtApi.listSprints(sprintProjectId === 'all' ? undefined : sprintProjectId),
    enabled: isManager && activeTab === 'sprint',
    staleTime: 30_000,
  });
  const sprintOptions = sprintListData?.sprints ?? [];
  const effectiveSprint = sprintOptions.some(s => s.name === sprintName)
    ? sprintName
    : (sprintOptions[0]?.name ?? '');

  const selectedProject = visibleProjects.find(p => p.id === projectId);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['overview', range, projectId],
    queryFn: () => analyticsExtApi.getOverview(range, projectId === 'all' ? undefined : projectId),
    staleTime: 0,
    enabled: isManager && activeTab === 'project',
  });

  const insightContext = useMemo(() => {
    if (!data) return {};
    const { onTimeCompletionPct: _omit, ...kpis } = data.kpis;
    return {
      dateRange: range,
      projectId: projectId === 'all' ? null : projectId,
      projectName: selectedProject?.name ?? 'All Projects',
      overallCondition: healthScoreToCondition(data.healthScore),
      ...kpis,
      weeklyTrend: data.weeklyTrend,
      topContributors: data.topContributors.map(c => ({
        name: c.name,
        completedTasks: c.completedTasks,
        loggedHours: c.loggedHours,
      })),
      needsAttentionToday: data.needsAttentionToday.map(t => ({
        title: t.title,
        priority: t.priority,
        assigneeName: t.assigneeName,
        projectName: t.projectName,
        attentionType: t.attentionType,
      })),
    };
  }, [data, range, projectId, selectedProject?.name]);

  if (!isManager) return <Navigate to="/" replace />;

  const subtitle =
    activeTab === 'task'
      ? 'Tasks, time, priority, and user stories by project'
      : activeTab === 'user'
        ? 'Tasks and time for one person'
        : activeTab === 'sprint'
          ? 'Everything in one sprint — tasks, projects, people, hours'
          : (
            <>
              {selectedProject ? selectedProject.name : 'Team snapshot'} ·{' '}
              {formatRangeLabel(resolveRange(selection), selection.preset)}
            </>
          );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full flex flex-col"
    >
      {/* Static header — title + one control row; only body data swaps per tab */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="max-w-[1400px] w-full mx-auto space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Overview</h1>
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <OverviewSectionTabs active={activeTab} />

            {activeTab === 'project' && (
              <>
                <Select value={projectId} onValueChange={setProjectId}>
                  <SelectTrigger className="h-9 w-auto min-w-[170px] max-w-[240px] text-sm">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {visibleProjects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DateRangePicker
                  value={selection}
                  onChange={setSelection}
                  allowedPresets={['week', 'lastweek', 'month', 'last30', 'custom']}
                />
              </>
            )}

            {activeTab === 'task' && (
              <>
                <Select value={effectiveTaskProjectId} onValueChange={setTaskProjectId}>
                  <SelectTrigger className="h-9 w-auto min-w-[170px] max-w-[240px] text-sm">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleProjects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="inline-flex h-9 rounded-lg border border-border/70 bg-card/70 p-0.5">
                  {([
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['done', 'Done'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTaskStatus(id)}
                      className={cn(
                        'rounded-md px-3 text-xs font-medium transition-colors',
                        taskStatus === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'user' && (
              <>
                <Select value={effectiveUserId} onValueChange={setUserId}>
                  <SelectTrigger className="h-9 w-auto min-w-[170px] max-w-[240px] text-sm">
                    <SelectValue placeholder="Person" />
                  </SelectTrigger>
                  <SelectContent>
                    {visibleUsers.map(u => (
                      <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={userProjectId} onValueChange={setUserProjectId}>
                  <SelectTrigger className="h-9 w-auto min-w-[160px] max-w-[220px] text-sm">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {visibleProjects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="inline-flex h-9 rounded-lg border border-border/70 bg-card/70 p-0.5">
                  {([
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['done', 'Done'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setUserStatus(id)}
                      className={cn(
                        'rounded-md px-3 text-xs font-medium transition-colors',
                        userStatus === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {activeTab === 'sprint' && (
              <>
                <Select
                  value={effectiveSprint || undefined}
                  onValueChange={setSprintName}
                  disabled={sprintOptions.length === 0}
                >
                  <SelectTrigger className="h-9 w-auto min-w-[170px] max-w-[260px] text-sm">
                    <SelectValue placeholder={sprintOptions.length ? 'Select sprint' : 'No sprints yet'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sprintOptions.map(s => (
                      <SelectItem key={s.name} value={s.name}>
                        {s.name} ({s.taskCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={sprintProjectId} onValueChange={setSprintProjectId}>
                  <SelectTrigger className="h-9 w-auto min-w-[160px] max-w-[220px] text-sm">
                    <SelectValue placeholder="Project" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All projects</SelectItem>
                    {visibleProjects.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="inline-flex h-9 rounded-lg border border-border/70 bg-card/70 p-0.5">
                  {([
                    ['all', 'All'],
                    ['active', 'Active'],
                    ['done', 'Done'],
                  ] as const).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSprintStatus(id)}
                      className={cn(
                        'rounded-md px-3 text-xs font-medium transition-colors',
                        sprintStatus === id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-8 space-y-8 max-w-[1400px] w-full mx-auto">
      {activeTab === 'task' ? (
        <TaskOverviewPanel projectId={effectiveTaskProjectId} status={taskStatus} />
      ) : activeTab === 'user' ? (
        <UserOverviewPanel userId={effectiveUserId} projectId={userProjectId} status={userStatus} />
      ) : activeTab === 'sprint' ? (
        <SprintOverviewPanel sprint={effectiveSprint} projectId={sprintProjectId} status={sprintStatus} />
      ) : (
        <>
      {isLoading && (
        <div className="flex items-center gap-3 justify-center text-muted-foreground text-sm py-24">
          <div className="h-6 w-6 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
          Loading overview…
        </div>
      )}

      {isFetching && !isLoading && data && (
        <p className="text-xs text-muted-foreground text-center -mt-4">Updating for selected dates…</p>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          {(() => {
            const condition = healthScoreToCondition(data.healthScore);
            const tone =
              data.healthScore >= 70
                ? { ring: 'border-emerald-500/30 bg-emerald-500/[0.06]', text: 'text-emerald-600 dark:text-emerald-400' }
                : data.healthScore >= 50
                  ? { ring: 'border-amber-500/30 bg-amber-500/[0.06]', text: 'text-amber-600 dark:text-amber-400' }
                  : { ring: 'border-red-500/30 bg-red-500/[0.06]', text: 'text-red-600 dark:text-red-400' };
            const attention = data.needsAttentionToday.length;
            return (
              <div className={cn('rounded-2xl border p-5 flex flex-wrap items-center gap-x-10 gap-y-4', tone.ring)}>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Health
                  </p>
                  <div className="flex items-baseline gap-2.5 mt-1">
                    <span className={cn('text-4xl font-bold tabular-nums', tone.text)}>
                      {data.healthScore}
                    </span>
                    <span className={cn('text-sm font-semibold', tone.text)}>{condition}</span>
                  </div>
                </div>

                <div className="h-10 w-px bg-border/50 hidden sm:block" />

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Needs action now
                  </p>
                  <p className={cn('text-2xl font-bold tabular-nums mt-1',
                    attention > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
                    {attention}
                    <span className="text-sm font-medium text-muted-foreground ml-1.5">
                      {attention === 1 ? 'task' : 'tasks'}
                    </span>
                  </p>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Delivered on time
                  </p>
                  <p className="text-2xl font-bold tabular-nums mt-1 text-foreground">
                    {data.kpis.onTimeCompletionPct}
                    <span className="text-sm font-medium text-muted-foreground">%</span>
                  </p>
                </div>
              </div>
            );
          })()}

          {/* The actionable list comes BEFORE the summary numbers — it was last. */}
          <AnalyticsSection
            title="Needs attention"
            icon={AlertTriangle}
            iconClassName={data.needsAttentionToday.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}
            tone={data.needsAttentionToday.length > 0 ? 'alert' : 'muted'}
          >
            <NeedsAttentionList tasks={data.needsAttentionToday} />
          </AnalyticsSection>

          {/* Supporting counts. Colour is SEMANTIC here: a number is only red or
              amber when it actually calls for action, so colour means something
              rather than decorating every tile a different hue. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <AnalyticsKpiCard icon={AlertTriangle} label={ANALYTICS_LABELS.overdueTasks} value={data.kpis.overdueTasks} sub="past their due date" variant={data.kpis.overdueTasks > 0 ? 'red' : 'neutral'} />
            <AnalyticsKpiCard icon={Star} label={ANALYTICS_LABELS.highPriorityPending} value={data.kpis.highPriorityPending} sub="urgent or high, still open" variant={data.kpis.highPriorityPending > 0 ? 'amber' : 'neutral'} />
            <AnalyticsKpiCard icon={ListTodo} label={ANALYTICS_LABELS.activeTasks} value={data.kpis.activeTasks} sub="in progress" variant="neutral" />
            <AnalyticsKpiCard icon={CheckCircle2} label={ANALYTICS_LABELS.completedTasks} value={data.kpis.completedTasks} sub="finished this period" variant="neutral" />
            <AnalyticsKpiCard icon={Clock} label={ANALYTICS_LABELS.loggedHours} value={`${data.kpis.totalLoggedHours}h`} sub="logged this period" variant="neutral" />
            <AnalyticsKpiCard icon={FolderOpen} label="Active projects" value={data.kpis.activeProjects} sub={`${data.kpis.totalTeam} people`} variant="neutral" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AnalyticsSection title={ANALYTICS_LABELS.weeklyTrend} icon={TrendingUp} iconClassName="text-violet-600 dark:text-violet-400" tone="muted">
              <div className="space-y-4">
                {/* Tasks and hours are different units, so they get their own
                    scales in their own plots rather than a second y-axis. */}
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Completed tasks</p>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={data.weeklyTrend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={24} allowDecimals={false} />
                      <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                      <Bar dataKey="completedTasks" name="Completed tasks" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">Logged hours</p>
                  <ResponsiveContainer width="100%" height={110}>
                    <BarChart data={data.weeklyTrend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <XAxis dataKey="weekLabel" tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} />
                      <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={28} unit="h" />
                      <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                      <Bar dataKey="loggedHours" name="Logged hours" fill="hsl(var(--chart-3))" radius={[4, 4, 0, 0]} barSize={18} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </AnalyticsSection>

            <AnalyticsSection title={ANALYTICS_LABELS.topContributors} icon={Award} iconClassName="text-amber-600 dark:text-amber-400" tone="muted">
              <p className="text-xs text-muted-foreground -mt-1">
                Ranked by completed work and priority — not hours alone.
              </p>
              {data.topContributors.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">No contribution data for this period.</p>
              ) : (
                <ul className="divide-y divide-border/15">
                  {data.topContributors.map((c, i) => (
                    <li key={c.userId} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-xs font-bold text-violet-400/80 w-4">{i + 1}</span>
                        <span className="font-medium text-foreground truncate">{c.name}</span>
                      </div>
                      <span className="text-[11px] tabular-nums shrink-0 text-right">
                        <span className="font-semibold text-emerald-600 dark:text-emerald-400">{c.completedTasks}</span>
                        <span className="text-muted-foreground"> done · </span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">{c.loggedHours}h</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </AnalyticsSection>
          </div>


          {data.projectProgress.length > 0 && (
            <AnalyticsSection title="Projects" icon={FolderOpen} iconClassName="text-muted-foreground" tone="muted">
              <p className="text-xs text-muted-foreground -mt-1 mb-2">
                Sorted by what needs attention first.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[34rem]">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                      <th className="text-left font-semibold py-2 pr-3">Project</th>
                      <th className="text-left font-semibold py-2 px-3 w-[38%]">Progress</th>
                      <th className="text-right font-semibold py-2 px-3 tabular-nums">Open</th>
                      <th className="text-right font-semibold py-2 px-3 tabular-nums">Overdue</th>
                      <th className="text-right font-semibold py-2 pl-3 tabular-nums">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/15">
                    {[...data.projectProgress]
                      .sort((a, b) => (b.overdueTasks - a.overdueTasks) || (b.activeTasks - a.activeTasks))
                      .map(p => (
                        <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-medium text-foreground truncate">{p.name}</span>
                              {p.atRisk && (
                                <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
                                  At risk
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 rounded-full bg-muted/40 overflow-hidden">
                                <div
                                  className={cn('h-full rounded-full',
                                    p.atRisk ? 'bg-red-400/70' : 'bg-emerald-400/70')}
                                  style={{ width: `${Math.min(100, Math.max(0, p.progress))}%` }}
                                />
                              </div>
                              <span className="text-[11px] tabular-nums text-muted-foreground w-9 text-right">
                                {Math.round(p.progress)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{p.activeTasks}</td>
                          <td className={cn('py-2.5 px-3 text-right tabular-nums font-semibold',
                            p.overdueTasks > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                            {p.overdueTasks}
                          </td>
                          <td className="py-2.5 pl-3 text-right tabular-nums text-muted-foreground">
                            {p.loggedHours ?? 0}h
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </AnalyticsSection>
          )}

          <AIInsightsPanel
            key={projectId}
            scope="overview_team_summary"
            context={insightContext}
          />
        </>
      )}
        </>
      )}
      </div>
    </motion.div>
  );
}
