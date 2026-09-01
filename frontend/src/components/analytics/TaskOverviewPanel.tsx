/**
 * Task Overview body — filters live in the shared Overview header.
 */

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, ListTodo } from 'lucide-react';
import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { analyticsExtApi } from '@/lib/analyticsApi';
import { AnalyticsKpiCard } from '@/components/analytics/analyticsUi';
import { OverviewTaskTable } from '@/components/analytics/OverviewTaskTable';
import { OverviewCharts } from '@/components/analytics/OverviewCharts';
import { OverviewProjectsSection } from '@/components/analytics/OverviewProjectsSection';
import TaskDetailModal from '@/components/TaskDetailModal';
import type { Task } from '@/types';

type StatusFilter = 'all' | 'active' | 'done';

export default function TaskOverviewPanel({
  projectId,
  status,
}: {
  projectId: string; // 'all' or id
  status: StatusFilter;
}) {
  const tasks = useAppStore(s => s.tasks);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const allProjects = projectId === 'all';

  const { data, isLoading, error } = useQuery({
    queryKey: ['task-overview', projectId, status],
    queryFn: () => analyticsExtApi.getTaskOverview(allProjects ? undefined : projectId, status),
    staleTime: 0,
  });

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="flex items-center gap-3 justify-center text-muted-foreground text-sm py-16">
          <div className="h-6 w-6 rounded-full border-2 border-border border-t-foreground/60 animate-spin" />
          Loading tasks…
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <AnalyticsKpiCard icon={ListTodo} label="Tasks" value={data.summary.total} sub="in this view" />
            <AnalyticsKpiCard icon={CheckCircle2} label="Done" value={data.summary.done} sub="completed / done" variant={data.summary.done > 0 ? 'emerald' : 'neutral'} />
            <AnalyticsKpiCard
              icon={Clock}
              label="Expected"
              value={data.summary.expectedHours > 0 ? `${data.summary.expectedHours}h` : '—'}
              sub="set duration total"
            />
            <AnalyticsKpiCard icon={Clock} label="Actual" value={`${data.summary.actualHours}h`} sub="time tracked" />
          </div>

          <OverviewCharts charts={data.charts} showProjectHours={allProjects} />
          {allProjects && <OverviewProjectsSection projects={data.projects ?? []} />}
          <OverviewTaskTable
            rows={data.tasks}
            showProject={allProjects}
            onRowClick={taskId => {
              const t = tasks.find(x => x.id === taskId);
              if (t) setSelectedTask(t);
            }}
          />
        </>
      )}

      <TaskDetailModal
        task={selectedTask}
        open={!!selectedTask}
        onOpenChange={o => { if (!o) setSelectedTask(null); }}
      />
    </div>
  );
}
