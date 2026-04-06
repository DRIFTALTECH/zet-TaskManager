import type { Project } from '@/types';

/** Label for dropdowns and pickers (Personal workspace is marked private). */
export function projectPickerLabel(p: Project): string {
  return p.isPersonal ? `${p.name} (only you)` : p.name;
}
