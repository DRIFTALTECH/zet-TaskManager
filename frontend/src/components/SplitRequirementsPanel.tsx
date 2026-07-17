/**
 * Project-level panel: upload a large requirements doc → AI splits into
 * user stories, each with tasks and nested subtasks (preview → confirm).
 */
import { useEffect, useState } from 'react';
import { BookOpen, FileUp, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import type { ExtractedStoryPreview, Section, User, UserStory } from '@/types';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type Props = {
  projectId: string;
  sections: Section[];
  members: User[];
  accentClass?: string;
  onCreated?: (stories: UserStory[]) => void;
};

export default function SplitRequirementsPanel({
  projectId,
  sections,
  members: _members,
  accentClass = 'text-primary',
  onCreated,
}: Props) {
  const syncTasks = useAppStore(s => s.syncTasks);
  const [sectionId, setSectionId] = useState(sections[0]?.id ?? '');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ExtractedStoryPreview[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  /** Task keys to create under the selected stories (unchecked = skip). */
  const [includeTaskKeys, setIncludeTaskKeys] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (!sectionId && sections[0]?.id) setSectionId(sections[0].id);
    if (sectionId && !sections.some(s => s.id === sectionId)) {
      setSectionId(sections[0]?.id ?? '');
    }
  }, [sections, sectionId]);

  const runExtract = async () => {
    if (!sectionId) {
      toast.error('Select a section first');
      return;
    }
    if (!text.trim() && !file) {
      toast.error('Paste text or upload a requirements document');
      return;
    }
    setLoading(true);
    try {
      const res = await api.extractUserStories(projectId, sectionId, {
        text: text.trim() || undefined,
        file: file || undefined,
      });
      if (!res.stories.length) {
        toast.message('No user stories found in the document');
        return;
      }
      setPreview(res.stories);
      setChecked(new Set(res.stories.map(s => s.key)));
      const taskKeys = new Set<string>();
      for (const s of res.stories) {
        for (const t of s.tasks ?? []) taskKeys.add(t.key);
      }
      setIncludeTaskKeys(taskKeys);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Extract failed');
    } finally {
      setLoading(false);
    }
  };

  const saveSelected = async () => {
    if (!preview || !sectionId) return;
    const selected = preview.filter(s => checked.has(s.key));
    if (!selected.length) {
      toast.error('Select at least one story');
      return;
    }
    const storiesPayload = selected.map(s => ({
      ...s,
      // Only checked tasks are created; stay unassigned until the story is assigned.
      tasks: (s.tasks ?? [])
        .filter(t => includeTaskKeys.has(t.key))
        .map(t => ({ ...t, assign: false })),
    }));
    const missingTasks = storiesPayload.some(s => (s.tasks?.length ?? 0) === 0);
    if (missingTasks) {
      toast.error('Each selected story needs at least one task checked');
      return;
    }
    setSaving(true);
    try {
      const created = await api.bulkCreateUserStories({
        projectId,
        sectionId,
        stories: storiesPayload,
      });
      const taskCount = storiesPayload.reduce((n, s) => n + (s.tasks?.length ?? 0), 0);
      const subCount = storiesPayload.reduce(
        (n, s) => n + (s.tasks ?? []).reduce((m, t) => m + (t.subtasks?.length ?? 0), 0),
        0,
      );
      toast.success(
        `Created ${created.length} stor${created.length === 1 ? 'y' : 'ies'}` +
          (taskCount ? ` with ${taskCount} task${taskCount === 1 ? '' : 's'}` : '') +
          (subCount ? ` and ${subCount} subtask${subCount === 1 ? '' : 's'}` : ''),
      );
      await syncTasks();
      onCreated?.(created);
      setPreview(null);
      setText('');
      setFile(null);
      setChecked(new Set());
      setIncludeTaskKeys(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  if (sections.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border/40 bg-card/30 p-6">
        <div className="flex items-center gap-2 mb-2">
          <FileUp className={`h-4 w-4 ${accentClass}`} />
          <h3 className="text-sm font-bold text-foreground">Split document into user stories</h3>
        </div>
        <p className="text-xs text-muted-foreground/60">
          Add a section first, then upload a requirements file to generate stories, tasks, and subtasks.
        </p>
      </section>
    );
  }

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

      {!preview ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs font-medium text-muted-foreground shrink-0">Section</label>
            <Select value={sectionId} onValueChange={setSectionId}>
              <SelectTrigger className="w-full sm:w-[240px] h-9 text-xs">
                <SelectValue placeholder="Choose section" />
              </SelectTrigger>
              <SelectContent>
                {sections.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
              if (f) setFile(f);
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
                    onChange={e => setFile(e.target.files?.[0] || null)}
                  />
                </label>
              </>
            )}
          </div>
          <Button type="button" className="w-full sm:w-auto" disabled={loading} onClick={() => void runExtract()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Split into stories + tasks
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => {
                setChecked(new Set(preview.map(s => s.key)));
                const keys = new Set<string>();
                for (const s of preview) for (const t of s.tasks ?? []) keys.add(t.key);
                setIncludeTaskKeys(keys);
              }}
            >
              Select all
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => {
                setChecked(new Set());
                setIncludeTaskKeys(new Set());
              }}
            >
              Deselect all
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setPreview(null)}>
              Back
            </Button>
          </div>
          <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
            {preview.map(s => {
              const taskN = s.tasks?.length ?? 0;
              const includedN = (s.tasks ?? []).filter(t => includeTaskKeys.has(t.key)).length;
              const subN = (s.tasks ?? [])
                .filter(t => includeTaskKeys.has(t.key))
                .reduce((n, t) => n + (t.subtasks?.length ?? 0), 0);
              return (
                <div
                  key={s.key}
                  className="flex items-start gap-2 rounded-xl border border-border/40 p-3 hover:bg-muted/20"
                >
                  <Checkbox
                    checked={checked.has(s.key)}
                    onCheckedChange={() => {
                      setChecked(prev => {
                        const n = new Set(prev);
                        if (n.has(s.key)) n.delete(s.key);
                        else n.add(s.key);
                        return n;
                      });
                    }}
                    className="mt-0.5"
                    aria-label={`Include story ${s.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="truncate" title={s.title}>{s.title}</span>
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-2">{s.description}</p>
                    )}
                    <p className="text-[10px] text-muted-foreground/50 mt-1">
                      {includedN}/{taskN} task{taskN === 1 ? '' : 's'} selected
                      {subN ? ` · ${subN} subtask${subN === 1 ? '' : 's'}` : ''}
                      {' · '}tasks stay unassigned until you assign the story
                    </p>
                    {taskN > 0 && (
                      <ul className="mt-1.5 space-y-1 pl-1 border-l border-border/30 ml-1">
                        {(s.tasks ?? []).map(t => (
                          <li key={t.key} className="flex items-start gap-1.5 text-[11px] text-muted-foreground/80">
                            <Checkbox
                              checked={includeTaskKeys.has(t.key)}
                              className="mt-0.5"
                              onCheckedChange={() => {
                                setIncludeTaskKeys(prev => {
                                  const n = new Set(prev);
                                  if (n.has(t.key)) n.delete(t.key);
                                  else n.add(t.key);
                                  return n;
                                });
                              }}
                              aria-label={`Include task ${t.title}`}
                            />
                            <div className="min-w-0">
                              <span>
                                {t.title}
                                <span className="ml-1 text-muted-foreground/45">
                                  {includeTaskKeys.has(t.key) ? '· include' : '· skip'}
                                </span>
                              </span>
                              {(t.subtasks?.length ?? 0) > 0 && (
                                <ul className="mt-0.5 ml-2 space-y-0.5 border-l border-border/25 pl-2">
                                  {t.subtasks.map(st => (
                                    <li key={st.key} className="text-muted-foreground/55">
                                      ↳ {st.title}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground/50">
            Story checkbox = create story. Task checkbox = create that task (unchecked tasks are skipped).
            Created tasks stay unassigned until you assign the user story.
          </p>
          <Button type="button" className="w-full" disabled={saving} onClick={() => void saveSelected()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create selected stories with tasks
          </Button>
        </div>
      )}
    </section>
  );
}
