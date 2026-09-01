/**
 * Project-level panel: drop a PRD → AI stages stories/tasks in temp_tasks
 * (same table as /prd) → edit → Save to ZET.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileUp, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { PrdDraft, UserStory } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PrdDraftTable } from '@/components/PrdDraftTable';

type Props = {
  projectId: string;
  accentClass?: string;
  onCreated?: (stories: UserStory[]) => void;
};

function emptyDraft(): PrdDraft {
  return { importId: null, sourceText: '', stories: [] };
}

export default function SplitRequirementsPanel({
  projectId,
  accentClass = 'text-primary',
  onCreated,
}: Props) {
  const projects = useAppStore(s => s.projects);
  const syncTasks = useAppStore(s => s.syncTasks);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PrdDraft>(emptyDraft());
  const [dragOver, setDragOver] = useState(false);

  const loadDraft = useCallback(async () => {
    try {
      const d = await api.getPrdDraft();
      const mine = d.stories.length > 0 && d.stories.every(s => !s.projectId || s.projectId === projectId);
      setDraft(mine ? d : emptyDraft());
    } catch {
      setDraft(emptyDraft());
    }
  }, [projectId]);

  useEffect(() => { void loadDraft(); }, [loadDraft]);

  const runAnalyze = async (dropped?: File | null) => {
    const useFile = dropped === undefined ? file : dropped;
    if (!text.trim() && !useFile) {
      toast.error('Paste text or drop a requirements document');
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('project_id', projectId);
      if (text.trim()) fd.append('text', text.trim());
      if (useFile) fd.append('file', useFile);
      const next = await api.analyzePrd(fd);
      setDraft(next);
      if (dropped) setFile(dropped);
      if (!next.stories.length) toast.message('No user stories found in the document');
      else toast.success(`Staged ${next.stories.length} user stor${next.stories.length === 1 ? 'y' : 'ies'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analyze failed');
    } finally {
      setLoading(false);
    }
  };

  const commit = async () => {
    setSaving(true);
    try {
      const res = await api.commitPrdDraft();
      setDraft(emptyDraft());
      setText('');
      setFile(null);
      await syncTasks();
      window.dispatchEvent(new Event('zet:stories-changed'));
      onCreated?.([]);
      toast.success(
        `Saved ${res.storiesCreated} stor${res.storiesCreated === 1 ? 'y' : 'ies'} and ${res.tasksCreated} task${res.tasksCreated === 1 ? '' : 's'}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save to ZET');
    } finally {
      setSaving(false);
    }
  };

  const hasDraft = draft.stories.length > 0;

  return (
    <section className="rounded-2xl border border-border/35 bg-card/40 p-6">
      <div className="flex items-center gap-2 mb-1">
        <FileUp className={`h-4 w-4 ${accentClass}`} />
        <h3 className="text-sm font-bold text-foreground">Split document into user stories</h3>
      </div>
      <p className="text-xs text-muted-foreground/60 mb-4">
        Upload a large requirements file (PDF, DOCX, TXT) or paste text. AI divides it into user stories,
        each with tasks and subtasks.
      </p>

      <div className="space-y-3 mb-4">
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={5}
          placeholder="Paste requirements, specs, or meeting notes…"
          className="font-mono text-xs"
        />
        <div
          onDragOver={e => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) void runAnalyze(f);
          }}
          className={`rounded-xl border border-dashed px-4 py-5 text-center text-xs ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border/40 text-muted-foreground/50'
          }`}
        >
          {file ? (
            <span className="text-foreground font-medium">{file.name}</span>
          ) : (
            <>
              Drag & drop a PDF/DOCX, or{' '}
              <label className="text-primary underline cursor-pointer">
                browse
                <input
                  type="file"
                  className="sr-only"
                  accept=".pdf,.docx,.txt,.md"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void runAnalyze(f);
                  }}
                />
              </label>
            </>
          )}
        </div>
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={loading || (!text.trim() && !file)}
          onClick={() => void runAnalyze()}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Split into stories + tasks
        </Button>
      </div>

      {hasDraft && (
        <PrdDraftTable
          draft={draft}
          projects={projects}
          saving={saving}
          hidePlacement
          onChange={setDraft}
          onCommit={() => void commit()}
        />
      )}
    </section>
  );
}
