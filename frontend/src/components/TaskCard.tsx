/**
 * Shared task card — original Dashboard kanban card design.
 * Used by Dashboard (sortable) and list views.
 */

import { useEffect, useState, type CSSProperties, type HTMLAttributes, type MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle, CheckCircle2, CheckSquare, RotateCcw, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import UserAvatar from '@/components/UserAvatar';
import { useAppStore } from '@/stores/appStore';
import { isTaskAssignedTo, taskAssigneeIds, normalizePriority, childTasksOf, isTaskDone } from '@/lib/task-utils';
import {
  dueBucketDateTextClass,
  getDueBucket,
} from '@/lib/due-date-utils';
import type { Priority, Task } from '@/types';
import { toast } from 'sonner';

const priorityBadgeStyles: Record<Priority, string> = {
  Urgent: 'text-red-600 dark:text-red-400',
  High: 'text-orange-600 dark:text-orange-400',
  Medium: 'text-yellow-600 dark:text-yellow-400',
  Low: 'text-green-600 dark:text-green-400',
};

const priorityGlowColor: Record<Priority, string> = {
  Urgent: 'rgba(239,68,68,0.25)',
  High: 'rgba(249,115,22,0.25)',
  Medium: 'rgba(234,179,8,0.2)',
  Low: 'rgba(34,197,94,0.2)',
};

const ID_PILL_PALETTES = [
  'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25',
  'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25',
  'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
  'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25',
  'bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/25',
  'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/25',
  'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25',
  'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border-cyan-500/25',
  'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/25',
  'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/25',
];

function idPillColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ID_PILL_PALETTES[h % ID_PILL_PALETTES.length];
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
  showProjectPill = false,
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
  const { users, projects, currentUser, activeTimers, startTimer, stopTimer, tasks: allTasks, moveTask, reopenTaskToBacklog } = useAppStore();
  const taskProject = projects.find(p => p.id === task.projectId);
  const taskSection = taskProject?.sections.find(s => s.id === task.sectionId);
  const assigneeList = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;
  const nestedSubtasks = childTasksOf(allTasks, task.id);

  const toggleNestedSubtask = async (st: Task, e: MouseEvent) => {
    e.stopPropagation();
    try {
      if (isTaskDone(st)) {
        if (st.status === 'completed') await reopenTaskToBacklog(st.id);
        else await moveTask(st.id, 'backlog');
      } else {
        await moveTask(st.id, 'done');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update subtask');
    }
  };

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
          {taskSection && <span>{taskSection.name}</span>}
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
        className="rounded-2xl border-2 border-border/70 bg-gradient-to-br from-muted/70 via-card to-muted/40 dark:from-muted/50 dark:via-card dark:to-muted/30 p-6 min-h-[250px] flex flex-col transition-[transform,box-shadow] duration-200 ease-out will-change-transform group-hover:-translate-y-1.5 group-hover:scale-[1.02] shadow-md group-hover:shadow-xl group-hover:[box-shadow:0_20px_60px_-10px_var(--card-glow)]"
        style={{ ['--card-glow' as string]: priorityGlowColor[priority] }}
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
          <span className="mb-2 inline-flex max-w-full items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-600 dark:text-violet-400 font-semibold truncate">
            {userStoryTitle}
          </span>
        )}
        {nestedSubtasks.length > 0 && (
          <div className="mb-2 rounded-lg border border-border/40 bg-muted/20 px-2.5 py-2 space-y-1 shrink-0">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              <CheckSquare className="h-3 w-3" />
              Subtasks ({nestedSubtasks.filter(isTaskDone).length}/{nestedSubtasks.length})
            </div>
            <ul className="space-y-0.5 max-h-[72px] overflow-y-auto">
              {nestedSubtasks.map(st => {
                const done = isTaskDone(st);
                return (
                  <li
                    key={st.id}
                    className="flex items-center gap-1.5 text-[11px] leading-snug"
                  >
                    <button
                      type="button"
                      onClick={e => void toggleNestedSubtask(st, e)}
                      className="shrink-0 text-muted-foreground/50 hover:text-primary transition-colors"
                      title={done ? 'Mark as not completed' : 'Mark as completed'}
                      aria-label={done ? 'Mark as not completed' : 'Mark as completed'}
                    >
                      {done
                        ? <CheckSquare className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                        : <Square className="h-3.5 w-3.5" />}
                    </button>
                    <span
                      className={`min-w-0 truncate ${
                        done ? 'text-muted-foreground/50 line-through' : 'text-muted-foreground/85'
                      }`}
                    >
                      {st.title}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <div className="flex-1 min-h-0 min-w-0" aria-hidden />
        <div className="pt-2 mt-auto space-y-2 shrink-0">
          {((showProjectPill && taskProject) || taskSection || showTimer || task.sprint?.trim()) && (
            <div className="flex items-center justify-between gap-2 min-h-10">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0 pr-2 flex-1">
                {showProjectPill && taskProject && taskSection ? (
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold truncate max-w-[200px] ${idPillColor(taskProject.id)}`}>
                    {taskProject.name} · {taskSection.name}
                  </span>
                ) : (
                  <>
                    {showProjectPill && taskProject && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold truncate max-w-[120px] ${idPillColor(taskProject.id)}`}>
                        {taskProject.name}
                      </span>
                    )}
                    {taskSection && (
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold truncate max-w-[120px] ${idPillColor(taskSection.id)}`}>
                        {taskSection.name}
                      </span>
                    )}
                  </>
                )}
                {task.sprint?.trim() && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-semibold truncate max-w-[120px]">
                    {task.sprint.trim()}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-end shrink-0">
                {showTimer && (
                  isTimerActive ? (
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        type="button"
                        className="text-sm font-semibold px-4 py-2 min-h-10 rounded-lg bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
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
                      className="text-sm font-semibold px-4 py-2 min-h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                      onClick={e => { e.stopPropagation(); void startTimer(task.id); }}
                    >
                      Start
                    </button>
                  )
                )}
              </div>
            </div>
          )}
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
            {task.dueDate?.trim() ? (
              <span className={`text-sm font-mono shrink-0 ${dueBucketDateTextClass(dueBucket, isDoneLane)}`}>
                {formatDate(task.dueDate)}
              </span>
            ) : null}
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
