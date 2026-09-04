/**
 * SubtaskSection — shared subtask UI backed by the checklist API.
 * - SubtaskDraftSection: local rows while creating a task (no task id yet).
 * - SubtaskManager: load and manage subtasks on an existing task.
 */

import { FIELD_INPUT as inputCls } from '@/lib/field-styles';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare, ListChecks, Plus, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { queryClient, taskKeys } from '@/lib/queryClient';
import type { TaskChecklist } from '@/types';
import { newSubtaskDraftRow, type SubtaskDraftRow } from '@/lib/subtask-utils';
import { cn } from '@/lib/utils';


// ── Draft (create task) ───────────────────────────────────────────────────────

type DraftProps = {
  rows: SubtaskDraftRow[];
  onChange: (rows: SubtaskDraftRow[]) => void;
  className?: string;
};

export function SubtaskDraftSection({ rows, onChange, className }: DraftProps) {
  const updateRow = (id: string, title: string) => {
    onChange(rows.map(r => (r.id === id ? { ...r, title } : r)));
  };

  const removeRow = (id: string) => {
    const next = rows.filter(r => r.id !== id);
    onChange(next.length > 0 ? next : [newSubtaskDraftRow()]);
  };

  const addRow = () => onChange([...rows, newSubtaskDraftRow()]);

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" /> Subtasks
      </div>
      <p className="text-xs text-muted-foreground -mt-1">Break the work into smaller steps. Empty rows are ignored.</p>

      <div className="space-y-2">
        {rows.map((row, index) => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              value={row.title}
              onChange={e => updateRow(row.id, e.target.value)}
              className={inputCls}
              placeholder={index === 0 ? 'Subtask name' : 'Another subtask'}
              aria-label="Subtask name"
            />
            <button
              type="button"
              onClick={() => removeRow(row.id)}
              className="shrink-0 p-2 rounded-lg border border-border/60 text-muted-foreground hover:text-destructive hover:border-destructive/30 hover:bg-destructive/5 transition-colors"
              aria-label="Delete subtask"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={addRow}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
      >
        <Plus className="h-3.5 w-3.5" /> Add Subtask
      </button>
    </div>
  );
}

// ── Persisted (edit existing task) ────────────────────────────────────────────

type ManagerProps = {
  taskId: string;
  className?: string;
};

export function SubtaskManager({ taskId, className }: ManagerProps) {
  const { data: items = [], isLoading: loading } = useQuery({
    queryKey: taskKeys.checklists(taskId),
    queryFn: () => api.getChecklists(taskId),
    enabled: !!taskId,
    staleTime: Infinity,
  });
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  useEffect(() => {
    setShowAddForm(false);
    setNewTitle('');
    setEditingId(null);
  }, [taskId]);

  const done = items.filter(c => c.isDone).length;
  const total = items.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  const isDuplicateTitle = (title: string, excludeId?: string) => {
    const key = title.trim().toLowerCase();
    if (!key) return false;
    return items.some(c => c.id !== excludeId && c.title.trim().toLowerCase() === key);
  };

  const addSubtask = async () => {
    const title = newTitle.trim();
    if (!title) return;
    if (isDuplicateTitle(title)) {
      toast.error('A subtask with this name already exists.');
      return;
    }
    setAdding(true);
    try {
      const item = await api.createChecklist(taskId, title);
      queryClient.setQueryData(taskKeys.checklists(taskId), (prev: TaskChecklist[] | undefined) => [...(prev ?? []), item]);
      setNewTitle('');
      setShowAddForm(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add subtask');
    } finally {
      setAdding(false);
    }
  };

  const toggleDone = async (item: TaskChecklist) => {
    try {
      const updated = await api.patchChecklist(taskId, item.id, { isDone: !item.isDone });
      queryClient.setQueryData(taskKeys.checklists(taskId), (prev: TaskChecklist[] | undefined) =>
        (prev ?? []).map(c => (c.id === updated.id ? updated : c)),
      );
    } catch {
      toast.error('Could not update subtask');
    }
  };

  const saveEdit = async (item: TaskChecklist) => {
    const title = editingTitle.trim();
    setEditingId(null);
    if (!title || title === item.title) return;
    if (isDuplicateTitle(title, item.id)) {
      toast.error('A subtask with this name already exists.');
      return;
    }
    try {
      const updated = await api.patchChecklist(taskId, item.id, { title });
      queryClient.setQueryData(taskKeys.checklists(taskId), (prev: TaskChecklist[] | undefined) =>
        (prev ?? []).map(c => (c.id === updated.id ? updated : c)),
      );
    } catch {
      toast.error('Could not edit subtask');
    }
  };

  const deleteSubtask = async (itemId: string) => {
    try {
      await api.deleteChecklist(taskId, itemId);
      queryClient.setQueryData(taskKeys.checklists(taskId), (prev: TaskChecklist[] | undefined) =>
        (prev ?? []).filter(c => c.id !== itemId),
      );
    } catch {
      toast.error('Could not delete subtask');
    }
  };

  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
          <CheckSquare className="h-3.5 w-3.5 shrink-0" />
          <span>Subtasks {total > 0 ? `(${done}/${total} completed)` : ''}</span>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm(v => !v)}
          className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary/8 transition-colors font-medium"
        >
          <Plus className="h-3 w-3" /> Add Subtask
        </button>
      </div>

      {total > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 mb-1">
            <span>Progress</span>
            <span className={pct === 100 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}>
              {done}/{total} · {pct}%
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-500', pct === 100 ? 'bg-emerald-500' : 'bg-primary')}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-4 flex justify-center">
          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map(item => {
            const isEditing = editingId === item.id;
            return (
              <div
                key={item.id}
                className="flex items-center gap-2.5 group rounded-xl px-2 py-1.5 hover:bg-muted/30 transition-colors"
              >
                <button
                  type="button"
                  onClick={() => void toggleDone(item)}
                  className="shrink-0 text-muted-foreground/50 hover:text-primary transition-colors"
                  title={item.isDone ? 'Mark as not completed' : 'Mark as completed'}
                  aria-label={item.isDone ? 'Mark as not completed' : 'Mark as completed'}
                >
                  {item.isDone
                    ? <CheckSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    : <Square className="h-4 w-4" />}
                </button>
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingTitle}
                    onChange={e => setEditingTitle(e.target.value)}
                    onBlur={() => void saveEdit(item)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') void saveEdit(item);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="flex-1 min-w-0 text-sm bg-transparent border border-border/40 rounded-md px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary/40"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditingId(item.id); setEditingTitle(item.title); }}
                    className={cn(
                      'flex-1 text-sm min-w-0 truncate text-left',
                      item.isDone ? 'line-through text-muted-foreground/40' : 'text-foreground',
                    )}
                    title="Click to edit"
                  >
                    {item.title}
                  </button>
                )}
                {item.isDone && !isEditing && (
                  <span className="text-[10px] font-semibold text-emerald-500 shrink-0">Completed</span>
                )}
                <button
                  type="button"
                  onClick={() => void deleteSubtask(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-600 dark:text-red-400 transition-all shrink-0"
                  aria-label="Delete subtask"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <div className="mt-3 flex items-center gap-2 p-3 rounded-xl border border-border/40 bg-muted/20">
          <input
            autoFocus
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void addSubtask();
              if (e.key === 'Escape') setShowAddForm(false);
            }}
            placeholder="Subtask name"
            className="flex-1 bg-transparent text-sm border border-border/40 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/35"
          />
          <button
            type="button"
            onClick={() => void addSubtask()}
            disabled={adding || !newTitle.trim()}
            className="text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 font-semibold transition-all shrink-0"
          >
            {adding ? '…' : 'Add'}
          </button>
          <button
            type="button"
            onClick={() => setShowAddForm(false)}
            className="text-xs px-3 py-2 rounded-lg border border-border/40 hover:bg-muted/60 transition-colors text-muted-foreground shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {total === 0 && !showAddForm && !loading && (
        <p className="text-xs text-muted-foreground/35 italic">No subtasks yet</p>
      )}
    </section>
  );
}
