export type Role = 'manager' | 'employee';
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
  isPersonal?: boolean;
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
