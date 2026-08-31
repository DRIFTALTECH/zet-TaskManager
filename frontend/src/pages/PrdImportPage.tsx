/**
 * Manager/superadmin page: paste or upload a PRD → Analyze → edit staged
 * stories/tasks (temp_tasks) → Save to ZET (real tables, temp cleared).
 */
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  FileText, Loader2, Plus, Sparkles, Trash2, Upload, Check, BookOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { pageEnter } from '@/lib/motion';
import type { PrdDraft, PrdDraftStory, PrdDraftTask } from '@/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'] as const;

function emptyDraft(): PrdDraft {
  return { importId: null, sourceText: '', stories: [] };
}

export default function PrdImportPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const syncTasks = useAppStore(s => s.syncTasks);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';

  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<PrdDraft>(emptyDraft());
  const [loaded, setLoaded] = useState(false);

  const loadDraft = useCallback(async () => {
    try {
      setDraft(await api.getPrdDraft());
    } catch {
      setDraft(emptyDraft());
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { void loadDraft(); }, [loadDraft]);

  if (!isManager) return <Navigate to="/" replace />;

  const apply = (next: PrdDraft) => setDraft(next);

  const analyze = async () => {
    if (!text.trim() && !file) {
      toast.error('Paste a PRD or upload a document');
      return;
    }
    setAnalyzing(true);
    try {
      const fd = new FormData();
      if (text.trim()) fd.append('text', text.trim());
      if (file) fd.append('file', file);
      const next = await api.analyzePrd(fd);
      apply(next);
      if (!next.stories.length) toast.message('No user stories found in that PRD');
      else toast.success(`Staged ${next.stories.length} user stor${next.stories.length === 1 ? 'y' : 'ies'} in temp_tasks`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Analyze failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const patch = async (id: string, body: Parameters<typeof api.patchPrdItem>[1]) => {
    try {
      apply(await api.patchPrdItem(id, body));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save edit');
      await loadDraft();
    }
  };

  const commit = async () => {
    setSaving(true);
    try {
      const res = await api.commitPrdDraft();
      apply(emptyDraft());
      setText('');
      setFile(null);
      await syncTasks();
      toast.success(
        `Saved ${res.storiesCreated} stor${res.storiesCreated === 1 ? 'y' : 'ies'} and ${res.tasksCreated} task${res.tasksCreated === 1 ? '' : 's'}`,
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save to ZET');
    } finally {
      setSaving(false);
    }
  };

  const discard = async () => {
    try {
      apply(await api.discardPrdDraft());
      toast.message('Draft discarded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not discard');
    }
  };

  const hasDraft = draft.stories.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="mx-auto max-w-4xl space-y-6 p-6"
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PRD import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste or upload a PRD, click Analyze, edit the stories and tasks, then save them into ZET.
          Nothing is assigned. Staging is stored in temp_tasks until you save.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-border/40 bg-card/40 p-5">
        <Textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          placeholder="Paste the PRD or spec here…"
          className="resize-y bg-background"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold hover:bg-muted/50">
            <Upload className="h-3.5 w-3.5" />
            {file ? file.name : 'Upload PDF, DOCX, or TXT'}
            <input
              type="file"
              className="hidden"
              accept=".pdf,.docx,.txt,.md,.csv"
              onChange={e => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <Button onClick={() => void analyze()} disabled={analyzing || (!text.trim() && !file)}>
            {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Analyze
          </Button>
        </div>
      </section>

      {!loaded ? (
        <p className="text-sm text-muted-foreground">Loading draft…</p>
      ) : !hasDraft ? (
        <p className="rounded-xl border border-dashed border-border/40 px-4 py-10 text-center text-sm text-muted-foreground">
          No staged work. Analyze a PRD to see user stories and tasks here.
        </p>
      ) : (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">
              {draft.stories.length} user stor{draft.stories.length === 1 ? 'y' : 'ies'} staged
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void api.addPrdStory().then(apply)}>
                <Plus className="h-3.5 w-3.5" /> Story
              </Button>
              <Button variant="outline" size="sm" onClick={() => void discard()}>
                Discard
              </Button>
              <Button size="sm" onClick={() => void commit()} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save to ZET
              </Button>
            </div>
          </div>

          {draft.sourceText && (
            <details className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/60">
                Source PRD
              </summary>
              <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">
                {draft.sourceText}
              </p>
            </details>
          )}

          <div className="space-y-4">
            {draft.stories.map(story => (
              <StoryEditor
                key={story.id}
                story={story}
                projects={projects}
                onPatch={patch}
                onAddTask={() => api.addPrdTask(story.id).then(apply)}
                onDelete={() => api.deletePrdItem(story.id).then(apply)}
                onDeleteTask={id => api.deletePrdItem(id).then(apply)}
              />
            ))}
          </div>
        </section>
      )}
    </motion.div>
  );
}

function StoryEditor({
  story,
  projects,
  onPatch,
  onAddTask,
  onDelete,
  onDeleteTask,
}: {
  story: PrdDraftStory;
  projects: { id: string; name: string; sections?: { id: string; name: string }[] }[];
  onPatch: (id: string, body: Parameters<typeof api.patchPrdItem>[1]) => Promise<void>;
  onAddTask: () => Promise<PrdDraft>;
  onDelete: () => Promise<PrdDraft>;
  onDeleteTask: (id: string) => Promise<PrdDraft>;
}) {
  const sections = projects.find(p => p.id === story.projectId)?.sections ?? [];

  return (
    <article className="space-y-3 rounded-2xl border border-border/40 bg-card/50 p-4">
      <div className="flex items-start gap-2">
        <BookOpen className="mt-2 h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
        <Input
          defaultValue={story.title}
          onBlur={e => {
            const v = e.target.value.trim();
            if (v && v !== story.title) void onPatch(story.id, { title: v });
          }}
          className="font-semibold"
        />
        <select
          value={story.priority ?? 'Medium'}
          onChange={e => void onPatch(story.id, { priority: e.target.value })}
          className="h-10 rounded-md border border-input bg-background px-2 text-xs"
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete story"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <Textarea
        defaultValue={story.description ?? ''}
        placeholder="Story description"
        rows={3}
        onBlur={e => {
          if (e.target.value !== (story.description ?? '')) {
            void onPatch(story.id, { description: e.target.value });
          }
        }}
      />
      <Textarea
        defaultValue={story.acceptanceCriteria ?? ''}
        placeholder="Acceptance criteria"
        rows={2}
        onBlur={e => {
          if (e.target.value !== (story.acceptanceCriteria ?? '')) {
            void onPatch(story.id, { acceptanceCriteria: e.target.value });
          }
        }}
      />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</span>
          <select
            value={story.projectId ?? ''}
            onChange={e => void onPatch(story.id, { projectId: e.target.value, sectionId: '' })}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Choose project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Section</span>
          <select
            value={story.sectionId ?? ''}
            disabled={!story.projectId}
            onChange={e => void onPatch(story.id, { sectionId: e.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm disabled:opacity-50"
          >
            <option value="">Choose section…</option>
            {sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Tasks · unassigned
          </p>
          <Button variant="ghost" size="sm" onClick={() => void onAddTask()}>
            <Plus className="h-3.5 w-3.5" /> Task
          </Button>
        </div>
        {(story.tasks ?? []).map(task => (
          <TaskEditor key={task.id} task={task} onPatch={onPatch} onDelete={() => onDeleteTask(task.id)} />
        ))}
      </div>
    </article>
  );
}

function TaskEditor({
  task,
  onPatch,
  onDelete,
}: {
  task: PrdDraftTask;
  onPatch: (id: string, body: Parameters<typeof api.patchPrdItem>[1]) => Promise<void>;
  onDelete: () => Promise<PrdDraft>;
}) {
  return (
    <div className="space-y-2 rounded-xl border border-border/40 bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <FileText className="mt-2.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Input
          defaultValue={task.title}
          onBlur={e => {
            const v = e.target.value.trim();
            if (v && v !== task.title) void onPatch(task.id, { title: v });
          }}
        />
        <select
          value={task.priority ?? 'Medium'}
          onChange={e => void onPatch(task.id, { priority: e.target.value })}
          className="h-10 rounded-md border border-input bg-background px-2 text-xs"
        >
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label="Delete task"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      <Textarea
        defaultValue={task.description ?? ''}
        placeholder="Task description"
        rows={2}
        onBlur={e => {
          if (e.target.value !== (task.description ?? '')) {
            void onPatch(task.id, { description: e.target.value });
          }
        }}
      />
    </div>
  );
}
