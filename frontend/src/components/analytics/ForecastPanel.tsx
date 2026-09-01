/**
 * ForecastPanel — "What Will Happen Next?" forecast and capacity recommendations.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarClock, Info, Loader2, Sparkles, Users } from 'lucide-react';
import { analyticsExtApi, insightsApi } from '@/lib/analyticsApi';
import type {
  TaskDueDeadline,
  TaskDueDelayedTask,
  TaskDueForecastEmployee,
  TaskDueReassignment,
  TaskForecastStatus,
  DeadlineRiskLabel,
} from '@/lib/analyticsApi';
import { AIInsightsPanel } from '@/components/analytics/AIInsightsPanel';
import { RecommendationCard } from '@/components/analytics/RecommendationScoreCard';
import { insightQueryKey } from '@/hooks/useInsightGenerate';
import {
  recommendationInsightSummary,
  workloadLevelFromEmployee,
  workloadLevelFromTaskCount,
  type WorkloadLevel,
} from '@/lib/recommendationDisplay';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const RECOMMENDED_OWNER_TOOLTIP =
  'A suggested teammate who may have time and the right skills. You choose whether to assign them — nothing happens automatically.';

export type ForecastLevel = 'task' | 'user_story';

const LEVEL_COPY = {
  task: {
    workItem: 'Task',
    workItemLower: 'task',
    workItems: 'tasks',
    emptyEmployee: 'No active tasks in this date range.',
    emptyDeadlines: 'No upcoming deadlines with due dates.',
    freeTimeHint: 'Click to view tasks',
    freeTimeCount: (n: number) => `${n} open task${n !== 1 ? 's' : ''}`,
    helpBlurb: 'People who may have time and the right skills. You decide who gets the task.',
    emptySuggestions: 'No suggestions right now — everyone is busy or already on track.',
    managerNote: 'These are suggestions only. The manager chooses who takes each task.',
    loading: 'Loading forecast…',
  },
  user_story: {
    workItem: 'User story',
    workItemLower: 'user story',
    workItems: 'user stories',
    emptyEmployee: 'No active user stories in this date range.',
    emptyDeadlines: 'No upcoming user-story deadlines with due dates.',
    freeTimeHint: 'Click to view user stories',
    freeTimeCount: (n: number) => `${n} open user stor${n !== 1 ? 'ies' : 'y'}`,
    helpBlurb: 'People who may have time and the right skills. You decide who gets the user story.',
    emptySuggestions: 'No suggestions right now — everyone is busy or already on track.',
    managerNote: 'These are suggestions only. The manager chooses who takes each user story.',
    loading: 'Loading user story forecast…',
  },
} as const;

type WorkloadLookup = (userId?: string | null) => WorkloadLevel | undefined;

function employeeMap(employees: TaskDueForecastEmployee[]) {
  return new Map(employees.map(e => [e.userId, e]));
}

function makeWorkloadLookup(empById: Map<string, TaskDueForecastEmployee>): WorkloadLookup {
  return (userId?: string | null) => {
    if (!userId) return undefined;
    return workloadLevelFromEmployee(empById.get(userId));
  };
}

const STATUS_STYLE: Record<TaskForecastStatus, string> = {
  'On Track': 'text-emerald-600 dark:text-emerald-400',
  'At Risk': 'text-amber-600 dark:text-amber-400',
  Delayed: 'text-red-600 dark:text-red-400',
  Completed: 'text-emerald-600 dark:text-emerald-400',
  Cancelled: 'text-gray-400',
};

/** Hide exact delay-day counts from user-facing copy while keeping qualitative reasons. */
function scrubDelayDays(text: string): string {
  return text
    .replace(/\babout\s+\d+\s+day\(s\)\s+/gi, '')
    .replace(/\b\d+\s+day\(s\)\s+(late|behind|slip)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

const RISK_CHIP: Record<DeadlineRiskLabel, string> = {
  Healthy: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  Moderate: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
  High: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/25',
  Critical: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/25',
};

function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex text-muted-foreground/45 hover:text-muted-foreground/80 transition-colors"
          aria-label="More info"
        >
          <Info className="h-3 w-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[16rem] text-xs leading-relaxed">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function FieldLabel({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold inline-flex items-center gap-1">
      {children}
      {tip && <InfoTip text={tip} />}
    </p>
  );
}

function RiskBadge({ risk }: { risk: DeadlineRiskLabel }) {
  return (
    <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-bold', RISK_CHIP[risk])}>
      {risk}
    </span>
  );
}

function SummaryStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex-1 min-w-[4.5rem] text-center px-2 py-2">
      <p className="text-lg font-bold tabular-nums text-foreground">{value}</p>
      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{label}</p>
    </div>
  );
}

