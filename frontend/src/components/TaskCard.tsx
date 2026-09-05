/**
 * Shared task card — original Dashboard kanban card design.
 * Used by Dashboard (sortable) and list views.
 */

import { useEffect, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CheckCircle2, ChevronRight, CircleDot, Loader2, RotateCcw, UserPlus2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import UserAvatar from '@/components/UserAvatar';
import { useAppStore } from '@/stores/appStore';
import { CARD_SHADOW } from '@/lib/card-shadow';
import { DROP_HOST_CLASS, useIsDropHost } from '@/lib/drop-target';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { projectNameColor } from '@/lib/project-utils';
import { isTaskAssignedTo, taskAssigneeIds, normalizePriority } from '@/lib/task-utils';
import {
  dueBucketDateTextClass,
  getDueBucket,
} from '@/lib/due-date-utils';
import type { Priority, Task } from '@/types';
import { priorityTextClass } from '@/lib/priority-styles';
import { AssigneeCell, DueDateCell, PriorityCell, type DashUser } from '@/components/dash/DashCells';
import type { DashRowPatch } from '@/components/dash/DashTable';



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
      {/* Basis, not width: the slots line up while there is room and give way
          when there is not, instead of pushing the hours pill off the card. */}
      <span className={`text-[10px] font-semibold truncate min-w-0 shrink basis-[7.5rem] ${project ? projectNameColor(project.id) : 'text-transparent'}`}>
        {project?.name || '\u00a0'}
      </span>
      <span
        className={`flex h-5 min-w-0 items-center ${sprintLabel ? 'shrink basis-[6.75rem]' : 'basis-0'}`}
      >
        {sprintLabel ? (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300 font-semibold truncate max-w-full">
            {sprintLabel}
          </span>
        ) : null}
      </span>
      {hasEst || hasActual ? (
        <span className="text-[10px] px-2 py-0.5 rounded-full border border-border/50 bg-muted/40 text-muted-foreground font-semibold tabular-nums shrink-0 whitespace-nowrap">
          {hasEst ? fmt(estimatedHours!) : '—'}
          {hasActual ? ` · ${fmt(actualHours!)}` : ''}
        </span>
      ) : null}
    </div>
  );
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
  /**
   * Given, the card's assignee, priority and due date become the same one-click
   * editors the list rows use — a board card should not be a read-only copy of
   * a row you can edit.
   */
  onEdit?: (patch: DashRowPatch) => void;
  /** People assignable here; the popover offers only project members. */
  members?: DashUser[];
  /** Subtasks sitting in this task's column; shown under a toggle on the card. */
  subtasks?: Task[];
  expanded?: boolean;
  onToggleExpand?: () => void;
  onSubtaskClick?: (task: Task) => void;
  /** Draws one subtask card; the board passes its own so they stay draggable. */
  renderSubtask?: (task: Task) => ReactNode;
  /** A request for this task is in flight. */
  busy?: boolean;
};

