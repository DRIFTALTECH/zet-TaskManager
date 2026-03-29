export type Role = 'manager' | 'employee';
export type Priority = 'Low' | 'Medium' | 'High' | 'Urgent';
export type TaskStatus = 'backlog' | 'in_progress' | 'in_review' | 'done' | 'completed';

export interface User {
  id: string;
  name: string;
  email: string;
  password: string;
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
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string;
  sectionId: string;
  assignedTo: string;
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
  timeLog: Record<string, number>; // date string -> seconds
  customFields?: Record<string, string>; // user-defined key-value metadata
}

export interface TimesheetEntry {
  taskId: string;
  date: string;
  seconds: number;
}
