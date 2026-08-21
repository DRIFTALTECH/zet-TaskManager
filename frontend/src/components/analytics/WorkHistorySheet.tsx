/**
 * WorkHistorySheet — detailed work history for one employee.
 * Opens from WIP page name click; includes live AI insights from that person's metrics.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Clock, FolderKanban, ListTodo, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { analyticsApi, analyticsExtApi } from '@/lib/analyticsApi';
import type { DateRange } from '@/lib/analyticsApi';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import { AIInsightsPanel } from './AIInsightsPanel';
import { cn } from '@/lib/utils';

interface WorkHistorySheetProps {
  userId: string | null;
  userName: string;
  range: DateRange;
  onClose: () => void;
  /** WIP rows for this person in the current period (optional, enriches AI context). */
  wipProjects?: Array<{
    projectName: string;
    clientName: string;
    totalHours: number;
    tasks: Array<{ taskTitle: string; taskStatus: string; loggedHours: number }>;
  }>;
}

export function WorkHistorySheet({
  userId,
  userName,
  range,
  onClose,
  wipProjects,
}: WorkHistorySheetProps) {
  const open = Boolean(userId);

  const performanceQuery = useQuery({
    queryKey: ['employee-performance', userId, range],
    queryFn: () => analyticsApi.getEmployeePerformance(userId!, range),
    enabled: open,
    staleTime: 60_000,
  });

  const timesheetQuery = useQuery({
    queryKey: ['timesheet-analytics', userId, range],
    queryFn: () => analyticsExtApi.getTimesheetAnalytics(range, userId!),
    enabled: open,
    staleTime: 60_000,
  });

  const insightContext = useMemo(() => {
    const perf = performanceQuery.data;
    const ts = timesheetQuery.data;
    if (!perf && !ts && !wipProjects?.length) return {};

    return {
      dateRange: range,
      employeeId: userId,
      employeeName: userName,
      totalHours: perf?.hours.totalHours ?? ts?.summary.totalHours ?? 0,
      billableHours: perf?.hours.billableHours ?? ts?.summary.billableHours ?? 0,
      activeTasks: perf?.tasks.total ?? 0,
      recentTasks: (perf?.tasks.recent ?? []).slice(0, 8).map((t) => ({
        title: t.title,
        status: t.status,
        projectName: t.projectName,
        dueDate: t.dueDate,
      })),
      projects: (perf?.projectContributions ?? []).map((p) => ({
        name: p.projectName,
        client: p.clientName,
        hours: p.totalHours,
        taskCount: p.tasks.length,
      })),
      currentWork: wipProjects?.map((p) => ({
        project: p.projectName,
        client: p.clientName,
        hours: p.totalHours,
        tasks: p.tasks.map((t) => ({
          title: t.taskTitle,
          status: t.taskStatus,
          hours: t.loggedHours,
        })),
      })),
      timesheet: ts
        ? {
            billablePct: ts.summary.billablePct,
            avgDailyHours: ts.summary.avgDailyHours,
            overtimeDays: ts.summary.overtimeDays,
          }
        : undefined,
    };
  }, [performanceQuery.data, timesheetQuery.data, userId, userName, range, wipProjects]);

  const loading = performanceQuery.isLoading || timesheetQuery.isLoading;
  const perf = performanceQuery.data;
  const ts = timesheetQuery.data;
  const insightReady = !loading && Object.keys(insightContext).length > 0;

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{userName}</SheetTitle>
          <SheetDescription>
            Work history · {range.startDate} → {range.endDate}
          </SheetDescription>
        </SheetHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading work history…
          </div>
        )}

        {(performanceQuery.isError || timesheetQuery.isError) && (
          <p className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-400 mt-4">
            {(performanceQuery.error ?? timesheetQuery.error as Error)?.message ?? 'Failed to load'}
          </p>
        )}

        {!loading && perf && (
          <div className="mt-6 space-y-6">
            {insightReady && (
              <AIInsightsPanel
                key={userId ?? undefined}
                scope="employee_work"
                context={insightContext}
                autoLoad
                variant="inline"
              />
            )}

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" /> Logged Hours
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border/25 bg-muted/20 p-3">
                  <p className="text-[10px] text-muted-foreground">Total</p>
                  <p className="text-lg font-bold">{perf.hours.totalHours}h</p>
                </div>
                <div className="rounded-xl border border-border/25 bg-muted/20 p-3">
                  <p className="text-[10px] text-muted-foreground">Billable</p>
                  <p className="text-lg font-bold">{perf.hours.billableHours}h</p>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <FolderKanban className="h-3.5 w-3.5" /> Projects ({perf.projectContributions.length})
              </h3>
              <ul className="space-y-2 max-h-40 overflow-y-auto">
                {perf.projectContributions.map((p) => (
                  <li key={p.projectId} className="rounded-lg border border-border/20 px-3 py-2 text-sm">
                    <p className="font-medium truncate">{p.projectName}</p>
                    <p className="text-xs text-muted-foreground">{p.totalHours}h logged</p>
                  </li>
                ))}
                {perf.projectContributions.length === 0 && (
                  <p className="text-sm text-muted-foreground/60">No project activity in this period.</p>
                )}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                <ListTodo className="h-3.5 w-3.5" /> Tasks ({perf.tasks.total})
              </h3>
              <ul className="space-y-2 max-h-48 overflow-y-auto">
                {perf.tasks.recent.map((t) => (
                  <li key={t.id} className="rounded-lg border border-border/20 px-3 py-2 text-sm space-y-0.5">
                    <p className="font-medium line-clamp-2">{t.title}</p>
                    <div className="flex gap-2 text-[11px] text-muted-foreground">
                      <span className="capitalize">{t.status.replace('_', ' ')}</span>
                      {t.projectName && <span>· {t.projectName}</span>}
                    </div>
                  </li>
                ))}
                {perf.tasks.recent.length === 0 && (
                  <p className="text-sm text-muted-foreground/60">No recent tasks.</p>
                )}
              </ul>
            </section>

            {ts && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Timesheets
                </h3>
                <div className="rounded-xl border border-border/25 bg-muted/20 p-3 text-sm space-y-1">
                  <p><span className="text-muted-foreground">Billable:</span> {ts.summary.billablePct}% ({ts.summary.billableHours}h)</p>
                  <p><span className="text-muted-foreground">Avg daily:</span> {ts.summary.avgDailyHours}h</p>
                  {ts.summary.overtimeDays > 0 && (
                    <p className={cn('text-amber-600 dark:text-amber-400')}>{ts.summary.overtimeDays} overtime day(s)</p>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