function EmployeeActiveTasksDialog({
  employee,
  open,
  onOpenChange,
  level,
}: {
  employee: TaskDueForecastEmployee | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  level: ForecastLevel;
}) {
  const copy = LEVEL_COPY[level];
  const count = employee?.taskCount ?? 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{employee?.name ?? 'Team member'}</DialogTitle>
          <DialogDescription>
            {count} active {count === 1 ? copy.workItemLower : copy.workItems}
            {employee?.workloadStatus ? ` · ${employee.workloadStatus}` : ''}
            {employee?.nextAvailableDate ? ` · free from ${employee.nextAvailableDate}` : ''}
          </DialogDescription>
        </DialogHeader>
        {employee?.tasks.length ? (
          <ul className="space-y-2 max-h-[min(50vh,20rem)] overflow-y-auto pr-1">
            {employee.tasks.map(t => (
              <li key={t.taskId} className="rounded-lg border border-border/30 bg-muted/[0.03] px-3 py-2.5">
                <p className="text-sm font-medium text-foreground">{t.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Due {t.dueDate}
                  {t.sectionName ? ` · ${t.sectionName}` : ''}
                  {t.projectName ? ` · ${t.projectName}` : ''}
                  {t.priority ? ` · ${t.priority}` : ''}
                </p>
                <p className="text-[10px] text-muted-foreground/60 mt-0.5 capitalize">
                  {(t.status || '').replace(/_/g, ' ')}
                  {t.slipDays > 0 ? ` · ${t.slipDays}d behind` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">{copy.emptyEmployee}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ForecastTaskRow({
  task,
  workloadFor,
  level,
  onMarkCompleted,
  onRestore,
}: {
  task: TaskDueDelayedTask;
  workloadFor: WorkloadLookup;
  level: ForecastLevel;
  onMarkCompleted?: () => void;
  onRestore?: () => void;
}) {
  return (
    <RecommendationCard
      taskTitle={task.taskName}
      projectName={task.projectName}
      sectionName={task.sectionName}
      currentOwnerName={task.owner}
      dueDate={task.dueDate}
      expectedResult={task.predictedStatus}
      hasRecommendation={!!task.suggestedAssignee}
      recommendedOwnerName={task.suggestedAssignee}
      recommendedOwnerId={task.suggestedAssigneeId}
      requiredSkills={task.requiredSkills}
      matchedSkills={task.matchedSkills}
      missingSkills={task.missingSkills}
      availableFrom={task.recommendedOwnerFreeBeforeDue}
      workload={task.suggestedAssigneeId ? workloadFor(task.suggestedAssigneeId) : undefined}
      whyBullets={task.whyBullets}
      scheduleReason={task.reason ? scrubDelayDays(task.reason) : null}
      forecastHidden={task.hidden}
      onMarkCompleted={onMarkCompleted}
      onRestore={onRestore}
    />
  );
}

function ReassignmentRow({
  item,
  workloadFor,
  onViewEmployee,
  level,
  onMarkCompleted,
  onRestore,
}: {
  item: TaskDueReassignment;
  workloadFor: WorkloadLookup;
  onViewEmployee?: (userId: string) => void;
  level: ForecastLevel;
  onMarkCompleted?: () => void;
  onRestore?: () => void;
}) {
  return (
    <RecommendationCard
      taskTitle={item.taskTitle}
      projectName={item.projectName}
      sectionName={item.sectionName}
      currentOwnerName={item.currentAssigneeName}
      currentOwnerId={item.currentAssigneeId}
      dueDate={item.dueDate}
      expectedResult="At Risk"
      hasRecommendation={true}
      recommendedOwnerName={item.suggestedAssigneeName}
      recommendedOwnerId={item.suggestedAssigneeId}
      requiredSkills={item.requiredSkills}
      matchedSkills={item.matchedSkills}
      missingSkills={item.missingSkills}
      availableFrom={item.recommendedOwnerFreeBeforeDue}
      workload={item.suggestedAssigneeId ? workloadFor(item.suggestedAssigneeId) : undefined}
      whyBullets={item.whyBullets}
      onViewEmployee={onViewEmployee}
      onAssigneeClick={onViewEmployee ? () => onViewEmployee(item.suggestedAssigneeId) : undefined}
      forecastHidden={item.hidden}
      onMarkCompleted={onMarkCompleted}
      onRestore={onRestore}
    />
  );
}

function deadlineTasks(deadline: TaskDueDeadline): TaskDueDelayedTask[] {
  return deadline.tasks ?? deadline.delayedTaskDetails ?? [];
}

function DeadlineCard({
  deadline,
  workloadFor,
  level,
  onToggleVisibility,
}: {
  deadline: TaskDueDeadline;
  workloadFor: WorkloadLookup;
  level: ForecastLevel;
  onToggleVisibility?: (taskId: string, hidden: boolean) => void;
}) {
  const tasks = deadlineTasks(deadline);
  // Only show active (non-hidden) tasks in this card; hidden ones go to the completed section
  const activeTasks = tasks.filter(t => !t.hidden);
  return (
    <article className="rounded-xl border border-border/40 bg-card/50 overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 border-b border-border/25 bg-muted/[0.04]">
        <CalendarClock className="h-4 w-4 text-blue-600 dark:text-blue-400 shrink-0" />
        <div className="flex flex-wrap items-center gap-2 min-w-0 flex-1">
          <div>
            <FieldLabel>Due Date</FieldLabel>
            <p className="text-sm font-semibold text-foreground tabular-nums">{deadline.dueDate}</p>
          </div>
          <RiskBadge risk={deadline.risk} />
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="text-right">
            <FieldLabel>Total</FieldLabel>
            <p className="text-sm font-semibold tabular-nums text-foreground">{deadline.totalTasks}</p>
          </div>
          {deadline.onTrackTasks != null && (
            <div className="text-right">
              <FieldLabel>On Track</FieldLabel>
              <p className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{deadline.onTrackTasks}</p>
            </div>
          )}
          {deadline.atRiskTasks != null && deadline.atRiskTasks > 0 && (
            <div className="text-right">
              <FieldLabel>At Risk</FieldLabel>
              <p className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">{deadline.atRiskTasks}</p>
            </div>
          )}
          {deadline.delayedTasks > 0 && (
            <div className="text-right">
              <FieldLabel>Delayed</FieldLabel>
              <p className="text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">{deadline.delayedTasks}</p>
            </div>
          )}
        </div>
      </header>

      {activeTasks.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          {activeTasks.map((t, i) => (
            <ForecastTaskRow
              key={`${t.taskId ?? t.taskName}-${t.owner}-${i}`}
              task={t}
              workloadFor={workloadFor}
              level={level}
              onMarkCompleted={onToggleVisibility && t.taskId ? () => onToggleVisibility(t.taskId, true) : undefined}
            />
          ))}
        </div>
      )}
    </article>
  );
}


export type ForecastRefreshControls = {
  refresh: () => Promise<void>;
  isRefreshing: boolean;
};

interface ForecastPanelProps {
  enabled?: boolean;
  variant?: 'dialog' | 'page';
  /** Separate modes — task vs user story forecasts never mix. */
  level?: ForecastLevel;
  dateRange?: { startDate: string; endDate: string };
  onRefreshControls?: (controls: ForecastRefreshControls | null) => void;
}

function forecastInsightContext(
  data: NonNullable<Awaited<ReturnType<typeof analyticsExtApi.getForecast>>>,
  level: ForecastLevel,
) {
  const empById = employeeMap(data.employees ?? []);
  const workloadFor = makeWorkloadLookup(empById);
  const copy = LEVEL_COPY[level];

  const teammatesWithFreeTime = (data.workload?.available ?? []).slice(0, 8).map(p => ({
    name: p.name,
    workload: workloadLevelFromEmployee(empById.get(p.userId)) ?? workloadLevelFromTaskCount(p.taskCount),
    availableFrom: p.nextAvailableDate,
    openTasks: p.taskCount,
  }));

  const suggestions = [
    ...(data.reassignments ?? []).slice(0, 6).map(r =>
      recommendationInsightSummary({
        taskTitle: r.taskTitle,
        currentAssigneeName: r.currentAssigneeName,
        suggestedName: r.suggestedAssigneeName,
        matchedSkills: r.matchedSkills,
        missingSkills: r.missingSkills,
        requiredSkills: r.requiredSkills,
        whyBullets: r.whyBullets,
        availableFrom: r.recommendedOwnerFreeBeforeDue,
        workload: workloadFor(r.suggestedAssigneeId),
      }),
    ),
    ...data.deadlines.flatMap(d =>
      deadlineTasks(d)
        .filter(t => t.suggestedAssignee)
        .slice(0, 4)
        .map(t =>
          recommendationInsightSummary({
            taskName: t.taskName,
            currentOwner: t.owner,
            suggestedName: t.suggestedAssignee!,
            matchedSkills: t.matchedSkills,
            missingSkills: t.missingSkills,
            requiredSkills: t.requiredSkills,
            whyBullets: t.whyBullets,
            availableFrom: t.recommendedOwnerFreeBeforeDue,
            workload: workloadFor(t.suggestedAssigneeId),
          }),
        ),
    ),
  ];

  const deadlines = data.deadlines
    .filter(d => (d.atRiskTasks ?? 0) > 0 || d.delayedTasks > 0)
    .slice(0, 6)
    .map(d => ({
      dueDate: d.dueDate,
      risk: d.risk,
      totalTasks: d.totalTasks,
      atRiskTasks: d.atRiskTasks,
      delayedTasks: d.delayedTasks,
      tasks: deadlineTasks(d)
        .filter(t => t.predictedStatus !== 'On Track')
        .slice(0, 4)
        .map(t => ({
          taskName: t.taskName,
          owner: t.owner,
          predictedStatus: t.predictedStatus,
          suggestedAssignee: t.suggestedAssignee,
        })),
    }));

  return {
    asOf: data.asOf,
    forecastLevel: level,
    summary: {
      onTrackTasks: data.prediction?.onTrackTasks ?? data.summary.onTrackTasks,
      atRiskTasks: data.prediction?.atRiskTasks ?? data.summary.atRiskTasks,
      delayedTasks: data.prediction?.delayedTasks ?? data.summary.delayedTasks,
      suggestionCount: data.reassignments?.length ?? 0,
    },
    suggestions,
    teammatesWithFreeTime,
    deadlines,
    managerNote: copy.managerNote,
  };
}

export function ForecastPanel({
  enabled = true,
  variant = 'dialog',
  level = 'task',
  dateRange,
  onRefreshControls,
}: ForecastPanelProps) {
  const queryClient = useQueryClient();
  const [insightRefreshing, setInsightRefreshing] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const isPage = variant === 'page';
  const copy = LEVEL_COPY[level];

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['forecast', level, dateRange?.startDate, dateRange?.endDate],
    queryFn: () =>
      level === 'user_story'
        ? analyticsExtApi.getUserStoryForecast(dateRange)
        : analyticsExtApi.getForecast(dateRange),
    staleTime: 0,
    enabled,
  });

  const llmContext = useMemo(() => (data ? forecastInsightContext(data, level) : null), [data, level]);

  // Prefetch AI insights as soon as forecast data arrives (shared cache with AIInsightsPanel).
  useQuery({
    queryKey: llmContext ? insightQueryKey('deadline_forecast', llmContext) : ['insight', 'deadline_forecast', 'pending'],
    queryFn: () => insightsApi.generate('deadline_forecast', llmContext!),
    enabled: !!llmContext,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const refreshAll = useCallback(async () => {
    const { data: newData } = await refetch();
    if (!newData) return;
    const ctx = forecastInsightContext(newData, level);
    setInsightRefreshing(true);
    try {
      await queryClient.fetchQuery({
        queryKey: insightQueryKey('deadline_forecast', ctx),
        queryFn: () => insightsApi.generate('deadline_forecast', ctx),
        staleTime: 0,
      });
    } finally {
      setInsightRefreshing(false);
    }
  }, [refetch, queryClient, level]);

  const isRefreshing = isFetching || insightRefreshing;

  useEffect(() => {
    if (!enabled || !onRefreshControls) {
      onRefreshControls?.(null);
      return;
    }
    onRefreshControls({ refresh: refreshAll, isRefreshing });
  }, [enabled, onRefreshControls, refreshAll, isRefreshing]);

  const employeeById = useMemo(
    () => new Map((data?.employees ?? []).map(e => [e.userId, e])),
    [data?.employees],
  );
  const selectedEmployee = selectedEmployeeId ? employeeById.get(selectedEmployeeId) ?? null : null;
  const openEmployeeTasks = useCallback((userId: string) => setSelectedEmployeeId(userId), []);

  const [isCompletedExpanded, setIsCompletedExpanded] = useState(false);
  const [pendingVisibility, setPendingVisibility] = useState(false);

  const handleToggleVisibility = useCallback(async (
    taskId: string,
    hidden: boolean,
  ) => {
    const entityType = level === 'user_story' ? 'user_story' : 'task';
    setPendingVisibility(true);
    try {
      await analyticsExtApi.setForecastVisibility(entityType, taskId, hidden);
      void refetch();
    } finally {
      setPendingVisibility(false);
    }
  }, [level, refetch]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground text-sm">
        <Loader2 className="h-6 w-6 animate-spin text-violet-600 dark:text-violet-400" />
        {copy.loading}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-4 text-sm text-red-600 dark:text-red-400 space-y-2">
        <p>{(error as Error).message}</p>
        <button type="button" onClick={() => void refetch()} className="text-xs font-medium underline hover:no-underline">
          Try again
        </button>
      </div>
    );
  }

  if (!data || !llmContext) {
    return <p className="text-sm text-muted-foreground py-8 text-center">No forecast data.</p>;
  }

  const s = data.summary;
  const prediction = data.prediction;
  const reassignments = data.reassignments ?? [];
  const available = data.workload?.available ?? [];
  const workloadFor = makeWorkloadLookup(employeeMap(data.employees ?? []));

  // Split active vs hidden reassignments
  const activeReassignments = reassignments.filter(r => !r.hidden);
  const hiddenReassignments = reassignments.filter(r => r.hidden);

  // Collect hidden deadline tasks (from all deadlines)
  const hiddenDeadlineTasks: Array<{ task: TaskDueDelayedTask; }> = [];
  for (const d of data.deadlines) {
    const tasks = deadlineTasks(d);
    for (const t of tasks) {
      if (t.hidden) hiddenDeadlineTasks.push({ task: t });
    }
  }

  const totalCompleted = hiddenReassignments.length + hiddenDeadlineTasks.length;

  return (
    <TooltipProvider delayDuration={200}>
      <EmployeeActiveTasksDialog
        employee={selectedEmployee}
        open={!!selectedEmployeeId}
        onOpenChange={open => { if (!open) setSelectedEmployeeId(null); }}
        level={level}
      />
      <div className={cn('space-y-6 relative', (isRefreshing || pendingVisibility) && 'pointer-events-none')}>
        {(isRefreshing || pendingVisibility) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/70">
            <Loader2 className="h-6 w-6 animate-spin text-violet-600 dark:text-violet-400" />
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">As of {data.asOf}</p>

        <div className="flex divide-x divide-border/30 rounded-xl border border-border/35 bg-muted/[0.04] overflow-hidden">
          <SummaryStat label="On Track" value={prediction?.onTrackTasks ?? s.onTrackTasks ?? 0} />
          <SummaryStat label="At Risk" value={prediction?.atRiskTasks ?? s.atRiskTasks ?? s.atRisk ?? 0} />
          <SummaryStat label="Delayed" value={prediction?.delayedTasks ?? s.delayedTasks ?? 0} />
          {isPage && (
            <SummaryStat label="Suggestions" value={activeReassignments.length} />
          )}
        </div>

        <AIInsightsPanel
          scope="deadline_forecast"
          context={llmContext}
          title="Help choosing who to assign"
          variant="inline"
          autoLoad
        />

        {isPage && (
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-sm font-semibold text-foreground">People with free time</h2>
            </div>
            {available.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {available.map(person => (
                  <button
                    key={person.userId}
                    type="button"
                    onClick={() => openEmployeeTasks(person.userId)}
                    className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-left hover:bg-emerald-500/10 hover:border-emerald-500/35 transition-colors"
                  >
                    <p className="font-semibold text-foreground hover:text-primary">{person.name}</p>
                    <p className="text-muted-foreground/70 mt-0.5">
                      {copy.freeTimeCount(person.taskCount)}
                      {person.nextAvailableDate ? ` · free from ${person.nextAvailableDate}` : ''}
                    </p>
                    <p className="text-[10px] text-emerald-500/80 mt-1">{copy.freeTimeHint}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">No teammates with light workload right now.</p>
            )}
          </section>
        )}

        {isPage && (
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-400" />
              <div>
                <h2 className="text-sm font-semibold text-foreground">Who could help?</h2>
                <p className="text-xs text-muted-foreground/70 mt-0.5">
                  {copy.helpBlurb}
                </p>
              </div>
            </div>
            {activeReassignments.length > 0 ? (
              <div className="space-y-2">
                {activeReassignments.map(item => (
                  <ReassignmentRow
                    key={item.taskId}
                    item={item}
                    workloadFor={workloadFor}
                    onViewEmployee={openEmployeeTasks}
                    level={level}
                    onMarkCompleted={() => void handleToggleVisibility(item.taskId, true)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">
                {copy.emptySuggestions}
              </p>
            )}
          </section>
        )}

        <section className="space-y-3">
          {isPage && (
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-semibold text-foreground">Deadline outlook</h2>
            </div>
          )}
          {data.deadlines.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">{copy.emptyDeadlines}</p>
          ) : (
            <div
              className={cn(
                'space-y-3 pr-0.5',
                isPage ? '' : 'max-h-[min(40vh,22rem)] overflow-y-auto',
              )}
            >
              {data.deadlines.map(d => (
                <DeadlineCard
                  key={d.dueDate}
                  deadline={d}
                  workloadFor={workloadFor}
                  level={level}
                  onToggleVisibility={handleToggleVisibility}
                />
              ))}
            </div>
          )}
        </section>

        {/* Completed Forecast Items — collapsible section below active items */}
        {totalCompleted > 0 && (
          <section className="space-y-2">
            <button
              type="button"
              onClick={() => setIsCompletedExpanded(prev => !prev)}
              className="flex items-center gap-2 w-full text-left group py-2 border-t border-border/20 hover:border-border/40 transition-colors"
            >
              <span className={cn(
                'text-xs transition-transform duration-200 text-muted-foreground/60',
                isCompletedExpanded ? 'rotate-90' : 'rotate-0',
              )}>
                ▶
              </span>
              <span className="text-sm font-semibold text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">
                Completed Forecast Items
              </span>
              <span className="ml-auto text-xs font-medium text-emerald-400/80 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
                {totalCompleted}
              </span>
            </button>

            {isCompletedExpanded && (
              <div className="space-y-2 pt-1">
                {hiddenDeadlineTasks.map(({ task }, i) => (
                  <ForecastTaskRow
                    key={`hidden-deadline-${task.taskId ?? task.taskName}-${i}`}
                    task={task}
                    workloadFor={workloadFor}
                    level={level}
                    onRestore={task.taskId ? () => void handleToggleVisibility(task.taskId, false) : undefined}
                  />
                ))}
                {hiddenReassignments.map(item => (
                  <ReassignmentRow
                    key={`hidden-reassign-${item.taskId}`}
                    item={item}
                    workloadFor={workloadFor}
                    onViewEmployee={openEmployeeTasks}
                    level={level}
                    onRestore={() => void handleToggleVisibility(item.taskId, false)}
                  />
                ))}
              </div>
            )}
          </section>
        )}

      </div>
    </TooltipProvider>
  );
}

