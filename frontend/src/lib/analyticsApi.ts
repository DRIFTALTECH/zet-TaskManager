/**
 * analyticsApi.ts — API client for all Analytics migration endpoints.
 * 
 * These functions call ZET's backend routes registered under /analytics, /clockify, and /insights.
 * They follow the same pattern as ZET's existing api.ts (fetch + Bearer token from localStorage).
 */

import { getApiUrl } from '@/lib/env';
import { mapInsightContextForLLM } from '@/lib/analyticsLabels';

const TOKEN_KEY = 'tm_token';

function baseUrl() { return getApiUrl(); }

function headers(): HeadersInit {
  const t = localStorage.getItem(TOKEN_KEY);
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t) h['Authorization'] = `Bearer ${t}`;
  return h;
}

async function parseError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    if (typeof j?.detail === 'string') return j.detail;
    if (Array.isArray(j?.detail)) return j.detail.map((x: { msg?: string }) => x.msg).filter(Boolean).join(', ');
  } catch { /* ignore */ }
  return res.statusText || 'Request failed';
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: { ...headers(), ...init?.headers },
  });
  if (!res.ok) throw new Error(await parseError(res));
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface OrgNodeMetrics {
  teamSize: number;
  utilizationPercent: number;
  activeTasks: number;
  activeProjects: number;
  assignedHours: number;
}

export interface OrgNode {
  id: string;
  name: string;
  email: string;
  orgRole: string;
  jobTitle: string;
  managerName: string | null;
  metrics: OrgNodeMetrics;
  children: OrgNode[];
}

export interface OrganizationView {
  summary: { totalEmployees: number; ceos: number; managers: number; employees: number };
  tree: OrgNode[];
  managers: Array<{ id: string; name: string; directReports: number; metrics: OrgNodeMetrics }>;
}

export interface EmployeeRosterRow {
  employeeId: string;
  employeeName: string;
  email: string;
  role: string;
  jobTitle: string;
  isActive: boolean;
  managerId: string | null;
  managerName: string | null;
  totalHours: number;
  billableHours: number;
  utilizationRate: number;
  capacityHours: number;
  rank: number;
}

export interface EmployeePerformance {
  employee: { id: string; name: string; email: string };
  hours: { totalHours: number; billableHours: number; utilizationRate: number; capacityHours: number };
  tasks: { total: number; recent: Array<{ id: string; title: string; status: string; dueDate: string; projectName: string | null; dependsOnTitle: string | null }> };
  projectContributions: Array<{
    projectId: string;
    projectName: string;
    clientName: string | null;
    totalHours: number;
    tasks: Array<{ taskId: string; taskName: string; loggedHours: number; descriptions: string[] }>;
  }>;
}

export interface ClientHoursRow {
  clientId: string;
  clientName: string;
  projectName: string;
  totalHours: number;
  billableHours: number;
  contributionPercent: number;
  employeeCount: number;
  activeProjects: number;
}

export interface WipRow {
  employeeName: string;
  employeeId: string;
  clientName: string;
  projectName: string;
  taskTitle: string;
  taskStatus: string;
  loggedHours: number;
  billable: boolean;
}

export interface WipData {
  summary: {
    activeEmployees: number;
    totalHours: number;
    clientsServed: number;
    projectsInFlight: number;
  };
  rows: WipRow[];
}


export interface InsightsResponse {
  scope: string;
  available?: boolean;
  decision?: string;
  why?: string;
  evidence?: string[];
  recommendation?: string;
  fallbackUsed?: boolean;
}

export type InsightScope =
  | 'project_risks' | 'workload' | 'client_summary'
  | 'manager_summary' | 'executive_summary' | 'overview_team_summary'
  | 'recommendations' | 'bottlenecks'
  | 'timesheet_analytics' | 'capacity_forecast' | 'delivery_risk'
  | 'team_structure' | 'employee_work'
  | 'deadline_forecast' | 'smart_task_reassignment';

// ── Analytics endpoints ───────────────────────────────────────────────────────

