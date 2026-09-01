import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BookOpen, Check, Filter, FolderOpen, Layers, Loader2, Plus, Trash2, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { clearPrdPicks, loadPrdPicks, savePrdPicks } from '@/lib/prdSession';
import type { PrdDraft, User } from '@/types';
import { cn } from '@/lib/utils';
import AssigneeMultiSelect from '@/components/AssigneeMultiSelect';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select';

const PRIORITIES = ['Urgent', 'High', 'Medium', 'Low'] as const;

const PRI: Record<string, string> = {
  Urgent: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
  High: 'border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400',
  Medium: 'border-yellow-500/35 bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  Low: 'border-green-500/30 bg-green-500/15 text-green-600 dark:text-green-400',
};

type ProjectOpt = {
  id: string;
  name: string;
  members?: string[];
  sections?: { id: string; name: string }[];
};

export function PrdStudio({
  draft,
  projects,
  saving,
  analyzing = false,
  pendingStoryIds,
  lockProjectId,
  onChange,
  onCommit,
}: {
  draft: PrdDraft;
  projects: ProjectOpt[];
  saving: boolean;
  analyzing?: boolean;
  pendingStoryIds?: Set<string>;
  lockProjectId?: string;
  onChange: (next: PrdDraft) => void;
  onCommit: (storyIds: string[], taskIds: string[]) => void | Promise<void>;
}) {
  const users = useAppStore(s => s.users);
  const stories = draft.stories;
  const [storyOn, setStoryOn] = useState<Record<string, boolean>>(() => loadPrdPicks(draft.importId).stories);
  const [taskOn, setTaskOn] = useState<Record<string, boolean | undefined>>(() => loadPrdPicks(draft.importId).tasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyFilter, setStoryFilter] = useState('all');

  useEffect(() => {
    const saved = loadPrdPicks(draft.importId);
    setStoryOn(saved.stories);
    setTaskOn(saved.tasks);
  }, [draft.importId]);

  useEffect(() => {
    setStoryOn(prev => {
      const next = { ...prev };
      for (const s of stories) if (!(s.id in next)) next[s.id] = false;
      return next;
    });
    setTaskOn(prev => {
      const next = { ...prev };
      for (const s of stories) for (const t of s.tasks) if (!(t.id in next)) next[t.id] = undefined;
      return next;
    });
    setActiveId(cur => (cur && stories.some(s => s.id === cur) ? cur : stories[0]?.id ?? null));
    setStoryFilter(cur =>
      cur === 'all' || cur === 'accepted' || cur === 'pending' || stories.some(s => s.id === cur) ? cur : 'all',
    );
  }, [stories]);

  useEffect(() => {
    savePrdPicks(draft.importId, { stories: storyOn, tasks: taskOn });
  }, [storyOn, taskOn, draft.importId]);

  const visibleStories = useMemo(() => {
    if (storyFilter === 'accepted') return stories.filter(s => storyOn[s.id]);
    if (storyFilter === 'pending') return stories.filter(s => !storyOn[s.id]);
    if (storyFilter !== 'all') return stories.filter(s => s.id === storyFilter);
    return stories;
  }, [stories, storyOn, storyFilter]);
  const active = stories.find(s => s.id === activeId) ?? null;
  const openTask = active?.tasks.find(t => t.id === openTaskId) ?? null;

  const openStory = (id: string) => {
    setActiveId(id);
    setOpenTaskId(null);
    setStoryOpen(true);
  };
  const storyIds = useMemo(() => stories.filter(s => storyOn[s.id]).map(s => s.id), [stories, storyOn]);
  const taskIds = useMemo(
    () => stories.flatMap(s => s.tasks.filter(t => taskOn[t.id] === true).map(t => t.id)),
    [stories, taskOn],
  );
  const pending = pendingStoryIds ?? new Set<string>();
  const writing = Boolean(active && pending.has(active.id) && active.tasks.length === 0);
  const busy = saving || analyzing;

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
      clearPrdPicks(draft.importId);
      setStoryOn({});
      setTaskOn({});
      setActiveId(null);
      setOpenTaskId(null);
      setStoryOpen(false);
      toast.message('Draft discarded');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not discard');
    }
  };

  const acceptTask = (storyId: string, taskId: string) => {
    setTaskOn(c => ({ ...c, [taskId]: true }));
    setStoryOn(c => ({ ...c, [storyId]: true }));
  };

  const saveStory = async (storyId: string) => {
    const story = stories.find(s => s.id === storyId);
    if (!story) return;
    const ids = story.tasks.filter(t => taskOn[t.id] === true).map(t => t.id);
    try {
      await onCommit([story.id], ids);
      setStoryOpen(false);
      setOpenTaskId(null);
    } catch {
      /* page already toasts */
    }
  };

  const loc = (projectId?: string | null, sectionId?: string | null) => {
    const p = projects.find(x => x.id === projectId);
    const s = p?.sections?.find(x => x.id === sectionId);
    return {
      project: p?.name ?? (projectId ? 'Unknown project' : 'No project'),
      section: s?.name ?? (sectionId ? 'Unknown section' : 'No section'),
    };
  };

  const membersOf = (projectId?: string | null) => {
    const p = projects.find(x => x.id === projectId);
    if (!p?.members?.length) return [];
    return users.filter(u => p.members!.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {stories.length} user stor{stories.length === 1 ? 'y' : 'ies'} staged
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {storyIds.length} stor{storyIds.length === 1 ? 'y' : 'ies'} · {taskIds.length} task{taskIds.length === 1 ? '' : 's'} accepted
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={storyFilter}
            onValueChange={v => {
              setStoryFilter(v);
              if (v !== 'all' && v !== 'accepted' && v !== 'pending') setActiveId(v);
            }}
          >
            <SelectTrigger className="h-8 w-56 rounded-md text-xs" aria-label="Filter stories">
              <Filter className="mr-1.5 h-3.5 w-3.5 shrink-0" />
              <SelectValue placeholder="Filter stories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All stories</SelectItem>
              <SelectItem value="accepted">Accepted</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              {stories.length > 0 && <SelectSeparator />}
              {stories.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.title || 'Untitled story'}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void api.addPrdStory().then(onChange)}>
            <Plus className="h-3.5 w-3.5" /> Story
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void discard()}>
            Discard
          </Button>
        </div>
      </div>

      <section className="rounded-2xl border border-sky-500/25 bg-sky-500/[0.06] p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
            <BookOpen className="h-3.5 w-3.5" /> Stories
          </p>
          <button
            type="button"
            className="text-[11px] font-semibold text-muted-foreground hover:text-foreground"
            onClick={() => {
              const all = stories.length > 0 && stories.every(s => storyOn[s.id]);
              setStoryOn(Object.fromEntries(stories.map(s => [s.id, !all])));
            }}
          >
            {stories.every(s => storyOn[s.id]) ? 'Untick all' : 'Tick all'}
          </button>
        </div>
        {stories.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {analyzing ? 'Stories arriving…' : 'Nothing staged.'}
          </p>
        ) : visibleStories.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No stories match this filter.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visibleStories.map(story => {
              const on = activeId === story.id;
              const accepted = Boolean(storyOn[story.id]);
              const pendingTasks = pending.has(story.id) && story.tasks.length === 0;
              const place = loc(story.projectId, story.sectionId);
              const nAcc = story.tasks.filter(t => taskOn[t.id] === true).length;
              return (
                <li key={story.id}>
                  <article
                    className={cn(
                      'flex h-full cursor-pointer flex-col rounded-xl border bg-card/80 p-3',
                      on && 'ring-2 ring-sky-500/40',
                      accepted && 'border-sky-500/40',
                    )}
                    onClick={() => openStory(story.id)}
                  >
                    <div className="flex items-start gap-2">
                      <div onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={accepted}
                          onCheckedChange={v => setStoryOn(c => ({ ...c, [story.id]: v === true }))}
                          aria-label={`Accept ${story.title || 'story'}`}
                        />
                      </div>
                      <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{story.title || 'Untitled story'}</p>
                      <button
                        type="button"
                        className="text-muted-foreground/50 hover:text-destructive"
                        disabled={busy}
                        aria-label="Delete story"
                        onClick={e => {
                          e.stopPropagation();
                          void api.deletePrdItem(story.id).then(onChange);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {story.description ? (
                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{story.description}</p>
                    ) : null}
                    <div className="mt-auto space-y-1.5 pt-3">
                      <MetaLine icon={FolderOpen} text={place.project} />
                      <MetaLine icon={Layers} text={place.section} />
                      <AssigneeLine ids={story.assigneeIds ?? []} users={users} />
                      <div className="flex items-center justify-between gap-2 pt-1">
                        <span className={cn('rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', PRI[story.priority || 'Medium'])}>
                          {story.priority || 'Medium'}
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          {pendingTasks ? 'writing tasks' : `${nAcc}/${story.tasks.length} accepted`}
                        </span>
                      </div>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {active && (
        <PlaceDialog
          title="Story details"
          open={storyOpen}
          onOpenChange={setStoryOpen}
          item={active}
          lockProject={Boolean(lockProjectId)}
          projects={projects}
          members={membersOf(active.projectId)}
          busy={busy}
          onPatch={patch}
          extra
          wide
          footer={
            <DialogFooter className="shrink-0 border-t border-border/50 pt-4 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setStoryOpen(false);
                  void api.deletePrdItem(active.id).then(onChange);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <Button type="button" disabled={busy} onClick={() => void saveStory(active.id)}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Save story
              </Button>
            </DialogFooter>
          }
        >
          <section className="space-y-3 border-t border-emerald-500/20 pt-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Proposed tasks
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || writing}
                onClick={() => void api.addPrdTask(active.id).then(onChange)}
              >
                <Plus className="h-3.5 w-3.5" /> Task
              </Button>
            </div>
            {writing ? (
              <p className="py-8 text-sm text-muted-foreground">Writing tasks…</p>
            ) : active.tasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks yet. Save the story on its own, or add tasks.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {active.tasks.map(task => {
                  const pick = taskOn[task.id];
                  const place = loc(task.projectId || active.projectId, task.sectionId || active.sectionId);
                  return (
                    <li key={task.id}>
                      <article
                        className={cn(
                          'flex h-full cursor-pointer flex-col rounded-xl border bg-card/80 p-3',
                          pick === true && 'border-emerald-500/50 ring-2 ring-emerald-500/30',
                          pick === false && 'opacity-55',
                        )}
                        onClick={() => setOpenTaskId(task.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold leading-snug">{task.title || 'Untitled task'}</p>
                          <div className="flex shrink-0 gap-1" onClick={e => e.stopPropagation()}>
                            <Button
                              type="button"
                              size="icon"
                              variant={pick === true ? 'default' : 'outline'}
                              className="h-8 w-8"
                              disabled={busy}
                              aria-label="Accept task"
                              onClick={() => acceptTask(active.id, task.id)}
                            >
                              <Check className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant={pick === false ? 'destructive' : 'outline'}
                              className="h-8 w-8"
                              disabled={busy}
                              aria-label="Delete task"
                              onClick={() => void api.deletePrdItem(task.id).then(onChange)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                        {task.description ? (
                          <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
                        ) : null}
                        <div className="mt-auto space-y-1.5 pt-3">
                          <MetaLine icon={FolderOpen} text={place.project} />
                          <MetaLine icon={Layers} text={place.section} />
                          <AssigneeLine ids={task.assigneeIds ?? []} users={users} />
                          <span className={cn('inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-semibold', PRI[task.priority || 'Medium'])}>
                            {task.priority || 'Medium'}
                            {pick === true ? ' · selected' : ''}
                          </span>
                        </div>
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </PlaceDialog>
      )}
      {active && openTask && (
        <PlaceDialog
          title="Task details"
          open
          onOpenChange={o => { if (!o) setOpenTaskId(null); }}
          item={{
            ...openTask,
            projectId: openTask.projectId || active.projectId,
            sectionId: openTask.sectionId || active.sectionId,
            acceptanceCriteria: undefined,
          }}
          lockProject={Boolean(lockProjectId || active.projectId)}
          projects={projects}
          members={membersOf(openTask.projectId || active.projectId)}
          busy={busy}
          onPatch={patch}
          footer={
            <DialogFooter className="gap-2 sm:justify-between">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setOpenTaskId(null);
                  void api.deletePrdItem(openTask.id).then(onChange);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
              <Button type="button" disabled={busy} onClick={() => acceptTask(active.id, openTask.id)}>
                <Check className="h-4 w-4" /> Select
              </Button>
            </DialogFooter>
          }
        />
      )}
    </section>
  );
}

function MetaLine({ icon: Icon, text }: { icon: typeof FolderOpen; text: string }) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{text}</span>
    </p>
  );
}

function AssigneeLine({ ids, users }: { ids: string[]; users: User[] }) {
  if (!ids.length) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Users className="h-3 w-3" /> Unassigned
      </p>
    );
  }
  const names = ids.map(id => users.find(u => u.id === id)?.name).filter(Boolean) as string[];
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <Users className="h-3 w-3 shrink-0" />
      <span className="truncate">{names.join(', ') || `${ids.length} assigned`}</span>
    </p>
  );
}

function PlaceDialog({
  title,
  open,
  onOpenChange,
  item,
  lockProject,
  projects,
  members,
  busy,
  onPatch,
  extra,
  wide,
  footer,
  children,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: {
    id: string;
    title: string;
    description?: string;
    priority?: string;
    projectId?: string | null;
    sectionId?: string | null;
    assigneeIds?: string[];
    acceptanceCriteria?: string;
  };
  lockProject: boolean;
  projects: ProjectOpt[];
  members: User[];
  busy: boolean;
  onPatch: (id: string, body: Parameters<typeof api.patchPrdItem>[1]) => Promise<void>;
  extra?: boolean;
  wide?: boolean;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const project = projects.find(p => p.id === item.projectId);
  const sections = project?.sections ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(wide && 'h-[75vh] w-[75vw] max-h-[75vh] max-w-[75vw] overflow-hidden')}
        key={item.id}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className={cn('space-y-4', wide && 'min-h-0 flex-1 overflow-y-auto pr-1')}>
          <div className={cn(wide && 'grid gap-4 md:grid-cols-2')}>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input defaultValue={item.title} disabled={busy} onBlur={e => void onPatch(item.id, { title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  defaultValue={item.description || ''}
                  rows={wide ? 6 : 5}
                  disabled={busy}
                  onBlur={e => void onPatch(item.id, { description: e.target.value })}
                />
              </div>
              {extra && (
                <div className="space-y-1.5">
                  <Label>Acceptance</Label>
                  <Textarea
                    defaultValue={item.acceptanceCriteria || ''}
                    rows={4}
                    disabled={busy}
                    onBlur={e => void onPatch(item.id, { acceptanceCriteria: e.target.value })}
                  />
                </div>
              )}
            </div>
            <div className="space-y-4">
              {!lockProject && (
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5"><FolderOpen className="h-3.5 w-3.5" /> Project</Label>
                  <Select
                    value={item.projectId || undefined}
                    onValueChange={v => void onPatch(item.id, { projectId: v, sectionId: null })}
                    disabled={busy}
                  >
                    <SelectTrigger className="h-10 rounded-xl">
                      <SelectValue placeholder="Choose project" />
                    </SelectTrigger>
                    <SelectContent>
                      {projects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5"><Layers className="h-3.5 w-3.5" /> Section</Label>
                <Select
                  value={item.sectionId || undefined}
                  onValueChange={v => void onPatch(item.id, { sectionId: v })}
                  disabled={busy || !project}
                >
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue placeholder={project ? 'Choose section' : 'Pick a project first'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sections.map(s => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select value={item.priority || 'Medium'} onValueChange={v => void onPatch(item.id, { priority: v })} disabled={busy}>
                  <SelectTrigger className="h-10 rounded-xl">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map(p => (
                      <SelectItem key={p} value={p}>{p}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3 rounded-xl border border-border/60 p-4">
                <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Assigned to
                </p>
                {project ? (
                  <AssigneeMultiSelect
                    members={members}
                    selectedIds={new Set(item.assigneeIds ?? [])}
                    onChange={next => void onPatch(item.id, { assigneeIds: [...next] })}
                  />
                ) : (
                  <p className="text-xs text-muted-foreground">Choose a project first.</p>
                )}
              </div>
            </div>
          </div>
          {children}
        </div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
