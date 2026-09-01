/**
 * Charts shared by Task Overview and User Overview.
 */

import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Legend,
} from 'recharts';
import { AnalyticsSection } from '@/components/analytics/analyticsUi';
import type { TaskOverviewCharts } from '@/lib/analyticsApi';
import { ListTodo, Clock, Flag, TrendingUp, FolderOpen } from 'lucide-react';

const CHART_TOOLTIP = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
};

const STATUS_COLORS: Record<string, string> = {
  backlog: 'hsl(215 16% 55%)',
  in_progress: 'hsl(221 83% 53%)',
  testing: 'hsl(38 92% 50%)',
  in_review: 'hsl(262 83% 58%)',
  done: 'hsl(142 71% 45%)',
  closed: 'hsl(0 0% 50%)',
};

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: 'hsl(0 72% 51%)',
  High: 'hsl(25 95% 53%)',
  Medium: 'hsl(45 93% 47%)',
  Low: 'hsl(142 71% 45%)',
};

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  testing: 'Testing',
  in_review: 'In review',
  done: 'Done',
  closed: 'Closed',
};

export function OverviewCharts({
  charts,
  showProjectHours = false,
}: {
  charts: TaskOverviewCharts;
  showProjectHours?: boolean;
}) {
  const statusData = charts.statusMix.map(s => ({
    ...s,
    label: STATUS_LABEL[s.status] ?? s.status,
  }));
  const timeCompare = [
    { name: 'Expected', hours: charts.expectedVsActual.expectedHours },
    { name: 'Actual', hours: charts.expectedVsActual.actualHours },
  ];

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <AnalyticsSection title="Status mix" icon={ListTodo} iconClassName="text-sky-600 dark:text-sky-400" tone="muted">
        {statusData.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie
                data={statusData}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={42}
                outerRadius={64}
                paddingAngle={2}
              >
                {statusData.map(d => (
                  <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? 'hsl(var(--muted-foreground))'} />
                ))}
              </Pie>
              <Tooltip contentStyle={CHART_TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </AnalyticsSection>

      <AnalyticsSection title="Expected vs actual" icon={Clock} iconClassName="text-emerald-600 dark:text-emerald-400" tone="muted">
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={timeCompare} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--chart-axis))' }} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={32} unit="h" />
            <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
            <Bar dataKey="hours" name="Hours" radius={[4, 4, 0, 0]} barSize={36}>
              {timeCompare.map(d => (
                <Cell
                  key={d.name}
                  fill={d.name === 'Expected' ? 'hsl(var(--chart-2))' : 'hsl(var(--chart-3))'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </AnalyticsSection>

      <AnalyticsSection title="Priority mix" icon={Flag} iconClassName="text-orange-600 dark:text-orange-400" tone="muted">
        {charts.priorityMix.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No data</p>
        ) : (
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={charts.priorityMix} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="priority" tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={24} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
              <Bar dataKey="count" name="Tasks" radius={[4, 4, 0, 0]} barSize={22}>
                {charts.priorityMix.map(d => (
                  <Cell key={d.priority} fill={PRIORITY_COLORS[d.priority] ?? 'hsl(var(--muted-foreground))'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </AnalyticsSection>

      {showProjectHours && charts.hoursByProject ? (
        <AnalyticsSection title="Hours by project" icon={FolderOpen} iconClassName="text-muted-foreground" tone="muted">
          {charts.hoursByProject.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No logged time</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart
                data={charts.hoursByProject.slice(0, 6)}
                layout="vertical"
                margin={{ top: 4, right: 8, bottom: 0, left: 4 }}
              >
                <XAxis type="number" tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} unit="h" />
                <YAxis
                  type="category"
                  dataKey="projectName"
                  width={72}
                  tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }}
                />
                <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                <Bar dataKey="hours" name="Hours" fill="hsl(var(--chart-2))" radius={[0, 4, 4, 0]} barSize={14} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsSection>
      ) : (
        <AnalyticsSection title="Done over time" icon={TrendingUp} iconClassName="text-violet-600 dark:text-violet-400" tone="muted">
          {charts.completionTrend.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No completions yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={charts.completionTrend} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <XAxis
                  dataKey="weekLabel"
                  tick={{ fontSize: 9, fill: 'hsl(var(--chart-axis))' }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--chart-axis))' }} width={24} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP} cursor={{ fill: 'hsl(var(--muted) / 0.3)' }} />
                <Bar dataKey="completedTasks" name="Completed" fill="hsl(var(--chart-2))" radius={[4, 4, 0, 0]} barSize={18} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </AnalyticsSection>
      )}
    </div>
  );
}
