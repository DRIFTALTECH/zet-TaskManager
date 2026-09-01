/**
 * Sprint Overview — pick a sprint, see tasks / projects / people / hours.
 */

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CheckCircle2, Clock, FolderOpen, ListTodo, Users,
} from 'lucide-react';
import {
  Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { useAppStore } from '@/stores/appStore';
import { analyticsExtApi } from '@/lib/analyticsApi';
import { AnalyticsKpiCard, AnalyticsSection } from '@/components/analytics/analyticsUi';
import { OverviewTaskTable } from '@/components/analytics/OverviewTaskTable';
import { OverviewCharts } from '@/components/analytics/OverviewCharts';
import { OverviewProjectsSection } from '@/components/analytics/OverviewProjectsSection';
import TaskDetailModal from '@/components/TaskDetailModal';
import type { Task } from '@/types';

type StatusFilter = 'all' | 'active' | 'done';

const CHART_TOOLTIP = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
};

export default function SprintOverviewPanel({
  sprint,
  projectId,
  status,
}: {
  sprint: string;
  projectId: string; // 'all' or id
  status: StatusFilter;
}) {
  const tasks = useAppStore(s => s.tasks);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['sprint-overview', sprint, status, projectId],
    queryFn: () => analyticsExtApi.getSprintOverview(
      sprint,
      status,
      projectId === 'all' ? undefined : projectId,
    ),
    enabled: !!sprint,
    staleTime: 0,
  });

  if (!sprint) {
    return (
      <p className="text-sm text-muted-foreground py-16 text-center border border-dashed border-border/40 rounded-xl">
        Select a sprint to see everything in that sprint — tasks, projects, people, and hours.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {isLoading && (
        <div className="flex items-center gap-3 justify-center text-muted-foreground text-sm py-16">
          <div className="h-6 w-6 rounded-full border-2 border-border border-t-foreground/60 animate-spin" />
          Loading sprint…
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <AnalyticsKpiCard icon={ListTodo} label="Tasks" value={data.summary.total} sub={data.sprint} />
            <AnalyticsKpiCard icon={CheckCircle2} label="Done" value={data.summary.done} variant={data.summary.done > 0 ? 'emerald' : 'neutral'} />
            <AnalyticsKpiCard icon={FolderOpen} label="Projects" value={data.summary.projectCount} />
            <AnalyticsKpiCard icon={Users} label="People" value={data.summary.peopleCount} />
            <AnalyticsKpiCard
              icon={Clock}
              label="Expected"
              value={data.summary.expectedHours > 0 ? `${data.summary.expectedHours}h` : '—'}
            />
            <AnalyticsKpiCard icon={Clock} label="Actual" value={`${data.summary.actualHours}h`} />
          </div>

          <OverviewCharts charts={data.charts} showProjectHours />

          {(data.charts.hoursByPerson?.length ?? 0) > 0 && (
            <AnalyticsSection title="Hours by person" icon={Users} iconClassName="text-sky-600 dark:text-sky-400" tone="muted">
              <ResponsiveContainer width="100%" height={Math.min(280, 40 + (data.charts.hoursByPerson!.length * 28))}>
                <BarChart
                  data={data.charts.hoursByPerson!.slice(0, 12)}
                  layout="vertical"
                  margin={{ top: 4, right: 12, bottom: 0, left: 4 }}
                >
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} unit="h" />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 11, fill: 'hsl(var(--chart-axis))' }}
                  />
                  <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                  <Bar dataKey="hours" name="Hours" fill="hsl(var(--chart-3))" radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </AnalyticsSection>
          )}

          <OverviewProjectsSection
            projects={data.projects}
            title={projectId === 'all' ? 'All projects' : 'Projects in this sprint'}
          />

          <OverviewTaskTable
            rows={data.tasks}
            showProject
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
