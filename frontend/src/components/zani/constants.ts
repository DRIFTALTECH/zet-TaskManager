export const ZANI_SUGGESTIONS = [
  'What tasks are due today?',
  'Show me my stats for this week',
  'What are my overdue tasks?',
  'How many hours did I log this week?',
  'What projects am I working on?',
  'Create a high-priority task to fix the login bug',
] as const;

export const ZANI_CAPABILITIES = [
  { label: 'Your tasks', desc: 'Due today, overdue, in progress' },
  { label: 'Timesheet', desc: 'Hours logged this week' },
  { label: 'Create work', desc: 'Tasks, sections, projects' },
  { label: 'Team context', desc: 'Projects, members, assignments' },
] as const;

export const TOOL_LABELS: Record<string, string> = {
  create_project: 'Proposed project',
  create_section: 'Proposed section',
  create_task: 'Proposed task',
  add_member_to_project: 'Proposed member',
  list_projects: 'Fetched projects',
  list_users: 'Fetched users',
  get_my_tasks: 'Fetched your tasks',
  get_my_tasks_due_today: 'Fetched due-today tasks',
  get_my_overdue_tasks: 'Fetched overdue tasks',
  get_my_stats: 'Fetched your stats',
  get_my_timesheet_this_week: 'Fetched timesheet',
  get_my_projects: 'Fetched your projects',
};

export const DATA_TOOLS = new Set([
  'get_my_tasks',
  'get_my_tasks_due_today',
  'get_my_overdue_tasks',
  'get_my_stats',
  'get_my_timesheet_this_week',
  'get_my_projects',
]);
