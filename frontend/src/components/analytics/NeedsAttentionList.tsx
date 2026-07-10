/**
 * NeedsAttentionList — overdue high-priority, blocked, and due-today tasks.
 */

import { Clock } from 'lucide-react';
import type { NeedsAttentionTask } from '@/lib/analyticsApi';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import { PriorityChip } from '@/components/analytics/analyticsUi';
import { cn } from '@/lib/utils';

const TYPE_LABEL: Record<NeedsAttentionTask['attentionType'], string> = {
  blocked: ANALYTICS_LABELS.blockedTasks,
  overdue_high_priority: 'Overdue · high priority',
  due_today: 'Due today',
};

const TYPE_CSS: Record<NeedsAttentionTask['attentionType'], string> = {
  blocked: 'border-amber-500/25 bg-amber-500/5',
  overdue_high_priority: 'border-red-500/25 bg-red-500/5',
  due_today: 'border-blue-500/20 bg-blue-500/5',
};

export function NeedsAttentionList({ tasks }: { tasks: NeedsAttentionTask[] }) {
  if (!tasks.length) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">Nothing needs attention today.</p>
    );
  }

  return (
    <ul className="space-y-2">
      {tasks.map(t => (
        <li
          key={t.id}
          className={cn('rounded-xl border px-3 py-2.5 text-sm', TYPE_CSS[t.attentionType])}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="font-medium text-foreground line-clamp-2">{t.title}</span>
            <PriorityChip priority={t.priority} />
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground/80">{TYPE_LABEL[t.attentionType]}</span>
            <span>·</span>
            <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{t.assigneeName}</span>
            <span>· {t.projectName}</span>
            {t.dueDate && <span>· due {t.dueDate}</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
