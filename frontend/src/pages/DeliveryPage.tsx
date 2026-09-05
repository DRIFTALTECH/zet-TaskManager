/**
 * DeliveryPage.tsx — Project Status: late tasks, blockers, project progress.
 */

import { useMemo } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Clock, ShieldAlert, CheckCircle2, Star, FolderKanban, AlertTriangle,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { analyticsExtApi } from '@/lib/analyticsApi';
import type { OverdueTask, PriorityTaskRow, ProjectProgressCard } from '@/lib/analyticsApi';
import { AIInsightsPanel } from '@/components/analytics/AIInsightsPanel';
import { ANALYTICS_LABELS, ANALYTICS_LABEL_SUBS } from '@/lib/analyticsLabels';
import {
  AnalyticsKpiCard,
  AnalyticsSection,
  OverdueChip,
  PriorityChip,
  TaskStatusChip,
} from '@/components/analytics/analyticsUi';
import { Button } from '@/components/ui/button';
import { pageEnter } from '@/lib/motion';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/PageHeader';
import { PAGE_SHELL_SCROLL } from '@/lib/page-styles';

function emptyProjectCard(project: { id: string; name: string }): ProjectProgressCard {
  return {
    id: project.id,
    name: project.name,
    progress: 0,
    totalTasks: 0,
    completedTasks: 0,
    activeTasks: 0,
    overdueTasks: 0,
    blockedTasks: 0,
    atRisk: false,
    statusLabel: 'On Track',
  };
}

