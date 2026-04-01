import type { Task } from '@/types';

/** All user IDs assigned to the task (API sends assigneeIds; fallback for older clients). */
export function taskAssigneeIds(task: Task): string[] {
  if (task.assigneeIds && task.assigneeIds.length > 0) return task.assigneeIds;
  return task.assignedTo ? [task.assignedTo] : [];
}

export function isTaskAssignedTo(task: Task, userId: string): boolean {
  return taskAssigneeIds(task).includes(userId);
}
