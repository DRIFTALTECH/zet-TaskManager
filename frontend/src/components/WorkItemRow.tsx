import { Check } from 'lucide-react';
import type { Task } from '@/types';
import { isTaskConfirmed } from '@/lib/task-utils';

/**
 * One child work item in a detail modal — a story's tasks, a task's subtasks.
 *
 * Both lists read the same because they are the same thing at different depths;
 * the task modal used to render its own heavier version with a progress bar,
 * which made a subtask look like a different kind of object to a story's task.
 */
export function WorkItemRow({
  task,
  doneColumnId,
  onToggleDone,
  onClick,
}: {
  task: Task;
  doneColumnId?: string;
  /** Given, the circle also completes an unfinished item / reopens a finished one. */
  onToggleDone?: (done: boolean) => void;
  onClick: () => void;
}) {
  const done = task.status === doneColumnId || task.status === 'done' || task.status === 'completed';
  const confirmed = isTaskConfirmed(task);
  const circleActs = !!onToggleDone;

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
    >
      {done ? (
        <span
          role={circleActs ? 'button' : undefined}
          title={onToggleDone ? 'Mark as not done' : 'Done'}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
            confirmed
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
          } ${circleActs ? 'cursor-pointer' : ''}`}
          onClick={e => {
            e.stopPropagation();
            onToggleDone?.(true);
          }}
        >
          <Check className="h-3 w-3" />
        </span>
      ) : (
        <span
          role={onToggleDone ? 'button' : undefined}
          title={onToggleDone ? 'Mark as done' : undefined}
          className={`h-5 w-5 shrink-0 rounded-full border border-border/50 ${
            onToggleDone ? 'cursor-pointer hover:border-emerald-500' : ''
          }`}
          onClick={e => {
            if (!onToggleDone) return;
            e.stopPropagation();
            onToggleDone(false);
          }}
        />
      )}
      <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-muted-foreground' : ''}`}>
        {task.title}
      </span>
    </button>
  );
}

export default WorkItemRow;
