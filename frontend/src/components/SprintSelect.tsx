import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { queryClient, storyKeys } from '@/lib/queryClient';
import type { UserStory } from '@/types';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const NONE = '__none__';

export function SprintSelect({
  value,
  onChange,
  projectId,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  projectId?: string | null;
  id?: string;
}) {
  const tasks = useAppStore(s => s.tasks);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const names = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (projectId && t.projectId !== projectId) continue;
      const s = t.sprint?.trim();
      if (s) set.add(s);
    }
    for (const st of queryClient.getQueryData<UserStory[]>(storyKeys.all) ?? []) {
      if (projectId && st.projectId !== projectId) continue;
      const s = st.sprint?.trim();
      if (s) set.add(s);
    }
    const current = value.trim();
    if (current) set.add(current);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [tasks, projectId, value]);

  const commitNew = () => {
    onChange(draft.trim().slice(0, 120));
    setDraft('');
    setAdding(false);
  };

  if (adding) {
    return (
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          maxLength={120}
          placeholder="Sprint name"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commitNew(); }
            if (e.key === 'Escape') { setAdding(false); setDraft(''); }
          }}
          className="w-full rounded-xl border border-border/80 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <Button type="button" size="sm" className="shrink-0" onClick={commitNew} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Select value={value.trim() || NONE} onValueChange={v => onChange(v === NONE ? '' : v)}>
        <SelectTrigger id={id} className={cn('w-full rounded-xl')}>
          <SelectValue placeholder="No sprint" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No sprint</SelectItem>
          {names.map(s => (
            <SelectItem key={s} value={s}>{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="shrink-0 rounded-xl"
        aria-label="Add sprint"
        onClick={() => setAdding(true)}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