export function TaskCard({
  task,
  onClick,
  showProjectPill: _showProjectPill = false,
  userStoryTitle = null,
  completed = false,
  showReopen = false,
  onReopen,
  reopening = false,
  dragRef,
  dragStyle,
  dragAttributes,
  dragListeners,
  isDragging = false,
  onEdit,
  members = [],
  subtasks = [],
  expanded = false,
  onToggleExpand,
  onSubtaskClick,
  renderSubtask,
  busy = false,
}: TaskCardProps) {
  const { users, projects, currentUser, activeTimers, startTimer, stopTimer } = useAppStore();
  const taskProject = projects.find(p => p.id === task.projectId);
  const assigneeList = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;

  const isTimerActive = !!activeTimers[task.id];
  const elapsed = useElapsedTime(activeTimers[task.id] ?? null);
  // Matches what the server actually allows: `start_task` accepts an assignee
  // OR the creator. The card only checked assignees, so it hid the button from
  // people the API would have let through — most visibly on subtasks, which are
  // made by dragging one card onto another and often carry no assignee of their
  // own, leaving nobody able to time them.
  const canStartTimer = !!currentUser
    && (isTaskAssignedTo(task, currentUser.id) || task.createdBy === currentUser.id)
    && task.status !== 'completed'
    && task.status !== 'done';
  const showTimer = (canStartTimer || isTimerActive) && task.status !== 'completed' && task.status !== 'done';

  const priority = normalizePriority(task.priority);

  const isDoneLane = task.status === 'completed' || task.status === 'done';
  const dueBucket = getDueBucket(task.dueDate);

  const isSortable = !!dragRef;
  // Nudges while a drag hovers this card, so it is clear the item would land
  // inside it rather than in the column behind.
  const isDropHost = useIsDropHost(task.id);

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
      className={`group relative ${
        isSortable
          ? 'touch-none select-none cursor-grab active:cursor-grabbing'
          : 'cursor-pointer'
      }`}
    >
      <div
        className={`relative rounded-xl border border-border/70 bg-card p-3 flex flex-col transition-shadow ${CARD_SHADOW} ${isDropHost ? DROP_HOST_CLASS : ''} ${
          busy ? 'pointer-events-none' : ''
        }`}
      >
        {/* Says the move is happening. Without it a slow request looks like a
            drag that did nothing, and people drag again. */}
        {busy && (
          <span className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-card/70">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </span>
        )}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          {/* Labelled the way a story card is, rather than by a reference number. */}
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            <CircleDot className="h-3 w-3 text-primary" /> Task
          </span>
          {onEdit ? (
            <span className="shrink-0" onClick={e => e.stopPropagation()}>
              <PriorityCell priority={priority} onChange={p => onEdit({ priority: p })} />
            </span>
          ) : (
            <span className={`shrink-0 text-[10px] font-semibold ${priorityTextClass[priority]}`}>
              {priority}
            </span>
          )}
        </div>
        <h4 className="text-[13px] font-semibold leading-snug mb-1.5 text-foreground line-clamp-2 shrink-0 break-words">{task.title}</h4>
        {userStoryTitle && (
          <span className="mb-2 inline-flex max-w-full items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border border-border/50 bg-muted/40 text-muted-foreground font-semibold truncate">
            {userStoryTitle}
          </span>
        )}
        <div className="mt-auto space-y-1.5 shrink-0">
          <BoardCardMetaPills
            projectId={task.projectId}
            sprint={task.sprint}
            estimatedHours={task.estimatedHours}
          />
          <div className="flex items-end justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {onEdit ? (
                <span className="group shrink-0" onClick={e => e.stopPropagation()}>
                  <AssigneeCell
                    assigneeIds={taskAssigneeIds(task)}
                    members={members}
                    onChange={ids => onEdit({ assigneeIds: ids })}
                  />
                </span>
              ) : (
                <div className="flex -space-x-1.5 shrink-0">
                  {assigneeList.slice(0, 3).map(u => (
                    <UserAvatar key={u.id} name={u.name} avatar={u.avatar} size="xs" className="ring-2 ring-card" />
                  ))}
                  {assigneeList.length === 0 && (
                    <UserPlus2 className="h-3.5 w-3.5 text-muted-foreground/40" />
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 shrink-0">
              {showTimer && (
                isTimerActive ? (
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                      onClick={e => { e.stopPropagation(); void stopTimer(task.id); }}
                    >
                      Stop
                    </button>
                    {elapsed ? (
                      <span className="text-[11px] font-mono text-muted-foreground tabular-nums">{elapsed}</span>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    onClick={e => { e.stopPropagation(); void startTimer(task.id); }}
                  >
                    Start
                  </button>
                )
              )}
              {onEdit ? (
                <span className="group shrink-0" onClick={e => e.stopPropagation()}>
                  <DueDateCell
                    dueDate={task.dueDate ?? ''}
                    isDone={isDoneLane}
                    onChange={iso => onEdit({ dueDate: iso })}
                  />
                </span>
              ) : task.dueDate?.trim() ? (
                <span className={`text-[11px] font-mono ${dueBucketDateTextClass(dueBucket, isDoneLane)}`}>
                  {formatDate(task.dueDate)}
                </span>
              ) : null}
            </div>
          </div>
          {subtasks.length > 0 && (
            <button
              type="button"
              className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={e => { e.stopPropagation(); onToggleExpand?.(); }}
            >
              <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
              {subtasks.length} {subtasks.length === 1 ? 'subtask' : 'subtasks'}
            </button>
          )}
        </div>
      </div>
      {/* Cards of their own, indented under the task — the same shape a story
          uses for its tasks, so a subtask reads as work, not as a list item. */}
      {expanded && subtasks.length > 0 && (
        <div
          className="mt-1.5 ml-2 space-y-1.5 border-l-2 border-border/60 pl-2"
          onClick={e => e.stopPropagation()}
        >
          {subtasks.map(st =>
            renderSubtask
              ? renderSubtask(st)
              : (
                <TaskCard
                  key={st.id}
                  task={st}
                  onClick={() => onSubtaskClick?.(st)}
                />
              ),
          )}
        </div>
      )}
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
