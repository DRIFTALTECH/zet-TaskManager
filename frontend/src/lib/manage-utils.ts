import type { Project, Task } from '@/types';
import { taskAssigneeIds } from '@/lib/task-utils';

// ── Project accent colors (deterministic by id) ─────────────────────────────────
export interface ProjectAccent {
  border: string;
  bg: string;
  light: string;
  text: string;
  ring: string;
  pill: string;
  hex: string; // raw hex for recharts fills
}

export const PROJECT_ACCENTS: ProjectAccent[] = [
  { border: 'border-l-blue-500',    bg: 'bg-blue-500',    light: 'bg-blue-500/10',    text: 'text-blue-400',    ring: 'ring-blue-500/20',    pill: 'bg-blue-500/15 text-blue-400 border-blue-500/30',       hex: '#3b82f6' },
  { border: 'border-l-violet-500',  bg: 'bg-violet-500',  light: 'bg-violet-500/10',  text: 'text-violet-400',  ring: 'ring-violet-500/20',  pill: 'bg-violet-500/15 text-violet-400 border-violet-500/30',  hex: '#8b5cf6' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-500', light: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', hex: '#10b981' },
  { border: 'border-l-orange-500',  bg: 'bg-orange-500',  light: 'bg-orange-500/10',  text: 'text-orange-400',  ring: 'ring-orange-500/20',  pill: 'bg-orange-500/15 text-orange-400 border-orange-500/30',  hex: '#f97316' },
  { border: 'border-l-pink-500',    bg: 'bg-pink-500',    light: 'bg-pink-500/10',    text: 'text-pink-400',    ring: 'ring-pink-500/20',    pill: 'bg-pink-500/15 text-pink-400 border-pink-500/30',        hex: '#ec4899' },
  { border: 'border-l-teal-500',    bg: 'bg-teal-500',    light: 'bg-teal-500/10',    text: 'text-teal-400',    ring: 'ring-teal-500/20',    pill: 'bg-teal-500/15 text-teal-400 border-teal-500/30',        hex: '#14b8a6' },
  { border: 'border-l-amber-500',   bg: 'bg-amber-500',   light: 'bg-amber-500/10',   text: 'text-amber-400',   ring: 'ring-amber-500/20',   pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30',     hex: '#f59e0b' },
  { border: 'border-l-cyan-500',    bg: 'bg-cyan-500',    light: 'bg-cyan-500/10',    text: 'text-cyan-400',    ring: 'ring-cyan-500/20',    pill: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',        hex: '#06b6d4' },
];

export function projectAccent(id: string): ProjectAccent {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PROJECT_ACCENTS[h % PROJECT_ACCENTS.length];
}

export const PRIORITY_STYLES: Record<string, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/25',
  High:   'bg-orange-500/15 text-orange-400 border-orange-500/25',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  Low:    'bg-green-500/15 text-green-400 border-green-500/25',
};

// Palette for status columns / charts (indexed)
export const STATUS_PALETTE = ['#64748b', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#f97316'];

/** A task counts as "completed" when its status is the terminal completed state. */
export function isCompleted(t: Task): boolean {
  return t.status === 'completed' || t.status === 'done';
}

export interface ProjectStats {
  taskCount: number;
  completed: number;
  active: number;
  completionPct: number;
  totalSeconds: number;
  memberCount: number;
  sectionCount: number;
  overdue: number;
}

export function computeProjectStats(project: Project, tasks: Task[]): ProjectStats {
  const projTasks = tasks.filter(t => t.projectId === project.id);
  const completed = projTasks.filter(isCompleted).length;
  const totalSeconds = projTasks.reduce((s, t) => s + (t.timeTracked || 0), 0);
  const today = new Date().toISOString().split('T')[0];
  const overdue = projTasks.filter(t => !isCompleted(t) && t.dueDate && t.dueDate < today).length;
  return {
    taskCount: projTasks.length,
    completed,
    active: projTasks.length - completed,
    completionPct: projTasks.length ? Math.round((completed / projTasks.length) * 100) : 0,
    totalSeconds,
    memberCount: project.members.length,
    sectionCount: project.sections.length,
    overdue,
  };
}

/** "12h 30m" / "45m" / "—" */
export function formatHM(seconds: number): string {
  if (!seconds) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

export function hoursDecimal(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}

/** Active (not completed) task count assigned to a user within a task list. */
export function activeTasksForUser(tasks: Task[], userId: string): number {
  return tasks.filter(t => taskAssigneeIds(t).includes(userId) && !isCompleted(t)).length;
}
