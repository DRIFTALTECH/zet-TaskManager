/**
 * Plain-language display labels for analytics UI.
 * Internal API field names are unchanged — use these only for user-facing text.
 */

import { healthScoreToCondition } from '@/lib/healthStatus';

export const ANALYTICS_LABELS = {
  loggedHours: 'Logged Hours',
  hoursTrend: 'Hours Trend',
  employeeHours: 'Hours by Person',
  teamHours: 'Team Logged Hours',
  projectStatus: 'Project Status',
  forecastedFinish: 'Likely Finish Date',
  teamSummary: 'Team Summary',
  onTimeCompletion: 'Finished On Time',
  activeTasks: 'Active Tasks',
  completedTasks: 'Completed Tasks',
  overdueTasks: 'Past Due',
  highPriorityPending: 'High-Priority Work',
  blockedTasks: 'Started But Late',
  singlePersonProjects: 'One-Person Projects',
  projectProgress: 'Project Progress',
  forecastHorizons: "What's Coming Up",
  predictedHours: 'Work Planned',
  hoursGap: 'Hours Ahead or Behind',
  spareHours: 'Free Time',
  hoursShort: 'Hours Behind',
  workingDays: 'Work Days',
  horizon: 'Timeframe',
  whoIsBusy: 'Who Is Busy',
  topContributors: 'Top Contributors',
  needsAttentionToday: 'Needs Attention Today',
  weeklyTrend: 'Weekly Trend',
  onTrack: 'On Track',
  needsAttention: 'Needs Attention',
  atRisk: 'At Risk',
  atRiskProjects: 'Projects Needing Attention',
  blockedProjects: 'Projects With Late Open Work',
  highPriorityTasks: 'High Priority Tasks',
  deliveryRisk: 'Will We Be Late?',
  whatWillHappenNext: 'What Will Happen Next?',
  timeWeHave: 'Time We Have',
  workPlanned: 'Work Planned',
  freeTime: 'Free Time',
  peopleWhoNeedHelp: 'People Who Need Help',
} as const;

/** Short helper text under KPI cards — plain language for non-technical readers. */
export const ANALYTICS_LABEL_SUBS = {
  atRiskProjects: 'overdue or late open work',
  blockedProjects: 'someone started work but missed the due date',
  highPriorityTasks: 'urgent or high priority, still open',
} as const;

export const FORECAST_QUESTION_ORDER = [
  'finish_on_time',
  'projects_attention',
  'take_new_project',
  'who_needs_help',
  'what_to_do_next',
] as const;

export const FORECAST_KIND_LABELS: Record<string, string> = {
  finish_on_time: 'Will we finish on time?',
  projects_attention: 'Which projects need attention?',
  take_new_project: 'Can we take another project?',
  who_needs_help: 'Who needs help?',
  what_to_do_next: 'What should we do next?',
};

