/**
 * Shared task card — original Dashboard kanban card design.
 * Used by Dashboard (sortable) and list views.
 */

import { useEffect, useState, type CSSProperties, type HTMLAttributes } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import UserAvatar from '@/components/UserAvatar';
import { useAppStore } from '@/stores/appStore';
import { isTaskAssignedTo, taskAssigneeIds, normalizePriority } from '@/lib/task-utils';
import {
  dueBucketDateTextClass,
  getDueBucket,
} from '@/lib/due-date-utils';
import type { Priority, Task } from '@/types';

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'text-red-600 dark:text-red-400',
  High: 'text-orange-600 dark:text-orange-400',
  Medium: 'text-yellow-600 dark:text-yellow-400',
  Low: 'text-green-600 dark:text-green-400',
};

const CARD_SHADOW =
  'shadow-[0_1px_4px_rgba(0,0,0,0.10)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.14)] dark:shadow-[0_1px_4px_rgba(255,255,255,0.14)] dark:hover:shadow-[0_2px_8px_rgba(255,255,255,0.22)]';

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

function projectNameColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PROJECT_NAME_COLORS[h % PROJECT_NAME_COLORS.length];
}

/** Project (text) + sprint (pill) in fixed slots so every card lines up. */
export function BoardCardMetaPills({
  projectId,
  sprint,
  estimatedHours,
  actualHours,
}: {
  projectId: string;
  sprint?: string | null;
  estimatedHours?: number | null;
  actualHours?: number | null;
}) {
  const projects = useAppStore(s => s.projects);
  const project = projects.find(p => p.id === projectId);
  const sprintLabel = sprint?.trim() ?? '';
  const hasEst = estimatedHours != null && Number.isFinite(estimatedHours) && estimatedHours > 0;
  const hasActual = actualHours != null && Number.isFinite(actualHours) && actualHours > 0;
  const fmt = (h: number) => (h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`);
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className={`text-[10px] font-semibold truncate w-[7.5rem] shrink-0 ${project ? projectNameColor(project.id) : 'text-transparent'}`}>
        {project?.name || '\u00a0'}
      </span>
      <span className="h-5 w-[6.75rem] shrink-0 flex items-center min-w-0">
        {sprintLabel ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-semibold truncate max-w-full">
            {sprintLabel}
          </span>
        ) : null}
      </span>
      {hasEst || hasActual ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/50 bg-muted/40 text-muted-foreground font-semibold tabular-nums shrink-0">
          {hasEst ? fmt(estimatedHours!) : '—'}
          {hasActual ? ` · ${fmt(actualHours!)}` : ''}
        </span>
      ) : null}
    </div>
  );
}

function useElapsedTime(epochStart: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!epochStart) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [epochStart]);
  if (!epochStart) return '';
  const secs = Math.max(0, Math.floor((Date.now() - epochStart) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTime(s: number) {
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export type TaskCardProps = {
  task: Task;
  onClick: () => void;
  showProjectPill?: boolean;
  /** When set, shows a user-story chip on the card */
  userStoryTitle?: string | null;
  showApprove?: boolean;
  onApprove?: () => void;
  approving?: boolean;
  /** Completed-row mode (compact, not the board card). */
  completed?: boolean;
  showReopen?: boolean;
  onReopen?: () => void;
  reopening?: boolean;
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  dragAttributes?: HTMLAttributes<HTMLElement>;
  dragListeners?: HTMLAttributes<HTMLElement>;
  isDragging?: boolean;
};

export function TaskCard({
  task,
  onClick,
  showProjectPill: _showProjectPill = false,
  userStoryTitle = null,
  showApprove = false,
  onApprove,
  approving = false,
  completed = false,
  showReopen = false,
  onReopen,
  reopening = false,
  dragRef,
  dragStyle,
  dragAttributes,
  dragListeners,
  isDragging = false,
}: TaskCardProps) {
  const { users, projects, currentUser, activeTimers, startTimer, stopTimer } = useAppStore();
  const taskProject = projects.find(p => p.id === task.projectId);
  const assigneeList = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;

  const isTimerActive = !!activeTimers[task.id];
  const elapsed = useElapsedTime(activeTimers[task.id] ?? null);
  const canStartTimer = !!currentUser
    && isTaskAssignedTo(task, currentUser.id)
    && task.status !== 'completed'
    && task.status !== 'done';
  const showTimer = (canStartTimer || isTimerActive) && task.status !== 'completed' && task.status !== 'done';

  const priority = normalizePriority(task.priority);

  const isDoneLane = task.status === 'completed' || task.status === 'done';
  const dueBucket = getDueBucket(task.dueDate);

  const isSortable = !!dragRef;

  const style: CSSProperties | undefined = isSortable
    ? {
        ...dragStyle,
        opacity: isDragging ? 0 : 1,
        ...(isDragging ? { pointerEvents: 'none' as const } : {}),
      }
    : undefined;

  // Compact completed row
  if (completed) {
    return (
      <div
        onClick={onClick}
        className="rounded-xl border bg-card/50 p-4 cursor-pointer opacity-60 hover:opacity-80 transition-opacity duration-100"
      >
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
            <h4 className="text-sm font-medium line-through truncate">{task.title}</h4>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {showReopen && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 rounded-lg gap-1.5 text-xs"
                disabled={reopening}
                onClick={e => { e.stopPropagation(); onReopen?.(); }}
              >
                <RotateCcw className="h-3 w-3" />
                {reopening ? '…' : 'Backlog'}
              </Button>
            )}
            <span className="text-xs text-muted-foreground">
              {task.completedAt ? formatDate(task.completedAt) : ''}
            </span>
          </div>
        </div>
        <div className="mt-1.5 ml-[40px] text-[11px] text-muted-foreground flex gap-3">
          {taskProject && <span>{taskProject.name}</span>}
          {task.sprint?.trim() ? <span>{task.sprint.trim()}</span> : null}
          <span>{formatTime(task.timeTracked)}</span>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={dragRef}
      data-kanban-task={isSortable || undefined}
      style={style}
      {...dragAttributes}
      {...dragListeners}
      onClick={onClick}
      className={`group relative min-h-[250px] ${
        isSortable
          ? 'touch-none select-none cursor-grab active:cursor-grabbing'
          : 'cursor-pointer'
      }`}
    >
      <div
        className={`rounded-2xl border border-border/70 bg-card p-6 min-h-[250px] flex flex-col transition-shadow ${CARD_SHADOW}`}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-mono text-muted-foreground/60 tracking-wider">
            TF-{task.id.replace(/\D/g, '').padStart(3, '0')}
          </span>
          <span className={`text-[11px] px-3 py-1 rounded-full font-semibold ${priorityBadgeStyles[priority]}`}>
            {priority}
          </span>
        </div>
        <h4 className="text-base font-bold leading-snug mb-2 text-foreground line-clamp-2 shrink-0">{task.title}</h4>
        {userStoryTitle && (
          <span className="mb-2 inline-flex max-w-full items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border/50 bg-muted/40 text-muted-foreground font-semibold truncate">
            {userStoryTitle}
          </span>
        )}
        <div className="flex-1 min-h-0 min-w-0" aria-hidden />
        <div className="pt-2 mt-auto space-y-2 shrink-0">
          <BoardCardMetaPills
            projectId={task.projectId}
            sprint={task.sprint}
            estimatedHours={task.estimatedHours}
          />
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex -space-x-2 shrink-0">
                {assigneeList.slice(0, 3).map(u => (
                  <UserAvatar key={u.id} name={u.name} avatar={u.avatar} size="xs" className="border-2 border-card" />
                ))}
                {assigneeList.length === 0 && (
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center">
                    <span className="text-[10px] text-muted-foreground">?</span>
                  </div>
                )}
              </div>
              <span className="text-sm text-muted-foreground font-medium truncate">
                {assigneeList.length === 0
                  ? 'Unassigned'
                  : assigneeList.length === 1
                    ? assigneeList[0].name.split(' ')[0]
                    : `${assigneeList.length} people`}
              </span>
            </div>
            <div className="flex items-center justify-end gap-2 shrink-0">
              {showTimer && (
                isTimerActive ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                      onClick={e => { e.stopPropagation(); void stopTimer(task.id); }}
                    >
                      Stop
                    </button>
                    {elapsed ? (
                      <span className="text-xs font-mono text-muted-foreground tabular-nums">{elapsed}</span>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    onClick={e => { e.stopPropagation(); void startTimer(task.id); }}
                  >
                    Start
                  </button>
                )
              )}
              {task.dueDate?.trim() ? (
                <span className={`text-sm font-mono ${dueBucketDateTextClass(dueBucket, isDoneLane)}`}>
                  {formatDate(task.dueDate)}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        {showApprove && (
          <div className="pt-3 mt-1 border-t border-border/50">
            <Button
              type="button"
              size="sm"
              className="w-full rounded-xl gap-1.5 bg-green-600 text-white hover:bg-green-700 border-green-600 shadow-sm"
              disabled={approving}
              onClick={e => { e.stopPropagation(); void onApprove?.(); }}
            >
              <CheckCircle className="h-3.5 w-3.5" />
              {approving ? 'Approving…' : 'Approve completed'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Dashboard kanban wrapper — must render inside SortableContext. */
export function SortableTaskCard(
  props: Omit<TaskCardProps, 'dragRef' | 'dragStyle' | 'dragAttributes' | 'dragListeners' | 'isDragging'>,
) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.task.id,
    data: { type: 'task' as const },
    animateLayoutChanges: () => false,
  });

  return (
    <TaskCard
      {...props}
      dragRef={setNodeRef}
      dragStyle={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      dragAttributes={attributes as HTMLAttributes<HTMLElement>}
      dragListeners={listeners as HTMLAttributes<HTMLElement>}
      isDragging={isDragging}
    />
  );
}
