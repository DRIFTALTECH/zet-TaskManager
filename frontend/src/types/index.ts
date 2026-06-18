export type Role = 'manager' | 'employee' | 'admin';
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TaskStatus = string;

export interface KanbanColumn {
  id: string;
  label: string;
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
}

export interface Section {
  id: string;
  name: string;
  projectId: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  members: string[];
  sections: Section[];
  createdAt: string;
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
  priority: Priority;
  status: TaskStatus;
  isStarted: boolean;
  startedAt?: string;
  completedAt?: string;
  approvedByManager: boolean;
  timeTracked: number;
  tags: string[];
  createdAt: string;
  timeLog: Record<string, number>; // date (YYYY-MM-DD) -> seconds logged by current user
  customFields?: Record<string, string>; // user-defined key-value metadata
}

export interface TaskFeedback {
  id: string;
  taskId: string;
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
  createdAt: string;
}