export const analyticsApi = {
  getOrganization: (range: DateRange): Promise<OrganizationView> =>
    req(`/analytics/organization?startDate=${range.startDate}&endDate=${range.endDate}`),

  getEmployees: (range: DateRange, managerId?: string): Promise<EmployeeRosterRow[]> => {
    const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
    if (managerId) params.set('managerId', managerId);
    return req(`/analytics/employees?${params}`);
  },

  getEmployeePerformance: (employeeId: string, range: DateRange): Promise<EmployeePerformance> =>
    req(`/analytics/performance/${employeeId}?startDate=${range.startDate}&endDate=${range.endDate}`),

  getClientHours: (range: DateRange): Promise<ClientHoursRow[]> =>
    req(`/analytics/clients?startDate=${range.startDate}&endDate=${range.endDate}`),

  getWip: (range: DateRange, managerId?: string): Promise<WipData> => {
    const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
    if (managerId) params.set('managerId', managerId);
    return req(`/analytics/wip?${params}`);
  },
};



// ── Insights endpoint ─────────────────────────────────────────────────────────

export const insightsApi = {
  generate: (scope: InsightScope, context: Record<string, unknown>): Promise<InsightsResponse> =>
    req('/insights/generate', {
      method: 'POST',
      body: JSON.stringify({ scope, context: mapInsightContextForLLM(context) }),
    }),
};

// ── New Analytics Types ───────────────────────────────────────────────────────

export type ProjectStatusLabel = 'On Track' | 'Needs Attention' | 'At Risk';

export interface OverviewWeeklyTrendPoint {
  weekLabel: string;
  completedTasks: number;
  loggedHours: number;
}

export interface TopContributor {
  userId: string;
  name: string;
  completedTasks: number;
  priorityScore: number;
  loggedHours: number;
  overdueTasks: number;
  contributionScore: number;
}

export interface NeedsAttentionTask extends PriorityTaskRow {
  attentionType: 'blocked' | 'overdue_high_priority' | 'due_today';
}

export interface ProjectProgressCard {
  id: string;
  name: string;
  progress: number;
  totalTasks: number;
  completedTasks: number;
  activeTasks: number;
  overdueTasks: number;
  blockedTasks?: number;
  highPriorityPending?: number;
  loggedHours?: number;
  priorityScore?: number;
  attentionScore?: number;
  atRisk: boolean;
  statusLabel?: ProjectStatusLabel;
}

export interface TopProjectAttention {
  projectId: string;
  projectName: string;
  loggedHours: number;
  activeTasks: number;
  overdueTasks: number;
  attentionScore: number;
}

export interface PriorityTaskRow {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueDate: string;
  projectName: string;
  assigneeName: string;
  isOverdue?: boolean;
}

export interface OverviewDashboard {
  healthScore: number;
  kpis: {
    totalLoggedHours: number;
    activeTasks: number;
    completedTasks: number;
    overdueTasks: number;
    highPriorityPending: number;
    activeProjects: number;
    onTimeCompletionPct: number;
    totalTeam: number;
  };
  weeklyTrend: OverviewWeeklyTrendPoint[];
  topContributors: TopContributor[];
  needsAttentionToday: NeedsAttentionTask[];
  topProjectsByAttention: TopProjectAttention[];
  highPriorityPending: PriorityTaskRow[];
  projectProgress: ProjectProgressCard[];
}

export interface TaskOverviewRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  startedAt: string | null;
  completedAt: string | null;
  isStarted: boolean;
  expectedHours: number | null;
  actualHours: number;
  assigneeIds: string[];
  assigneeNames: string[];
  userStoryId: string | null;
  userStoryTitle: string | null;
  isDone: boolean;
  projectId?: string;
  projectName?: string;
}

export interface TaskOverviewCharts {
  statusMix: { status: string; count: number }[];
  priorityMix: { priority: string; count: number }[];
  expectedVsActual: { expectedHours: number; actualHours: number };
  completionTrend: { weekLabel: string; completedTasks: number }[];
  hoursByProject?: { projectId: string; projectName: string; hours: number }[];
}

