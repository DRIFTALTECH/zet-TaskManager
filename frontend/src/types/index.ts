export type Role = 'superadmin' | 'manager' | 'employee';
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TaskStatus = string;

export interface KanbanColumn {
  id: string;
  label: string;
  /** Palette key from lib/column-colors — not a hex value. */
  color?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatar: string;
  projectIds: string[];
  jobTitle: string;
  experienceMonths: number;
  joinedAt: string;
  currentExperienceMonths: number;
  /** Admin can deactivate accounts; deactivated users cannot log in. */
  isActive?: boolean;
  /** Line manager for timesheet approval routing (admin-assigned). */
  managerId?: string | null;
  /** Skill names assigned to this user. */
  skills?: string[];
}

export interface Section {
  id: string;
  name: string;
  projectId: string;
}

export interface Client {
  id: string;
  name: string;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  clientId?: string | null;
  clientName?: string | null;
  createdBy: string;
  members: string[];
  sections: Section[];
  createdAt: string;
  /** Optional project background image (URL or data URL) — used as card/header background. */
  backgroundImage?: string;
  /** Accent hex derived from the background image (drives charts/header tint). */
  accentColor?: string;
  /** Optional project photo (URL or data URL) — replaces the folder icon. */
  projectImage?: string;
  /** Server-managed private workspace; only visible to the owner */
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  sectionId: string;
  /** First assignee (primary); same as assigneeIds[0] when list is non-empty */
  assignedTo: string;
  /** Everyone assigned to this task, in order (first is primary) */
  assigneeIds: string[];
  assignedBy: string;
  createdBy: string;
  dueDate: string;
  sprint: string;
  priority: Priority;
  status: TaskStatus;
  isStarted: boolean;
  startedAt?: string;
  completedAt?: string;
  approvedByManager: boolean;
  timeTracked: number;
  minLogMinutes: number;
  /** Optional effort estimate in hours. Null/undefined = not set. */
  estimatedHours?: number | null;
  tags: string[];
  createdAt: string;
  timeLog: Record<string, number>; // date (YYYY-MM-DD) -> seconds logged by current user
  customFields?: Record<string, string>; // user-defined key-value metadata
  /** Additive: optional user story link (null/undefined = legacy standalone task) */
  userStoryId?: string | null;
  /** Additive: parent task for nested subtasks (null = top-level) */
  parentTaskId?: string | null;
}

export interface UserStory {
  id: string;
  projectId: string;
  sectionId?: string | null;
  /** Set when this story sits under another (epic → story). */
  parentStoryId?: string | null;
  title: string;
  description: string;
  acceptanceCriteria: string;
  priority: Priority | string;
  status: string;
  assigneeId?: string | null;
  /** Multi-assignee (mirrors task.assigneeIds); assigneeId is primary/first. */
  assigneeIds?: string[];
  reporterId: string;
  /** Rolled up from linked tasks — not stored on the story. */
  estimatedHours?: number | null;
  actualHours?: number | null;
  storyPoints?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  sprint?: string;
  tags?: string[];
  approvedByManager?: boolean;
  createdAt: string;
  updatedAt: string;
  progressPercent: number;
  taskCount: number;
  completedTaskCount: number;
  subtaskCount: number;
  completedSubtaskCount: number;
}

export interface GeneratedSubtaskPreview {
  key: string;
  title: string;
  description?: string;
}

export interface GeneratedTaskPreview {
  key: string;
  title: string;
  description?: string;
  priority?: string;
  subtasks: GeneratedSubtaskPreview[];
  /** When false, task is created under the story but left unassigned. */
  assign?: boolean;
  assigneeIds?: string[];
  sectionId?: string | null;
}

export interface UserStoryGeneratePreview {
  storyId: string;
  tasks: GeneratedTaskPreview[];
}

export interface PrdDraftStory {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria?: string;
  priority?: string;
  projectId?: string | null;
  sectionId?: string | null;
  position?: number;
  assigneeIds?: string[];
  estimatedHours?: number | null;
  storyPoints?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  sprint?: string;
  tags?: string[];
}

export interface PrdDraft {
  importId: string | null;
  sourceText: string;
  stories: PrdDraftStory[];
}

