/**
 * OverviewPage.tsx — Task-first team snapshot + weekly trend + top contributors + AI summary.
 */

import { useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Bar, BarChart, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import {
  AlertTriangle, CheckCircle2, Clock, FolderOpen,
  ListTodo, Star, Users, TrendingUp, Award,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { analyticsExtApi } from '@/lib/analyticsApi';
import { AIInsightsPanel } from '@/components/analytics/AIInsightsPanel';
import { NeedsAttentionList } from '@/components/analytics/NeedsAttentionList';
import { AnalyticsKpiCard, AnalyticsSection } from '@/components/analytics/analyticsUi';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import { healthScoreToCondition } from '@/lib/healthStatus';
import { pageEnter } from '@/lib/motion';

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

const CHART_TOOLTIP = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
};

export default function OverviewPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'admin';
  if (!isManager) return <Navigate to="/" replace />;

  const [range, setRange] = useState(defaultRange);
  const [projectId, setProjectId] = useState('');

  const visibleProjects = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'admin') return projects;
    return projects.filter(p => currentUser.projectIds.includes(p.id));
  }, [currentUser, projects]);

  const selectedProject = visibleProjects.find(p => p.id === projectId);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['overview', range, projectId],
    queryFn: () => analyticsExtApi.getOverview(range, projectId || undefined),
    staleTime: 0,
  });

  const insightContext = useMemo(() => {
    if (!data) return {};
    const { onTimeCompletionPct: _omit, ...kpis } = data.kpis;
    return {
      dateRange: range,
      projectId: projectId || null,
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full px-4 sm:px-8 py-6 space-y-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {selectedProject ? selectedProject.name : 'Team snapshot'} · {range.startDate} → {range.endDate}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="rounded-lg border border-border/40 bg-background px-3 py-1.5 max-w-[200px]"
            aria-label="Filter by project"
          >
            <option value="">All Projects</option>
            {visibleProjects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="text-muted-foreground">From</span>
          <input
            type="date"
            value={range.startDate}
            onChange={e => setRange(r => ({ ...r, startDate: e.target.value }))}
            className="rounded-lg border border-border/40 bg-background px-3 py-1.5"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={range.endDate}
            onChange={e => setRange(r => ({ ...r, endDate: e.target.value }))}
            className="rounded-lg border border-border/40 bg-background px-3 py-1.5"
          />
        </div>
      </div>

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
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <AnalyticsKpiCard icon={ListTodo} label={ANALYTICS_LABELS.activeTasks} value={data.kpis.activeTasks} sub="active in this period" variant="blue" />
            <AnalyticsKpiCard icon={CheckCircle2} label={ANALYTICS_LABELS.completedTasks} value={data.kpis.completedTasks} sub="finished in this period" variant="emerald" />
            <AnalyticsKpiCard icon={AlertTriangle} label={ANALYTICS_LABELS.overdueTasks} value={data.kpis.overdueTasks} sub={`overdue as of ${range.endDate}`} variant={data.kpis.overdueTasks > 0 ? 'red' : 'neutral'} />
            <AnalyticsKpiCard icon={Star} label={ANALYTICS_LABELS.highPriorityPending} value={data.kpis.highPriorityPending} sub="urgent or high priority" variant="amber" />
            <AnalyticsKpiCard icon={FolderOpen} label="Active Projects" value={data.kpis.activeProjects} sub="with open tasks" variant="violet" />
            <AnalyticsKpiCard icon={Clock} label={ANALYTICS_LABELS.loggedHours} value={`${data.kpis.totalLoggedHours}h`} sub="logged in this period" variant="blue" />
            <AnalyticsKpiCard icon={Users} label="Team Size" value={data.kpis.totalTeam} sub="people" variant="neutral" />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <AnalyticsSection title={ANALYTICS_LABELS.weeklyTrend} icon={TrendingUp} iconClassName="text-violet-400" tone="muted">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={data.weeklyTrend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }} barGap={4}>
                  <XAxis dataKey="weekLabel" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                  <YAxis yAxisId="tasks" tick={{ fontSize: 10, fill: '#94a3b8' }} width={24} allowDecimals={false} />
                  <YAxis yAxisId="hours" orientation="right" tick={{ fontSize: 10, fill: '#94a3b8' }} width={28} unit="h" />
                  <Tooltip contentStyle={CHART_TOOLTIP} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="tasks" dataKey="completedTasks" name="Completed tasks" fill="#10b981" radius={[3, 3, 0, 0]} barSize={14} />
                  <Bar yAxisId="hours" dataKey="loggedHours" name="Logged hours" fill="#8b5cf6" radius={[3, 3, 0, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </AnalyticsSection>

            <AnalyticsSection title={ANALYTICS_LABELS.topContributors} icon={Award} iconClassName="text-amber-400" tone="muted">
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
                        <span className="font-semibold text-emerald-400">{c.completedTasks}</span>
                        <span className="text-muted-foreground"> done · </span>
                        <span className="font-semibold text-amber-400">{c.loggedHours}h</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </AnalyticsSection>
          </div>

          <AnalyticsSection
            title={`Needs attention (${range.startDate} → ${range.endDate})`}
            icon={AlertTriangle}
            iconClassName="text-red-400"
            tone="alert"
          >
            <NeedsAttentionList tasks={data.needsAttentionToday} />
          </AnalyticsSection>

          <AIInsightsPanel
            key={projectId || 'all'}
            scope="overview_team_summary"
            context={insightContext}
          />
        </>
      )}
    </motion.div>
  );
}