export interface TaskOverviewDashboard {
  projectId: string | null;
  tasks: TaskOverviewRow[];
  charts: TaskOverviewCharts;
  projects: { projectId: string; projectName: string; taskCount: number; hours: number }[];
  summary: {
    total: number;
    done: number;
    active: number;
    expectedHours: number;
    actualHours: number;
  };
}

export interface UserOverviewDashboard {
  userId: string;
  userName: string;
  tasks: TaskOverviewRow[];
  charts: TaskOverviewCharts;
  projects: { projectId: string; projectName: string; taskCount: number; hours: number }[];
  summary: {
    total: number;
    done: number;
    active: number;
    expectedHours: number;
    actualHours: number;
  };
}

export interface SprintOption {
  name: string;
  taskCount: number;
}

export interface SprintOverviewDashboard {
  sprint: string;
  projectId: string | null;
  tasks: TaskOverviewRow[];
  charts: TaskOverviewCharts & {
    hoursByPerson?: { userId: string; name: string; hours: number }[];
  };
  people: { userId: string; name: string }[];
  projects: { projectId: string; projectName: string; taskCount: number; hours: number }[];
  summary: {
    total: number;
    done: number;
    active: number;
    projectCount: number;
    peopleCount: number;
    expectedHours: number;
    actualHours: number;
  };
}

export interface DailyBreakdown {
  date: string;
  totalHours: number;
  billableHours: number;
  overtime: boolean;
}

export interface DowPoint {
  day: string;
  hours: number;
}

export interface ProjectContribution {
  projectId: string;
  projectName: string;
  hours: number;
  pct: number;
}

export interface OvertimeDay {
  date: string;
  hours: number;
  overtime: number;
}

export interface TimesheetAnalytics {
  summary: {
    totalHours: number;
    billableHours: number;
    nonBillableHours: number;
    billablePct: number;
    avgDailyHours: number;
    utilizationRate: number;
    capacityHours: number;
    overtimeDays: number;
  };
  dailyBreakdown: DailyBreakdown[];
  weeklyTrend: WeeklyTrendPoint[];
  dowDistribution: DowPoint[];
  projectContribution: ProjectContribution[];
  overtimeDays: OvertimeDay[];
}

export type TaskDueRisk = 'healthy' | 'moderate' | 'high' | 'critical';

export interface TaskDueForecastTask {
  taskId: string;
  title: string;
  dueDate: string;
  projectId?: string | null;
  projectName?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
  priority: string;
  status: string;
  scheduledStartDate: string;
  predictedCompletionDate: string;
  slipDays: number;
  risk: TaskDueRisk;
  assigneeId: string;
  assigneeName: string;
}

export interface TaskDueForecastEmployee {
  userId: string;
  name: string;
  role: string;
  nextAvailableDate: string;
  taskCount: number;
  highCriticalCount?: number;
  dueTomorrow?: number;
  workloadStatus?: 'Overloaded' | 'Available' | 'Balanced';
  tasks: TaskDueForecastTask[];
}

export type DeadlineRiskLabel = 'Healthy' | 'Moderate' | 'High' | 'Critical';

export type TaskForecastStatus = 'On Track' | 'At Risk' | 'Delayed' | 'Completed' | 'Cancelled';

export interface RecommendationFactorScore {
  key: string;
  label: string;
  percent: number;
  weight: number;
  contribution?: number;
  active: boolean;
  reasons?: string[];
}

export interface RecommendationScore {
  overallMatch: number;
  overallLabel: 'Excellent Match' | 'Good Match' | 'Fair Match';
  overallFormula?: string;
  skillMatch: number | null;
  skillApplicable?: boolean;
  availability: number;
  factors?: RecommendationFactorScore[];
}