export type PrdStreamEvent =
  | {
      type: 'progress';
      percent: number;
      stage: string;
      label: string;
      doneStories?: number;
      totalStories?: number;
    }
  | { type: 'story'; percent: number; story: PrdDraftStory }
  | { type: 'done'; percent: number; label?: string; draft: PrdDraft }
  | { type: 'error'; message: string };

export interface TaskFeedback {
  id: string;
  taskId: string;
  userId: string;
  authorName: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserStoryFeedback {
  id: string;
  userStoryId: string;
  userId: string;
  authorName: string;
  message: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskChecklist {
  id: string;
  taskId: string;
  title: string;
  priority: Priority;
  isDone: boolean;
  position: number;
  createdBy: string;
  createdAt: string;
}

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
}

export interface UserStoryAttachment {
  id: string;
  userStoryId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  uploadedBy: string;
  uploaderName: string;
  createdAt: string;
}

export interface AuditLog {
  id: number;
  userId: string;
  userName: string;
  action: string;
  entityType: string;
  entityId: string;
  entityName: string;
  details: Record<string, unknown>;
  createdAt: string;
}

export interface Notification {
  id: number;
  type: 'task_assigned' | 'task_mentioned' | 'task_status_changed' | 'task_commented' | 'task_approved';
  title: string;
  message: string;
  entityType: string;
  entityId: string;
  isRead: boolean;
  triggeredBy: string;
  triggeredByName: string;
  triggeredByAvatar: string;
  createdAt: string;
}

// ── AI ────────────────────────────────────────────────────────────────────────

export interface AIChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIExtractedTask {
  title: string;
  description: string | null;
  priority: string | null;
  due_date: string | null;
  estimated_hours: number | null;
  assignee_id: string | null;
  assignee_name: string | null;
  project_id: string | null;
  section_id: string | null;
  section_name: string | null;
  suggest_create_section: boolean;
  tags: string[];
}

export interface AIChatAction {
  tool: string;
  status: 'proposed' | 'already_exists' | 'success' | 'error' | 'denied' | 'data';
  summary: string;
}

export type AIProposalType = 'create_project' | 'create_section' | 'create_task' | 'add_member';

export interface AIProposal {
  type: AIProposalType;
  // create_project
  name?: string;
  description?: string;
  // create_section
  project_id?: string;
  project_name?: string;
  section_name?: string;
  // create_task
  title?: string;
  section_id?: string;
  assignee_id?: string;
  assignee_name?: string;
  due_date?: string;
  priority?: string;
  tags?: string[];
  // add_member
  user_id?: string;
  user_name?: string;
}

export interface AIChatResponse {
  message: string;
  tasks: AIExtractedTask[];
  actions: AIChatAction[];
  proposals: AIProposal[];
  cards: AICard[];
}

export type ZaniChatStreamEvent =
  | { type: 'token'; delta: string }
  | { type: 'status'; message: string }
  | { type: 'reset' }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      message: string;
      tasks: AIExtractedTask[];
      actions: AIChatAction[];
      proposals: AIProposal[];
      cards: AICard[];
    };

// ── Personal Agent Cards ──────────────────────────────────────────────────────

export interface AICardTaskData {
  id: string;
  title: string;
  priority: string;
  status: string;
  due_date: string;
  is_overdue: boolean;
  project_name: string | null;
  section_name: string | null;
  project_id: string;
}

export interface AICardStatData {
  assigned_total: number;
  in_progress: number;
  completed_this_week: number;
  overdue: number;
}

export interface AICardProjectData {
  id: string;
  name: string;
  description: string;
  total_tasks: number;
  completed_tasks: number;
  section_count: number;
}

export interface AICardTimesheetData {
  week_start: string;
  week_end: string;
  total_hours: number;
  total_entries: number;
  by_project: { project_name: string; hours: number; entry_count: number }[];
}

export interface AICard {
  type: 'task' | 'stat' | 'project' | 'timesheet_summary';
  data: Record<string, unknown>;
}

