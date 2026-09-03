/**
 * Shared overview table. Story and task rows use the same columns and height.
 * A story row expands to list its tasks.
 */

import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PRIORITY_CHIP } from '@/components/analytics/analyticsUi';
import { normalizePriority, storyAssigneeIds } from '@/lib/task-utils';
import { api } from '@/lib/api';
import { storyKeys, STORY_STALE_TIME } from '@/lib/queryClient';
import { useAppStore } from '@/stores/appStore';
import type { UserStory } from '@/types';
import type { TaskOverviewRow } from '@/lib/analyticsApi';

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

const PRI_RANK: Record<string, number> = { Urgent: 4, High: 3, Medium: 2, Low: 1 };

type Group =
  | { kind: 'story'; id: string; title: string; tasks: TaskOverviewRow[]; projectName?: string }
  | { kind: 'task'; task: TaskOverviewRow };

function groupRows(rows: TaskOverviewRow[]): Group[] {
  const out: Group[] = [];
  const stories = new Map<string, Extract<Group, { kind: 'story' }>>();
  for (const r of rows) {
    if (!r.userStoryId) {
      out.push({ kind: 'task', task: r });
      continue;
    }
    let g = stories.get(r.userStoryId);
    if (!g) {
      g = {
        kind: 'story',
        id: r.userStoryId,
        title: r.userStoryTitle || 'Story',
        tasks: [],
        projectName: r.projectName,
      };
      stories.set(r.userStoryId, g);
      out.push(g);
    }
    g.tasks.push(r);
  }
  return out;
}

function statusLabel(status: string) {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ');
}

function uniqueNames(rows: TaskOverviewRow[]) {
  return [...new Set(rows.flatMap(t => t.assigneeNames))].join(', ');
}

function highestPriority(rows: TaskOverviewRow[]) {
  let best = 'Medium';
  let rank = 0;
  for (const r of rows) {
    const p = normalizePriority(r.priority);
    if ((PRI_RANK[p] ?? 0) > rank) {
      best = p;
      rank = PRI_RANK[p] ?? 0;
    }
  }
  return best;
}

function derivedStoryStatus(tasks: TaskOverviewRow[]) {
  if (tasks.length && tasks.every(t => t.isDone)) return 'done';
  if (tasks.some(t => ['in_progress', 'testing', 'in_review'].includes(t.status))) return 'in_progress';
  return 'backlog';
}

const TD = 'h-11 px-3 align-middle';

function TypeChip({ type }: { type: 'story' | 'task' }) {
  return (
    <span className={cn(
      'inline-flex w-[3.25rem] justify-center text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
      type === 'story'
        ? 'text-violet-700 dark:text-violet-300 border-violet-500/30 bg-violet-500/10'
        : 'text-muted-foreground border-border/50 bg-muted/40',
    )}>
      {type === 'story' ? 'Story' : 'Task'}
    </span>
  );
}

