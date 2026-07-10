import type { Task } from '@/types';

/** All user IDs assigned to the task (API sends assigneeIds; fallback for older clients). */
export function taskAssigneeIds(task: Task): string[] {
  if (task.assigneeIds && task.assigneeIds.length > 0) return task.assigneeIds;
  return task.assignedTo ? [task.assignedTo] : [];
}

export function isTaskAssignedTo(task: Task, userId: string): boolean {
  return taskAssigneeIds(task).includes(userId);
}

/** Assignee filter: empty set = no restriction (show all). */
export function taskMatchesAssigneeFilter(task: Task, selectedUserIds: Set<string>): boolean {
  if (selectedUserIds.size === 0) return true;
  for (const id of selectedUserIds) {
    if (isTaskAssignedTo(task, id)) return true;
  }
  return false;
}

const PRIORITIES = new Set(['Low', 'Medium', 'High', 'Urgent']);

/** Clockify imports used lowercase priority — normalize for UI maps. */
export function normalizePriority(priority: string | undefined): Task['priority'] {
  if (!priority) return 'Medium';
  if (PRIORITIES.has(priority)) return priority as Task['priority'];
  const titled = priority.charAt(0).toUpperCase() + priority.slice(1).toLowerCase();
  if (PRIORITIES.has(titled)) return titled as Task['priority'];
  return 'Medium';
}
