/**
 * Priority colours, in one place so the board card, the list row and the filter
 * chips cannot drift apart. `none` is deliberately absent: an unset priority is
 * drawn as a ghost flag, never as a coloured badge.
 */
import type { Priority } from '@/types';

export const priorityTextClass: Record<Priority, string> = {
  Urgent: 'text-red-600 dark:text-red-400',
  High: 'text-orange-600 dark:text-orange-400',
  Medium: 'text-yellow-600 dark:text-yellow-400',
  Low: 'text-green-600 dark:text-green-400',
};
