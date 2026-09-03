/**
 * Project-level panel: drop a PRD → AI stages user stories (same as /prd)
 * → review/assign → Save story only (no tasks).
 */
import { useCallback, useEffect, useState } from 'react';
import { FileUp, Loader2, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { PrdDraft, UserStory } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { PrdStudio } from '@/components/prd/PrdStudio';
import { mergePrdFiles, PRD_FILE_ACCEPT, coercePrdDraft } from '@/lib/prdSession';
import { invalidateUserStories } from '@/lib/queryClient';

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
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PrdDraft>(emptyDraft());
  const [dragOver, setDragOver] = useState(false);

  const loadDraft = useCallback(async () => {
    try {
      const next = coercePrdDraft(await api.getPrdDraft());
      const mine = next.stories.length > 0 && next.stories.every(s => !s.projectId || s.projectId === projectId);
      setDraft(mine ? next : emptyDraft());
    } catch {
      setDraft(emptyDraft());
    }
  }, [projectId]);

  useEffect(() => { void loadDraft(); }, [loadDraft]);

  const runAnalyze = async () => {
    if (!text.trim() && files.length === 0) {
      toast.error('Paste text or drop a requirements document');
      return;
    }
    setLoading(true);
    setDraft(emptyDraft());
    try {
      const fd = new FormData();
      fd.append('project_id', projectId);
      if (text.trim()) fd.append('text', text.trim());
      for (const f of files) fd.append('files', f);
      let finished: PrdDraft | null = null;
      await api.analyzePrdStream(fd, ev => {
        if (ev.type === 'story') {
          setDraft(prev => ({
            ...prev,
            stories: [...prev.stories.filter(s => s.id !== ev.story.id), ev.story],
          }));
        }
        if (ev.type === 'done') {
          finished = coercePrdDraft(ev.draft);
        }
        if (ev.type === 'error') throw new Error(ev.message);
      });
      const next = coercePrdDraft(finished ?? emptyDraft());
      setDraft(next);
      if (!next.stories.length) toast.message('No user stories found in the document');
      else toast.success(`Staged ${next.stories.length} user stor${next.stories.length === 1 ? 'y' : 'ies'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analyze failed');
    } finally {
      setLoading(false);
    }
  };

  const commit = async (storyIds: string[]) => {
    setSaving(true);
    try {
      const res = await api.commitPrdDraft(storyIds, []);
      const leftover = coercePrdDraft(await api.getPrdDraft());
      const mine = leftover.stories.length > 0 && leftover.stories.every(s => !s.projectId || s.projectId === projectId);
      setDraft(mine ? leftover : emptyDraft());
      if (!mine || leftover.stories.length === 0) {
        setText('');
        setFiles([]);
      }
      await syncTasks();
      invalidateUserStories();
      window.dispatchEvent(new Event('zet:stories-changed'));
      onCreated?.([]);
      toast.success(
        `Saved ${res.storiesCreated} user stor${res.storiesCreated === 1 ? 'y' : 'ies'}`,
      );
      return { storyIds: res.storyIds ?? [] };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save story');
      throw e;
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
        Upload a PRD or paste text. Same as /prd: stories first, then open a story to
        edit/save and generate tasks.
      </p>

      <div
        className="space-y-3 mb-4"
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={e => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setDragOver(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          setFiles(prev => mergePrdFiles(prev, e.dataTransfer.files));
        }}
      >
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault();
            setDragOver(false);
            setFiles(prev => mergePrdFiles(prev, e.dataTransfer.files));
          }}
          rows={5}
          placeholder="Paste requirements, specs, or meeting notes — or drop PDFs here…"
          className={`font-mono text-xs ${dragOver ? 'border-primary bg-primary/5' : ''}`}
        />
        <div
          className={`rounded-xl border border-dashed px-4 py-5 text-center text-xs ${
            dragOver ? 'border-primary bg-primary/5' : 'border-border/40 text-muted-foreground/50'
          }`}
        >
          {files.length > 0 ? (
            <div className="flex flex-wrap justify-center gap-2">
              {files.map(f => (
                <span key={`${f.name}-${f.size}`} className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 font-mono text-[11px] text-foreground">
                  {f.name}
                  <button type="button" onClick={() => setFiles(prev => prev.filter(x => x !== f))} aria-label={`Remove ${f.name}`}>
                    <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <>
              Drag & drop PDFs, or{' '}
              <label className="text-primary underline cursor-pointer">
                browse
                <input
                  type="file"
                  className="sr-only"
                  accept={PRD_FILE_ACCEPT}
                  multiple
                  onChange={e => {
                    const picked = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    setFiles(prev => mergePrdFiles(prev, picked));
                  }}
                />
              </label>
            </>
          )}
        </div>
        {files.length > 0 && (
          <label className="text-xs text-primary underline cursor-pointer">
            Add more files
            <input
              type="file"
              className="sr-only"
              accept={PRD_FILE_ACCEPT}
              multiple
              onChange={e => {
                const picked = Array.from(e.target.files ?? []);
                e.target.value = '';
                setFiles(prev => mergePrdFiles(prev, picked));
              }}
            />
          </label>
        )}
        <Button
          type="button"
          className="w-full sm:w-auto"
          disabled={loading || (!text.trim() && files.length === 0)}
          onClick={() => void runAnalyze()}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Split into stories
        </Button>
      </div>

      {(hasDraft || loading) && (
        <PrdStudio
          draft={draft}
          projects={projects}
          saving={saving || loading}
          analyzing={loading}
          lockProjectId={projectId}
          onChange={setDraft}
          onCommit={commit}
        />
      )}
    </section>
  );
}
