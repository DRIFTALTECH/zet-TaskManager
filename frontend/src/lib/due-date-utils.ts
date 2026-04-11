import type { Priority, Task } from '@/types';

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'later';

/** Day delta from local "today" to due date (local calendar dates, YYYY-MM-DD). */
export function daysFromTodayInLocal(dueDateIso: string): number {
  const t = dueDateIso.trim().split('-').map(Number);
  if (t.length < 3 || t.some(n => Number.isNaN(n))) return 9999;
  const [y, mo, d] = t;
  const due = new Date(y!, mo! - 1, d!);
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due.getTime() - start.getTime()) / 86_400_000);
}

export function getDueBucket(dueDateIso: string): DueBucket {
  const days = daysFromTodayInLocal(dueDateIso);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return 'later';
}

export function localTodayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localTomorrowISO(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Due date text on cards / lists: today = red, tomorrow = orange; overdue stays red; later muted. */
export function dueBucketDateTextClass(bucket: DueBucket, isDone: boolean): string {
  if (isDone) return 'text-muted-foreground/50';
  switch (bucket) {
    case 'overdue':
      return 'text-red-600 dark:text-red-400 font-medium';
    case 'today':
      return 'text-red-600 dark:text-red-400 font-medium';
    case 'tomorrow':
      return 'text-orange-600 dark:text-orange-400 font-medium';
    case 'later':
      return 'text-muted-foreground/75';
    default:
      return 'text-muted-foreground/60';
  }
}

export type DashboardDueFilter = 'all' | 'overdue' | 'today' | 'tomorrow' | 'this_week' | 'later';

export function taskMatchesDashboardDueFilter(task: Task, f: DashboardDueFilter): boolean {
  if (f === 'all') return true;
  const days = daysFromTodayInLocal(task.dueDate);
  switch (f) {
    case 'overdue':
      return days < 0;
    case 'today':
      return days === 0;
    case 'tomorrow':
      return days === 1;
    case 'this_week':
      return days >= 0 && days <= 6;
    case 'later':
      return days >= 7;
    default:
      return true;
  }
}

/** Priority filter: empty set = no restriction (show all). */
export function taskMatchesPriorityFilter(task: Task, selected: Set<Priority>): boolean {
  if (selected.size === 0) return true;
  return selected.has(task.priority);
}
