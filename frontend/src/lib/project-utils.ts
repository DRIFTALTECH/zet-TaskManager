import type { Project } from '@/types';

/** Label for dropdowns and pickers (Personal workspace is marked private). */
export function projectPickerLabel(p: Project): string {
  return p.isPersonal ? `${p.name} (only you)` : p.name;
}

/**
 * Default header/dashboard selection: always the aggregate "all projects" board when the user
 * belongs to any project, so we never land on Personal (or any single project) by default.
 */
export function defaultSelectedProjectIdForUser(projects: Project[], userProjectIds: string[]): string | null {
  const mine = projects.filter(p => userProjectIds.includes(p.id));
  if (mine.length === 0) return null;
  return 'all';
}