export function OverviewTaskTable({
  rows,
  showProject = false,
  onRowClick,
}: {
  rows: TaskOverviewRow[];
  showProject?: boolean;
  onRowClick?: (taskId: string) => void;
}) {
  const groups = useMemo(() => groupRows(rows), [rows]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const { data: stories = [] } = useQuery({
    queryKey: storyKeys.all,
    queryFn: () => api.listUserStories(),
    staleTime: STORY_STALE_TIME,
  });
  const users = useAppStore(s => s.users);
  const storyById = useMemo(() => {
    const m = new Map<string, UserStory>();
    for (const s of stories) m.set(s.id, s);
    return m;
  }, [stories]);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-10 text-center border border-dashed border-border/40 rounded-xl">
        No tasks match this filter.
      </p>
    );
  }

  const toggle = (id: string) => {
    setOpen(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  };

  const renderCells = (opts: {
    type: 'story' | 'task';
    name: string;
    status: string;
    projectName?: string;
    expected: number | null;
    actual: number;
    who: string;
    priority: string;
    chevron?: boolean;
    expanded?: boolean;
    nested?: boolean;
  }) => {
    const pri = normalizePriority(opts.priority);
    const over = opts.expected != null && opts.expected > 0 && opts.actual > opts.expected;
    return (
      <>
        <td className={TD}>
          <TypeChip type={opts.type} />
        </td>
        <td className={cn(TD, 'max-w-[18rem]')}>
          <div className={cn('flex items-center gap-1 min-w-0', opts.nested && 'pl-5')}>
            <span className="w-4 shrink-0 inline-flex justify-center">
              {opts.chevron ? (
                <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', opts.expanded && 'rotate-90')} />
              ) : null}
            </span>
            <span className="truncate font-medium text-foreground">{opts.name}</span>
          </div>
        </td>
        <td className={cn(TD, 'text-muted-foreground whitespace-nowrap')}>
          {statusLabel(opts.status)}
        </td>
        {showProject && (
          <td className={cn(TD, 'text-muted-foreground truncate max-w-[8rem]')}>
            {opts.projectName ?? '—'}
          </td>
        )}
        <td className={cn(TD, 'text-right tabular-nums text-muted-foreground')}>
          {fmtHours(opts.expected, true)}
        </td>
        <td className={cn(TD, 'text-right tabular-nums font-medium', over ? 'text-amber-600 dark:text-amber-400' : 'text-foreground')}>
          {fmtHours(opts.actual)}
        </td>
        <td className={cn(TD, 'text-muted-foreground truncate max-w-[9rem]')}>
          {opts.who || '—'}
        </td>
        <td className={TD}>
          <span className={cn(
            'text-[10px] font-semibold px-1.5 py-0.5 rounded-full border',
            PRIORITY_CHIP[pri] ?? PRIORITY_CHIP.Medium,
          )}>
            {pri}
          </span>
        </td>
      </>
    );
  };

  return (
    <div className="overflow-x-auto rounded-xl border border-border/40">
      <table className="w-full text-sm min-w-[48rem]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70 bg-muted/20 border-b border-border/30">
            <th className="text-left font-semibold h-11 px-3">Type</th>
            <th className="text-left font-semibold h-11 px-3">Name</th>
            <th className="text-left font-semibold h-11 px-3">Status</th>
            {showProject && <th className="text-left font-semibold h-11 px-3">Project</th>}
            <th className="text-right font-semibold h-11 px-3 tabular-nums">Expected</th>
            <th className="text-right font-semibold h-11 px-3 tabular-nums">Actual</th>
            <th className="text-left font-semibold h-11 px-3">Who</th>
            <th className="text-left font-semibold h-11 px-3">Priority</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/15">
          {groups.map(g => {
            if (g.kind === 'task') {
              const r = g.task;
              return (
                <tr
                  key={r.id}
                  className={cn('hover:bg-muted/25 transition-colors', onRowClick && 'cursor-pointer', r.isDone && 'opacity-75')}
                  onClick={() => onRowClick?.(r.id)}
                >
                  {renderCells({
                    type: 'task',
                    name: r.title,
                    status: r.status,
                    projectName: r.projectName,
                    expected: r.expectedHours,
                    actual: r.actualHours,
                    who: r.assigneeNames.join(', '),
                    priority: r.priority,
                  })}
                </tr>
              );
            }
            const expanded = open.has(g.id);
            const story = storyById.get(g.id);
            const expected = g.tasks.reduce((s, t) => s + (t.expectedHours ?? 0), 0);
            const actual = g.tasks.reduce((s, t) => s + t.actualHours, 0);
            const hasEst = g.tasks.some(t => t.expectedHours != null && t.expectedHours > 0);
            const who = story
              ? storyAssigneeIds(story).map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(', ')
                || uniqueNames(g.tasks)
              : uniqueNames(g.tasks);
            return (
              <Fragment key={`story-${g.id}`}>
                <tr
                  className="hover:bg-muted/25 transition-colors cursor-pointer"
                  onClick={() => toggle(g.id)}
                >
                  {renderCells({
                    type: 'story',
                    name: g.title,
                    status: story?.status || derivedStoryStatus(g.tasks),
                    projectName: g.projectName,
                    expected: hasEst ? expected : null,
                    actual,
                    who,
                    priority: story?.priority ? String(story.priority) : highestPriority(g.tasks),
                    chevron: true,
                    expanded,
                  })}
                </tr>
                {expanded && g.tasks.map(r => (
                  <tr
                    key={r.id}
                    className={cn('hover:bg-muted/25 transition-colors', onRowClick && 'cursor-pointer', r.isDone && 'opacity-75')}
                    onClick={() => onRowClick?.(r.id)}
                  >
                    {renderCells({
                      type: 'task',
                      name: r.title,
                      status: r.status,
                      projectName: r.projectName,
                      expected: r.expectedHours,
                      actual: r.actualHours,
                      who: r.assigneeNames.join(', '),
                      priority: r.priority,
                      nested: true,
                    })}
                  </tr>
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
