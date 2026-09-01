import { BookOpen, Check, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { PrdDraft, PrdDraftStory, PrdDraftTask } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'] as const;

type ProjectOpt = { id: string; name: string; sections?: { id: string; name: string }[] };

export function PrdDraftTable({
  draft,
  projects,
  saving,
  hidePlacement,
  onChange,
  onCommit,
}: {
  draft: PrdDraft;
  projects: ProjectOpt[];
  saving: boolean;
  hidePlacement?: boolean;
  onChange: (next: PrdDraft) => void;
  onCommit: () => void;
}) {
  const patch = async (id: string, body: Parameters<typeof api.patchPrdItem>[1]) => {
    try {
      onChange(await api.patchPrdItem(id, body));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save edit');
    }
  };

  const discard = async () => {
    try {
      onChange(await api.discardPrdDraft());
      toast.message('Draft discarded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not discard');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {draft.stories.length} user stor{draft.stories.length === 1 ? 'y' : 'ies'} staged
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void api.addPrdStory().then(onChange)}>
            <Plus className="h-3.5 w-3.5" /> Story
          </Button>
          <Button variant="outline" size="sm" onClick={() => void discard()}>
            Discard
          </Button>
          <Button size="sm" onClick={() => void onCommit()} disabled={saving}>
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
            hidePlacement={hidePlacement}
            onPatch={patch}
            onAddTask={() => api.addPrdTask(story.id).then(onChange)}
            onDelete={() => api.deletePrdItem(story.id).then(onChange)}
            onDeleteTask={id => api.deletePrdItem(id).then(onChange)}
          />
        ))}
      </div>
    </section>
  );
}

function StoryEditor({
  story,
  projects,
  hidePlacement,
  onPatch,
  onAddTask,
  onDelete,
  onDeleteTask,
}: {
  story: PrdDraftStory;
  projects: ProjectOpt[];
  hidePlacement?: boolean;
  onPatch: (id: string, body: Parameters<typeof api.patchPrdItem>[1]) => Promise<void>;
  onAddTask: () => Promise<void>;
  onDelete: () => Promise<void>;
  onDeleteTask: (id: string) => Promise<void>;
}) {
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

      {!hidePlacement && (
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Project</span>
          <select
            value={story.projectId ?? ''}
            onChange={e => void onPatch(story.id, { projectId: e.target.value })}
            className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">Choose project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      )}

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
  onDelete: () => Promise<void>;
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
