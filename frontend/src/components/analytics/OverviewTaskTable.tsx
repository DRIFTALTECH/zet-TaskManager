/**
 * Shared task table for Task Overview / User Overview.
 */

import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRIORITY_CHIP } from '@/components/analytics/analyticsUi';
import { normalizePriority } from '@/lib/task-utils';
import type { TaskOverviewRow } from '@/lib/analyticsApi';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  try {
    return new Date(d.slice(0, 10) + 'T12:00:00').toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return d.slice(0, 10);
  }
}

function fmtHours(h: number | null | undefined, blankWhenZero = false) {
  if (h == null || (blankWhenZero && !h)) return '—';
  if (!h) return '0h';
  return h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(h >= 10 ? 0 : 1)}h`;
}

const STATUS_LABEL: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  testing: 'Testing',
  in_review: 'In review',
  done: 'Done',
  completed: 'Completed',
};

export function OverviewTaskTable({
  rows,
  showProject = false,
  onRowClick,
}: {
  rows: TaskOverviewRow[];
  showProject?: boolean;
  onRowClick?: (taskId: string) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center border border-dashed border-border/40 rounded-xl">
        No tasks match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border/40">
      <table className="w-full text-sm min-w-[56rem]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70 bg-muted/20 border-b border-border/30">
            <th className="text-left font-semibold py-2.5 px-3">Task</th>
            {showProject && <th className="text-left font-semibold py-2.5 px-3">Project</th>}
            <th className="text-left font-semibold py-2.5 px-3">Started</th>
            <th className="text-left font-semibold py-2.5 px-3">Completed</th>
            <th className="text-right font-semibold py-2.5 px-3 tabular-nums">Expected</th>
            <th className="text-right font-semibold py-2.5 px-3 tabular-nums">Actual</th>
            <th className="text-left font-semibold py-2.5 px-3">Who</th>
            <th className="text-left font-semibold py-2.5 px-3">Priority</th>
            <th className="text-left font-semibold py-2.5 px-3">User story</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/15">
          {rows.map(r => {
            const pri = normalizePriority(r.priority);
            const over = r.expectedHours != null && r.expectedHours > 0 && r.actualHours > r.expectedHours;
            return (
              <tr
                key={r.id}
                className={cn(
                  'hover:bg-muted/25 transition-colors',
                  onRowClick && 'cursor-pointer',
                  r.isDone && 'opacity-75',
                )}
                onClick={() => onRowClick?.(r.id)}
              >
                <td className="py-2.5 px-3 max-w-[16rem]">
                  <div className="font-medium text-foreground truncate">{r.title}</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {STATUS_LABEL[r.status] ?? r.status}
                  </div>
                </td>
                {showProject && (
                  <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[8rem]">
                    {r.projectName ?? '—'}
                  </td>
                )}
                <td className="py-2.5 px-3 text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtDate(r.startedAt)}
                </td>
                <td className="py-2.5 px-3 text-muted-foreground tabular-nums whitespace-nowrap">
                  {fmtDate(r.completedAt)}
                </td>
                <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">
                  {fmtHours(r.expectedHours, true)}
                </td>
                <td className={cn(
                  'py-2.5 px-3 text-right tabular-nums font-medium',
                  over ? 'text-amber-600 dark:text-amber-400' : 'text-foreground',
                )}>
                  {fmtHours(r.actualHours)}
                </td>
                <td className="py-2.5 px-3 text-muted-foreground truncate max-w-[9rem]">
                  {r.assigneeNames.length ? r.assigneeNames.join(', ') : '—'}
                </td>
                <td className="py-2.5 px-3">
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
                    PRIORITY_CHIP[pri] ?? PRIORITY_CHIP.Medium,
                  )}>
                    {pri}
                  </span>
                </td>
                <td className="py-2.5 px-3 max-w-[12rem]">
                  {r.userStoryTitle ? (
                    <span className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 truncate">
                      <BookOpen className="h-3 w-3 shrink-0" />
                      <span className="truncate">{r.userStoryTitle}</span>
                    </span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
