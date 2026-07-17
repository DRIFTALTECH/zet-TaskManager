/**
 * TimesheetAnalyticsPanel.tsx — Analytics panel embedded in the Timesheet page.
 *
 * Shows: weekly trend, billable vs non-billable breakdown,
 * overtime detection, and AI insights.
 * All data computed server-side from ZET's TimesheetEntry records.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { Clock, TrendingUp, DollarSign, AlertCircle } from 'lucide-react';
import { analyticsExtApi } from '@/lib/analyticsApi';
import { AIInsightsPanel } from './AIInsightsPanel';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import type { DateRange } from '@/lib/analyticsApi';

interface Props {
  range: DateRange;
  userId?: string; // undefined → current user
}

function defaultRange(): DateRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 28); // 4 weeks
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function KpiCard({ icon: Icon, label, value, sub, accent }: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'amber' | 'red' | 'blue';
}) {
  const accentCss = {
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    red:   'text-red-400',
    blue:  'text-blue-400',
  }[accent ?? 'blue'];

  return (
    <div className="rounded-2xl border border-border/30 bg-card p-4 space-y-2">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${accentCss}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function TimesheetAnalyticsPanel({ userId }: { userId?: string }) {
  const [range, setRange] = useState<DateRange>(defaultRange);

  const { data, isLoading, error } = useQuery({
    queryKey: ['timesheet-analytics', range, userId],
    queryFn: () => analyticsExtApi.getTimesheetAnalytics(range, userId),
    staleTime: 60_000,
  });

  const insightContext = useMemo(() => {
    if (!data) return {};
    return {
      totalHours: data.summary.totalHours,
      billableHours: data.summary.billableHours,
      billablePct: data.summary.billablePct,
      avgDailyHours: data.summary.avgDailyHours,
      overtimeDays: data.summary.overtimeDays,
      weeklyTrend: data.weeklyTrend.slice(-4),
      overtimeDetail: data.overtimeDays.slice(0, 5),
    };
  }, [data]);

  return (
    <div className="space-y-6 p-6">
      {/* Date range controls */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-muted-foreground">Period:</span>
        <input
          type="date"
          value={range.startDate}
          onChange={e => setRange(r => ({ ...r, startDate: e.target.value }))}
          className="rounded-lg border border-border/40 bg-background px-3 py-1.5 text-sm"
        />
        <span className="text-muted-foreground">→</span>
        <input
          type="date"
          value={range.endDate}
          onChange={e => setRange(r => ({ ...r, endDate: e.target.value }))}
          className="rounded-lg border border-border/40 bg-background px-3 py-1.5 text-sm"
        />
      </div>

      {isLoading && (
        <div className="flex items-center gap-3 text-muted-foreground text-sm py-12 justify-center">
          <div className="h-5 w-5 rounded-full border-2 border-violet-400/30 border-t-violet-400 animate-spin" />
          Loading analytics…
        </div>
      )}

      {error && (
        <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {(error as Error).message}
        </p>
      )}

      {data && (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <KpiCard icon={Clock} label={ANALYTICS_LABELS.loggedHours} value={`${data.summary.totalHours}h`} sub={`${data.summary.billableHours}h billable`} accent="blue" />
            <KpiCard icon={DollarSign} label="Billable" value={`${data.summary.billablePct}%`} sub={`${data.summary.billableHours}h of total`} accent="green" />
            <KpiCard icon={TrendingUp} label="Avg Daily" value={`${data.summary.avgDailyHours}h`} sub="hours per working day" accent="blue" />
            <KpiCard icon={AlertCircle} label="Overtime Days" value={String(data.summary.overtimeDays)} sub=">9 hours logged" accent={data.summary.overtimeDays > 3 ? 'red' : 'amber'} />
          </div>

          {/* Daily hours trend */}
          {data.dailyBreakdown.length > 0 && (
            <section className="rounded-2xl border border-border/30 bg-card p-5 space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Daily Hours</h3>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={data.dailyBreakdown} barSize={12} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    tickFormatter={(d: string) => d.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={28} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                    formatter={(v: number) => [`${v}h`, 'Hours']}
                    labelFormatter={(d: string) => d}
                  />
                  <Bar dataKey="totalHours" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </section>
          )}

          {/* Weekly trend */}
          <section className="rounded-2xl border border-border/30 bg-card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Weekly Hours Trend</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.weeklyTrend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="gBill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gNonBill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="weekLabel" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} width={32} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 12, fontSize: 12 }}
                  formatter={(v: number, name: string) => [`${v}h`, name === 'billableHours' ? 'Billable' : 'Non-Billable']}
                />
                <Area type="monotone" dataKey="billableHours"    stroke="#8b5cf6" fill="url(#gBill)"    strokeWidth={2} name="billableHours" />
                <Area type="monotone" dataKey="nonBillableHours" stroke="#6366f1" fill="url(#gNonBill)" strokeWidth={2} name="nonBillableHours" />
              </AreaChart>
            </ResponsiveContainer>
            <div className="flex gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-500" />Billable</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-indigo-500" />Non-Billable</span>
            </div>
          </section>

          {/* Overtime detection */}
          {data.overtimeDays.length > 0 && (
            <section className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5 space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-amber-300">Overtime Detected</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.overtimeDays.map(d => (
                  <span key={d.date} className="rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                    {d.date} · {d.hours}h (+{d.overtime}h)
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* AI Insights */}
          <AIInsightsPanel
            scope="timesheet_analytics"
            context={insightContext}
            defaultCollapsed={false}
          />
        </>
      )}
    </div>
  );
}
