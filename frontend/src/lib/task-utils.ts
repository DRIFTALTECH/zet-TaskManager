import type { Task, UserStory } from '@/types';

/** Nested AI/story subtasks must not appear as top-level board/dashboard cards. */
export function isTopLevelTask(task: Task): boolean {
  return !task.parentTaskId;
}

/** Child tasks nested under a parent (user-story / AI subtasks). */
export function childTasksOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter(t => t.parentTaskId === parentId);
}

export function isTaskDone(task: Task): boolean {
  return task.status === 'completed' || task.status === 'done';
}

/** Sentinel for Dashboard / board “Person” filter — match tasks with no assignees. */
export const UNASSIGNED_FILTER_ID = '__unassigned__';

/**
 * All user IDs assigned to the task.
 * Empty `assigneeIds` from the API is authoritative (unassigned) — including CSV imports
 * that store the creator only as a denormalized placeholder in `assignedTo`.
 */
export function taskAssigneeIds(task: Task): string[] {
  if (Array.isArray(task.assigneeIds)) {
    return task.assigneeIds;
  }
  return task.assignedTo ? [task.assignedTo] : [];
}

export function isTaskUnassigned(task: Task): boolean {
  return taskAssigneeIds(task).length === 0;
}

/** Story assignees — mirrors taskAssigneeIds. */
export function storyAssigneeIds(story: UserStory): string[] {
  if (story.assigneeIds && story.assigneeIds.length > 0) return story.assigneeIds;
  return story.assigneeId ? [story.assigneeId] : [];
}

export function isTaskAssignedTo(task: Task, userId: string): boolean {
  return taskAssigneeIds(task).includes(userId);
}

/** Assignee filter: empty set = no restriction (show all). Supports UNASSIGNED_FILTER_ID. */
export function taskMatchesAssigneeFilter(task: Task, selectedUserIds: Set<string>): boolean {
  if (selectedUserIds.size === 0) return true;
  const wantUnassigned = selectedUserIds.has(UNASSIGNED_FILTER_ID);
  if (wantUnassigned && isTaskUnassigned(task)) return true;
  for (const id of selectedUserIds) {
    if (id === UNASSIGNED_FILTER_ID) continue;
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
