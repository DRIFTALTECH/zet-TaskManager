import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { GeneratedTaskPreview, UserStoryGeneratePreview } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function GenerateTasksPreviewDialog({
  preview,
  replaceGenerated,
  previewOnly,
  onClose,
  onConfirmed,
}: {
  preview: UserStoryGeneratePreview;
  replaceGenerated?: boolean;
  /** Show the generated list only — do not persist tasks. */
  previewOnly?: boolean;
  onClose: () => void;
  onConfirmed?: (tasks: GeneratedTaskPreview[]) => Promise<void>;
}) {
  const tasks = Array.isArray(preview.tasks) ? preview.tasks : [];
  const [includeTasks, setIncludeTasks] = useState<Set<string>>(
    () => new Set(tasks.map(t => t.key)),
  );
  const [includeSubs, setIncludeSubs] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const t of tasks) for (const st of t.subtasks ?? []) s.add(st.key);
    return s;
  });
  const [saving, setSaving] = useState(false);

  const allTaskKeys = tasks.map(t => t.key);
  const allSubKeys = tasks.flatMap(t => (t.subtasks ?? []).map(s => s.key));

  const confirm = async () => {
    if (!onConfirmed) return;
    const selected: GeneratedTaskPreview[] = tasks
      .filter(t => includeTasks.has(t.key))
      .map(t => ({
        ...t,
        subtasks: (t.subtasks ?? []).filter(st => includeSubs.has(st.key)),
      }));
    if (!selected.length) {
      toast.error('Select at least one task to create');
      return;
    }
    setSaving(true);
    try {
      await onConfirmed(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review generated tasks</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {previewOnly
            ? 'Suggested tasks for this draft. Nothing is saved until you save the story.'
            : `Check tasks to create under this user story.${replaceGenerated ? ' AI-generated tasks will be replaced on confirm.' : ''}`}
        </p>
        {!previewOnly && (
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => {
                setIncludeTasks(new Set(allTaskKeys));
                setIncludeSubs(new Set(allSubKeys));
              }}
            >
              Include all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => setIncludeTasks(new Set())}
            >
              Include none
            </Button>
          </div>
        )}
        <div className="space-y-2">
          {tasks.map(t => (
            <div key={t.key} className="rounded-md border border-border/40 p-2 space-y-1.5">
              <label className={previewOnly ? 'flex items-start gap-2' : 'flex items-start gap-2 cursor-pointer'}>
                {!previewOnly && (
                  <Checkbox
                    checked={includeTasks.has(t.key)}
                    onCheckedChange={() => {
                      setIncludeTasks(prev => {
                        const n = new Set(prev);
                        if (n.has(t.key)) n.delete(t.key);
                        else n.add(t.key);
                        return n;
                      });
                    }}
                  />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.title}</div>
                  {t.description && (
                    <div className="text-[11px] text-muted-foreground/70 mt-0.5">{t.description}</div>
                  )}
                </div>
              </label>
              {(t.subtasks ?? []).length > 0 && (
                <div className="ml-6 space-y-1 border-l border-border/30 pl-2">
                  {(t.subtasks ?? []).map(st => (
                    <label key={st.key} className={previewOnly ? 'flex items-start gap-2' : 'flex items-start gap-2 cursor-pointer'}>
                      {!previewOnly && (
                        <Checkbox
                          checked={includeSubs.has(st.key)}
                          onCheckedChange={() => {
                            setIncludeSubs(prev => {
                              const n = new Set(prev);
                              if (n.has(st.key)) n.delete(st.key);
                              else n.add(st.key);
                              return n;
                            });
                          }}
                        />
                      )}
                      <span className="text-[12px]">{st.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          {previewOnly ? (
            <Button type="button" onClick={onClose}>
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="button" disabled={saving} onClick={() => void confirm()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Create tasks
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