/** Map internal context keys to plain labels for LLM prompts (not shown in UI). */
const INSIGHT_CONTEXT_KEY_LABELS: Record<string, string> = {
  healthScore: 'Overall Condition',
  overallCondition: 'Overall Condition',
  totalLoggedHours: ANALYTICS_LABELS.loggedHours,
  activeTasks: ANALYTICS_LABELS.activeTasks,
  completedTasks: ANALYTICS_LABELS.completedTasks,
  overdueTasks: ANALYTICS_LABELS.overdueTasks,
  highPriorityPending: ANALYTICS_LABELS.highPriorityPending,
  activeProjects: 'Active Projects',
  onTimeCompletionPct: ANALYTICS_LABELS.onTimeCompletion,
  totalTeam: 'Team Size',
  topProjectsByAttention: 'Projects Getting Most Attention',
  projectProgress: ANALYTICS_LABELS.projectProgress,
  blockedTasks: ANALYTICS_LABELS.blockedTasks,
  blockedProjects: ANALYTICS_LABELS.blockedProjects,
  atRiskProjects: ANALYTICS_LABELS.atRiskProjects,
  dependencyRisks: ANALYTICS_LABELS.singlePersonProjects,
  projectsInProgress: 'Projects With Open Work',
  totalHours: ANALYTICS_LABELS.loggedHours,
  billableHours: 'Billable Hours',
  billablePct: 'Billable Share',
  avgDailyHours: 'Average Daily Hours',
  overtimeDays: 'Overtime Days',
  topProject: 'Project With Most Hours',
  topProjectPct: 'Share of Hours on Top Project',
  forecastItem: 'Forecast Type',
  horizon: ANALYTICS_LABELS.horizon,
  workingDays: ANALYTICS_LABELS.workingDays,
  capacity: ANALYTICS_LABELS.timeWeHave,
  demand: ANALYTICS_LABELS.workPlanned,
  gap: ANALYTICS_LABELS.hoursGap,
  bench: ANALYTICS_LABELS.freeTime,
  shortage: ANALYTICS_LABELS.hoursShort,
  metrics: 'Key Numbers',
  employeeName: 'Person',
  projectCount: 'Project Count',
  dateRange: 'Date Range',
  recentTasks: 'Recent Tasks',
  currentWork: 'Current Work',
  projects: 'Projects',
  timesheet: 'Timesheet Summary',
  metric: 'Metric',
  count: 'Count',
  project: 'Project',
  projectName: 'Project',
  hours: ANALYTICS_LABELS.loggedHours,
  loggedHours: ANALYTICS_LABELS.loggedHours,
  attentionScore: 'Attention Score',
  priority: 'Priority',
  status: 'Status',
  dueDate: 'Due Date',
  assigneeName: 'Assigned To',
  title: 'Task',
  name: 'Name',
  role: 'Role',
  weeklyHours: 'Hours This Week',
  teamSize: 'Team Size',
  topContributors: ANALYTICS_LABELS.topContributors,
  needsAttentionToday: ANALYTICS_LABELS.needsAttentionToday,
  weeklyTrend: ANALYTICS_LABELS.weeklyTrend,
  contributionScore: 'Contribution Score',
  statusLabel: 'Status',
  attentionType: 'Reason',
  priorityScore: 'Priority Score',
};

function humanizeContextKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
    .trim();
}

function mapInsightContextValue(key: string, value: unknown): unknown {
  if (key === 'attentionType' && typeof value === 'string') {
    const labels: Record<string, string> = {
      blocked: ANALYTICS_LABELS.blockedTasks,
      overdue_high_priority: 'Overdue high-priority',
      due_today: 'Due today',
    };
    return labels[value] ?? humanizeContextKey(value);
  }
  if (key === 'forecastItem' && typeof value === 'string') {
    return FORECAST_KIND_LABELS[value] ?? humanizeContextKey(value);
  }
  if (key === 'scope' && typeof value === 'string') {
    return value === 'single_user' ? 'Individual' : 'Team';
  }
  if (key === 'metric' && typeof value === 'string') {
    return INSIGHT_CONTEXT_KEY_LABELS[value] ?? humanizeContextKey(value);
  }
  return value;
}

/** Rewrite analytics context keys/values into plain language before LLM calls. */
export function mapInsightContextForLLM(context: Record<string, unknown>): Record<string, unknown> {
  const prepared: Record<string, unknown> = { ...context };
  if (typeof prepared.healthScore === 'number') {
    prepared.overallCondition = healthScoreToCondition(prepared.healthScore);
    delete prepared.healthScore;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(prepared)) {
    const label = INSIGHT_CONTEXT_KEY_LABELS[key] ?? humanizeContextKey(key);
    if (Array.isArray(value)) {
      result[label] = value.map((item) =>
        typeof item === 'object' && item !== null && !Array.isArray(item)
          ? mapInsightContextForLLM(item as Record<string, unknown>)
          : item,
      );
    } else if (typeof value === 'object' && value !== null) {
      result[label] = mapInsightContextForLLM(value as Record<string, unknown>);
    } else {
      result[label] = mapInsightContextValue(key, value);
    }
  }
  return result;
}
