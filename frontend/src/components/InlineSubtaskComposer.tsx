import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';

import { useSlowFlag } from '@/hooks/useSlowFlag';
import { cn } from '@/lib/utils';

/**
 * Add a subtask where you are looking at the task, without a dialog.
 *
 * Shared by the board card and the task detail view so the gesture is the same
 * in both: a quiet link that becomes a field, Enter to add, Escape to leave.
 * The field stays open and clears itself, because subtasks arrive in threes
 * more often than alone and reopening the composer for each one is the whole
 * cost of adding them.
 */
export function InlineSubtaskComposer({
  onAdd,
  className,
  inputClassName,
  autoOpen = false,
  label = 'Add subtask',
}: {
  onAdd: (title: string) => Promise<void>;
  className?: string;
  inputClassName?: string;
  /** Start in the open state — for a caller that already decided to add one. */
  autoOpen?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(autoOpen);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  // The field empties itself on success, so a slow save looked like a key press
  // that did nothing — right up until the subtask appeared.
  const slow = useSlowFlag(saving);

  const submit = async () => {
    const value = title.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await onAdd(value);
      setTitle('');
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(true); }}
        className={cn(
          'inline-flex items-center gap-1 rounded-lg px-1 py-0.5 text-[11px] font-medium',
          'text-muted-foreground hover:text-foreground hover:bg-muted/60',
          className,
        )}
      >
        <Plus className="h-3 w-3" /> {label}
      </button>
    );
  }

  return (
    <div className="relative">
      <input
        autoFocus
        value={title}
        disabled={saving}
        placeholder="Subtask title…"
        onClick={e => e.stopPropagation()}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          e.stopPropagation();
          if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          // Nothing typed yet means nothing to lose, so Escape just leaves.
          if (e.key === 'Escape') { setOpen(false); setTitle(''); }
        }}
        onBlur={() => { if (!title.trim()) setOpen(false); }}
        className={cn(
          'w-full rounded-lg border border-border/70 bg-background px-2 py-1 text-[13px]',
          'placeholder:text-muted-foreground/45 focus:border-primary/40 focus:outline-none',
          'focus:ring-1 focus:ring-primary/30 disabled:opacity-60',
          slow && 'pr-7',
          inputClassName,
        )}
      />
      {slow && (
        <Loader2
          aria-label="Adding subtask"
          className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-primary"
        />
      )}
    </div>
  );
}

export default InlineSubtaskComposer;