function OverdueCard({ task, accent }: { task: OverdueTask; accent?: boolean }) {
  return (
    <div className={cn(
      'rounded-xl border p-3 space-y-1 transition-colors',
      accent ? 'border-red-500/25 bg-red-500/5 hover:border-red-500/40' : 'border-border/25 bg-muted/[0.04] hover:border-border/50',
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">{task.title}</p>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <PriorityChip priority={task.priority} />
          <TaskStatusChip status={task.status} />
          <OverdueChip />
        </div>
      </div>
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{task.assigneeName}</span>
        <span className={cn('font-semibold', task.daysOverdue > 7 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400')}>
          {task.daysOverdue}d overdue
        </span>
        <span>Due {task.dueDate}</span>
      </div>
    </div>
  );
}

function PriorityCard({ task }: { task: PriorityTaskRow }) {
  return (
    <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.05] p-3 space-y-1">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-foreground line-clamp-2">{task.title}</p>
        <PriorityChip priority={task.priority} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        {task.projectName} · {task.assigneeName}
        {task.dueDate && ` · due ${task.dueDate}`}
        {task.isOverdue && <span className="text-red-600 dark:text-red-400 font-semibold ml-1">· past due</span>}
      </p>
    </div>
  );
}

function ProjectStatusCard({ project }: { project: ProjectProgressCard }) {
  const navigate = useNavigate();

  return (
    <div className="rounded-xl border border-border/25 bg-muted/[0.04] p-4 space-y-3 hover:border-border/40 transition-colors flex flex-col">
      <p className="text-sm font-semibold text-foreground truncate">{project.name}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-[11px] text-muted-foreground">Progress</dt>
          <dd className="font-semibold tabular-nums text-violet-600 dark:text-violet-400">{project.progress}%</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Open Tasks</dt>
          <dd className="font-semibold tabular-nums text-blue-600 dark:text-blue-400">{project.activeTasks}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Overdue Tasks</dt>
          <dd className={cn('font-semibold tabular-nums', project.overdueTasks > 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground')}>
            {project.overdueTasks}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">{ANALYTICS_LABELS.blockedTasks}</dt>
          <dd className={cn('font-semibold tabular-nums', (project.blockedTasks ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
            {project.blockedTasks ?? 0}
          </dd>
        </div>
      </dl>
      <Button
        variant="outline"
        size="sm"
        className="mt-auto w-full rounded-xl"
        onClick={() => navigate(`/manage/${project.id}`)}
      >
        View Project
      </Button>
    </div>
  );
}

interface DeliveryPageProps {
  embedded?: boolean;
}

export default function DeliveryPage({ embedded = false }: DeliveryPageProps) {
  const currentUser = useAppStore(s => s.currentUser);
  const storeProjects = useAppStore(s => s.projects);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';

  const { data, isLoading, error } = useQuery({
    queryKey: ['delivery-risk'],
    queryFn: () => analyticsExtApi.getDeliveryRisk(),
    staleTime: 60_000,
    refetchInterval: 120_000,
    enabled: isManager,
  });

  const projectProgress = useMemo(() => {
    if (!data) return [];
    const progressById = new Map(data.projectProgress.map(p => [p.id, p]));
    return storeProjects.map(project => progressById.get(project.id) ?? emptyProjectCard(project));
  }, [data, storeProjects]);

  const summary = useMemo(() => {
    const atRiskProjects = projectProgress.filter(
      p => p.statusLabel === 'At Risk' || p.atRisk,
    ).length;
    const blockedProjects = projectProgress.filter(
      p => (p.blockedTasks ?? 0) > 0,
    ).length;
    return {
      atRiskProjects,
      blockedProjects,
      highPriorityTasks: data?.summary.highPriorityPending ?? 0,
    };
  }, [projectProgress, data]);

  if (!isManager) return <Navigate to="/" replace />;

  const content = (
    <div className={cn('space-y-4', embedded ? 'py-1' : '')}>
      {!embedded && (
        <PageHeader
          title={ANALYTICS_LABELS.projectStatus}
          subtitle="Past-due tasks, work that started but is late, and how each project is doing"
        />
      )}

      {isLoading && (
        <div className="flex items-center gap-3 justify-center text-muted-foreground text-sm py-24">
          <div className="h-6 w-6 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
          Loading project status…
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <AnalyticsKpiCard
              icon={AlertTriangle}
              label={ANALYTICS_LABELS.atRiskProjects}
              value={summary.atRiskProjects}
              sub={ANALYTICS_LABEL_SUBS.atRiskProjects}
              variant="red"
            />
            <AnalyticsKpiCard
              icon={ShieldAlert}
              label={ANALYTICS_LABELS.blockedProjects}
              value={summary.blockedProjects}
              sub={ANALYTICS_LABEL_SUBS.blockedProjects}
              variant="amber"
            />
            <AnalyticsKpiCard
              icon={Star}
              label={ANALYTICS_LABELS.highPriorityTasks}
              value={summary.highPriorityTasks}
              sub={ANALYTICS_LABEL_SUBS.highPriorityTasks}
              variant="orange"
            />
          </div>

          <AnalyticsSection title={ANALYTICS_LABELS.projectProgress} icon={FolderKanban} iconClassName="text-violet-600 dark:text-violet-400" tone="muted">
            {projectProgress.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No active projects yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {projectProgress.map(p => <ProjectStatusCard key={p.id} project={p} />)}
              </div>
            )}
          </AnalyticsSection>

          <div className="grid gap-4 xl:grid-cols-2">
            <AnalyticsSection
              title={ANALYTICS_LABELS.overdueTasks}
              icon={Clock}
              iconClassName="text-red-600 dark:text-red-400"
              tone="alert"
              badge={
                <span className="rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400">
                  {data.overdueTasks.length}
                </span>
              }
            >
              {data.overdueTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                  <CheckCircle2 className="h-8 w-8 mb-2 text-emerald-400/40" />
                  <p className="text-sm">No overdue tasks</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.overdueTasks.map(t => <OverdueCard key={t.id} task={t} accent={t.daysOverdue > 7} />)}
                </div>
              )}
            </AnalyticsSection>

            <AnalyticsSection
              title={ANALYTICS_LABELS.blockedTasks}
              icon={ShieldAlert}
              iconClassName="text-amber-600 dark:text-amber-400"
              tone="warm"
              badge={
                <span className="rounded-full bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  {data.blockedTasks.length}
                </span>
              }
            >
              {data.blockedTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50">
                  <CheckCircle2 className="h-8 w-8 mb-2 text-emerald-400/40" />
                  <p className="text-sm">Nothing started but still late</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {data.blockedTasks.map(t => <OverdueCard key={t.id} task={t} />)}
                </div>
              )}
            </AnalyticsSection>
          </div>

          {data.highPriorityPending.length > 0 && (
            <AnalyticsSection title={ANALYTICS_LABELS.highPriorityPending} icon={Star} iconClassName="text-orange-600 dark:text-orange-400" tone="warm">
              <div className="grid gap-2 sm:grid-cols-2">
                {data.highPriorityPending.map(t => <PriorityCard key={t.id} task={t} />)}
              </div>
            </AnalyticsSection>
          )}

          <AIInsightsPanel
            scope="delivery_risk"
            context={{
              overdueTasks: data.summary.overdueTasks,
              blockedTasks: data.summary.blockedTasks,
              highPriorityPending: data.summary.highPriorityPending,
              atRiskProjects: summary.atRiskProjects,
              blockedProjects: summary.blockedProjects,
              needsAttentionToday: data.needsAttentionToday.slice(0, 8).map(t => ({
                title: t.title,
                priority: t.priority,
                assigneeName: t.assigneeName,
                attentionType: t.attentionType,
              })),
              projectProgress: projectProgress.slice(0, 8).map(p => ({
                name: p.name,
                statusLabel: p.statusLabel,
                overdueTasks: p.overdueTasks,
                blockedTasks: p.blockedTasks,
                activeTasks: p.activeTasks,
                progress: p.progress,
              })),
            }}
          />
        </>
      )}
    </div>
  );

  if (embedded) return content;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className={PAGE_SHELL_SCROLL}
    >
      {content}
    </motion.div>
  );
}
