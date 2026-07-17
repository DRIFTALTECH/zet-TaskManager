/**
 * Shared multi-assignee checkbox list — same pattern as CreateTaskModal / TaskDetailModal.
 */
import { Checkbox } from '@/components/ui/checkbox';
import type { User } from '@/types';

export default function AssigneeMultiSelect({
  members,
  selectedIds,
  onChange,
  emptyHint = 'No project members',
}: {
  members: User[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
  emptyHint?: string;
}) {
  const toggle = (userId: string) => {
    const n = new Set(selectedIds);
    if (n.has(userId)) n.delete(userId);
    else n.add(userId);
    onChange(n);
  };

  if (members.length === 0) {
    return <p className="text-xs text-muted-foreground/50 italic py-2">{emptyHint}</p>;
  }

  return (
    <div className="rounded-xl border border-border/40 divide-y divide-border/30 max-h-48 overflow-y-auto">
      {members.map(u => (
        <label
          key={u.id}
          className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors duration-100"
        >
          <Checkbox checked={selectedIds.has(u.id)} onCheckedChange={() => toggle(u.id)} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{u.name}</div>
            {u.email && (
              <div className="text-[11px] text-muted-foreground/55 truncate">{u.email}</div>
            )}
          </div>
          <div className="h-7 w-7 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
            {(u.name || '?').slice(0, 2).toUpperCase()}
          </div>
        </label>
      ))}
    </div>
  );
}