export interface TaskDueDelayedTask {
  taskId: string;
  taskName: string;
  owner: string;
  dueDate: string;
  priority?: string;
  projectName?: string | null;
  sectionName?: string | null;
  predictedStatus: TaskForecastStatus;
  expectedDelayDays: number;
  reason: string;
  suggestedAssignee: string | null;
  suggestedAssigneeId?: string | null;
  score?: RecommendationScore | null;
  whyBullets?: string[];
  requiredSkills?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  recommendedOwnerFreeBeforeDue?: string | null;
  hidden?: boolean;
}

export interface TaskDueDeadline {
  dueDate: string;
  totalTasks: number;
  onTrackTasks?: number;
  atRiskTasks?: number;
  delayedTasks: number;
  risk: DeadlineRiskLabel;
  tasks?: TaskDueDelayedTask[];
  delayedTaskDetails: TaskDueDelayedTask[];
}

export interface TaskDueReassignment {
  taskId: string;
  taskTitle: string;
  dueDate: string;
  projectName?: string | null;
  sectionName?: string | null;
  priority: string;
  risk: TaskDueRisk;
  currentAssigneeId: string;
  currentAssigneeName: string;
  currentSlipDays: number;
  suggestedAssigneeId: string;
  suggestedAssigneeName: string;
  suggestedSlipDays: number;
  improvementDays: number;
  requiredSkills?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  score?: RecommendationScore | null;
  whyBullets?: string[];
  skillFitScore?: number;
  recommendedOwnerFreeBeforeDue?: string;
  hidden?: boolean;
}

export interface WorkloadEmployeeSummary {
  userId: string;
  name: string;
  taskCount: number;
  highCriticalCount?: number;
  dueTomorrow?: number;
  maxSlipDays?: number;
  nextAvailableDate?: string;
}

export interface TaskDueForecast {
  asOf: string;
  summary: {
    totalTasks: number;
    healthy: number;
    moderate: number;
    high: number;
    critical: number;
    atRisk: number;
    onTrackTasks?: number;
    atRiskTasks?: number;
    reassignmentCount: number;
    upcomingDeadlines: number;
    deadlinesTracked: number;
    deadlinesAtRisk: number;
    delayedTasks: number;
    reassignmentSuggestions: number;
    heavyWorkloadCount?: number;
    availableCapacityCount?: number;
  };
  prediction?: {
    onTrackTasks: number;
    atRiskTasks: number;
    delayedTasks: number;
    upcomingDeadlines: number;
    deadlinesAtRisk: number;
  };
  workload?: {
    heavy: WorkloadEmployeeSummary[];
    available: WorkloadEmployeeSummary[];
  };
  employees: TaskDueForecastEmployee[];
  deadlines: TaskDueDeadline[];
  reassignments: TaskDueReassignment[];
}

export interface SmartTaskReassignmentItem {
  task: string;
  taskId: string;
  dueDate: string;
  priority: string;
  currentOwner: string;
  currentOwnerId: string;
  recommendedOwner: string;
  recommendedOwnerId: string;
  requiredSkills?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  score?: RecommendationScore | null;
  whyBullets?: string[];
  skillFitScore?: number;
  calculations: {
    currentSlipDays: number;
    recommendedSlipDays: number;
    improvementDays: number;
    currentOwnerNextAvailable: string;
    currentOwnerBusyThrough: string;
    recommendedOwnerNextAvailable: string;
    recommendedOwnerFreeBeforeDue: string;
    blockingTasks: string[];
  };
}

export interface SmartTaskReassignment {
  asOf: string;
  module: 'smart_task_reassignment';
  summary: {
    highCriticalTasksReviewed: number;
    atRiskCount: number;
    recommendationCount: number;
  };
  recommendations: SmartTaskReassignmentItem[];
}

// ── Extended analytics endpoints ──────────────────────────────────────────────

export interface WeeklyTrendPoint {
  weekLabel: string;
  weekStart?: string;
  totalHours: number;
  billableHours: number;
  nonBillableHours: number;
}

export interface OverdueTask {
  id: string;
  title: string;
  dueDate: string;
  assigneeName: string;
  status: string;
  priority: string;
  daysOverdue: number;
}

