import type { Project } from '@/types';

/** Label for dropdowns and pickers. */
export function projectPickerLabel(p: Project): string {
  return p.name;
}

/**
 * Default header/dashboard selection: always the aggregate "all projects" board when the user
 * belongs to any project, so we never land on a single project by default.
 */
export function defaultSelectedProjectIdForUser(
  projects: Project[],
  userProjectIds: string[],
  role?: string,
): string | null {
  // A superadmin belongs to no project but sees them all; keying the default off
  // membership alone dropped them on "Select a project" with nothing to select.
  if (role === 'superadmin') return projects.length > 0 ? 'all' : null;
  const mine = projects.filter(p => userProjectIds.includes(p.id));
  if (mine.length === 0) return null;
  return 'all';
}

const PROJECT_NAME_COLORS = [
  'text-blue-600 dark:text-blue-400',
  'text-violet-600 dark:text-violet-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-orange-600 dark:text-orange-400',
  'text-pink-600 dark:text-pink-400',
  'text-teal-600 dark:text-teal-400',
  'text-amber-600 dark:text-amber-400',
  'text-cyan-600 dark:text-cyan-400',
  'text-indigo-600 dark:text-indigo-400',
  'text-rose-600 dark:text-rose-400',
];

/** Stable colour per project id, so the same project reads the same everywhere. */
export function projectNameColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PROJECT_NAME_COLORS[h % PROJECT_NAME_COLORS.length];
}
