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

/** All user IDs assigned to the task (API sends assigneeIds; fallback for older clients). */
export function taskAssigneeIds(task: Task): string[] {
  if (Array.isArray(task.assigneeIds)) {
    if (task.assigneeIds.length > 0) return task.assigneeIds;
    // Empty list is authoritative for story-linked tasks (unassigned until assigned).
    if (task.userStoryId) return [];
  }
  return task.assignedTo ? [task.assignedTo] : [];
}

/** Story assignees — mirrors taskAssigneeIds. */
export function storyAssigneeIds(story: UserStory): string[] {
  if (story.assigneeIds && story.assigneeIds.length > 0) return story.assigneeIds;
  return story.assigneeId ? [story.assigneeId] : [];
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