export interface DependencyRisk {
  projectId: string;
  projectName: string;
  soleContributor: string;
  loggedHours: number;
  contributionPercent: number;
  totalHours: number;
}

export interface TeamActivityRow {
  employeeId: string;
  employeeName: string;
  loggedHours: number;
  capacityHours: number;
  utilizationPercent: number;
  status: 'Overloaded' | 'Healthy' | 'Available';
}

export interface WorkloadGroup {
  label: string;
  count: number;
  names: string[];
}

export interface DeliveryRisk {
  summary: {
    overdueTasks: number;
    blockedTasks: number;
    dependencyRisks: number;
    activeTasks: number;
    highPriorityPending: number;
    projectsInProgress: number;
  };
  needsAttentionToday: NeedsAttentionTask[];
  overdueTasks: OverdueTask[];
  blockedTasks: OverdueTask[];
  dependencyRisks: DependencyRisk[];
  highPriorityPending: PriorityTaskRow[];
  projectProgress: ProjectProgressCard[];
}

export const analyticsExtApi = {
  getOverview: (range: DateRange, projectId?: string): Promise<OverviewDashboard> => {
    const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
    if (projectId) params.set('projectId', projectId);
    return req(`/analytics/overview?${params}`);
  },

  getTaskOverview: (projectId?: string, status: 'all' | 'active' | 'done' = 'all'): Promise<TaskOverviewDashboard> => {
    const params = new URLSearchParams({ status });
    if (projectId) params.set('projectId', projectId);
    return req(`/analytics/task-overview?${params}`);
  },

  getUserOverview: (
    userId: string,
    status: 'all' | 'active' | 'done' = 'all',
    projectId?: string,
  ): Promise<UserOverviewDashboard> => {
    const params = new URLSearchParams({ userId, status });
    if (projectId) params.set('projectId', projectId);
    return req(`/analytics/user-overview?${params}`);
  },

  listSprints: (projectId?: string): Promise<{ sprints: SprintOption[] }> => {
    const params = new URLSearchParams();
    if (projectId) params.set('projectId', projectId);
    const q = params.toString();
    return req(q ? `/analytics/sprints?${q}` : '/analytics/sprints');
  },

  getSprintOverview: (
    sprint: string,
    status: 'all' | 'active' | 'done' = 'all',
    projectId?: string,
  ): Promise<SprintOverviewDashboard> => {
    const params = new URLSearchParams({ sprint, status });
    if (projectId) params.set('projectId', projectId);
    return req(`/analytics/sprint-overview?${params}`);
  },

  getTimesheetAnalytics: (range: DateRange, userId?: string): Promise<TimesheetAnalytics> => {
    const params = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
    if (userId) params.set('userId', userId);
    return req(`/analytics/timesheet-analytics?${params}`);
  },

  getForecast: (range?: DateRange): Promise<TaskDueForecast> => {
    const params = new URLSearchParams();
    if (range?.startDate) params.set('startDate', range.startDate);
    if (range?.endDate) params.set('endDate', range.endDate);
    const q = params.toString();
    return req(q ? `/analytics/forecast?${q}` : '/analytics/forecast');
  },

  getUserStoryForecast: (range?: DateRange): Promise<TaskDueForecast> => {
    const params = new URLSearchParams();
    if (range?.startDate) params.set('startDate', range.startDate);
    if (range?.endDate) params.set('endDate', range.endDate);
    const q = params.toString();
    return req(q ? `/analytics/forecast/user-stories?${q}` : '/analytics/forecast/user-stories');
  },

  getSmartReassignment: (): Promise<SmartTaskReassignment> =>
    req('/analytics/smart-reassignment'),

  getDeliveryRisk: (): Promise<DeliveryRisk> =>
    req('/analytics/delivery-risk'),

  setForecastVisibility: (entityType: 'task' | 'user_story', entityId: string, hidden: boolean): Promise<void> =>
    req('/analytics/forecast/visibility', {
      method: 'POST',
      body: JSON.stringify({ entityType, entityId, hidden }),
    }),
};