export interface AITimesheetRow {
  project_id: string | null;
  project_name: string | null;
  section_id: string | null;
  section_name: string | null;
  description: string;
  time_from: string;   // HH:MM 24h
  time_to: string;     // HH:MM 24h
  confidence: number;  // 0–1
  needs_clarification: boolean;
  clarification_note: string | null;
  suggest_create_section: boolean;
  suggested_section_name: string | null;
}

export interface AITimesheetParseResponse {
  rows: AITimesheetRow[];
  gaps: string[];
  total_hours: number;
  message: string;
}

/** Minutes-of-Meeting (MOM) — raw daily notes parsed per person by the AI agent. */
export interface MomMember {
  name: string;
  items: string[];
}

export interface Scrum {
  id: string;
  date: string;
  title: string;
  rawText: string;
  members: MomMember[];
  summary: string;
  parseStatus: 'empty' | 'ok' | 'failed';
  updatedBy: string | null;
  updatedByName: string;
  updatedAt: string;
}

export interface DaySummary {
  date: string;
  summary: string;
  taskCount: number;
  trackedSeconds: number;
  timesheetSeconds: number;
  billableSeconds: number;
  hasData: boolean;
}

export interface ScrumDaySummary {
  date: string;
  scrumCount: number;
  memberCount: number;
  summary: string;
  parseStatus: 'empty' | 'ok' | 'failed';
  updatedByName: string;
}

export interface PersonalAccessToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface PersonalAccessTokenCreated extends PersonalAccessToken {
  token: string;
}

/** Weekly timesheet approval state from GET /timesheet/submissions/status. */
export type TimesheetSubmissionStatus = 'draft' | 'submitted' | 'approved' | 'rejected';

export interface TimesheetSubmission {
  id: string | null;
  userId: string;
  userName: string | null;
  weekStart: string;
  weekEnd: string;
  status: TimesheetSubmissionStatus;
  submittedAt: string | null;
  submittedDates?: string[];
  reviewerId: string | null;
  reviewerName: string | null;
  reviewedAt: string | null;
  rejectionNote: string | null;
}

export interface TimesheetReviewEntry {
  id: string;
  workDate: string;
  projectId: string;
  projectName: string;
  sectionId: string;
  sectionName: string;
  description: string;
  timeFrom: string;
  timeTo: string;
  seconds: number;
  billable: boolean;
}

export interface TimesheetReviewDay {
  workDate: string;
  entries: TimesheetReviewEntry[];
  totalSeconds: number;
}

export interface TimesheetSubmissionReview {
  submission: TimesheetSubmission;
  days: TimesheetReviewDay[];
  totalSeconds: number;
}

/** Manual day rows on the Timesheet page (project, section, description, time range). */
export interface TimesheetWorkEntry {
  id: string;
  userId: string;
  workDate: string;
  projectId: string;
  sectionId: string;
  description: string;
  timeFrom: string;
  timeTo: string;
  seconds: number;
  billable: boolean;
  createdAt: string;
}


/** One row a Clockify CSV import could not create, with its spreadsheet line. */
export interface ClockifyImportSkip {
  line: number;
  reason: string;
  detail: string;
}

export interface ClockifyImportReport {
  filename: string;
  totalRows: number;
  imported: number;
  duplicates: number;
  skippedCount: number;
  /** Date order the server detected in the file, e.g. "DD/MM/YYYY". */
  dateOrder: string;
  /** Records the import created rather than skipping. */
  createdProjects: string[];
  createdClients: string[];
  createdUsers: string[];
  membershipsAdded: number;
  skipped: ClockifyImportSkip[];
}

export interface TasksImportSkip {
  line: number;
  reason: string;
  detail: string;
}

export interface TasksImportReport {
  filename: string;
  totalRows: number;
  imported: number;
  duplicates: number;
  skippedCount: number;
  dateOrder: string;
  createdProjects: string[];
  createdUsers: string[];
  membershipsAdded: number;
  skipped: TasksImportSkip[];
}


/** One editable block of instructions sent to the model. */
export interface AiPrompt {
  key: string;
  body: string;
  defaultBody: string;
  /** Names this prompt may use, as the server reports them. */
  placeholders: string[];
  isCustom: boolean;
  updatedAt?: string | null;
  updatedBy?: string | null;
}
