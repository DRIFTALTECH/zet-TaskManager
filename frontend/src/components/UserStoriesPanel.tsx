/**
 * Additive User Stories UI for a project section.
 * Reuses AssigneeMultiSelect, attachment upload APIs, and AI preview→confirm flow.
 * Nested work items are real Tasks with parentTaskId (checklist SubtaskSection unchanged).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileUp,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { storyAssigneeIds, taskAssigneeIds } from '@/lib/task-utils';
import type {
  ExtractedStoryPreview,
  GeneratedTaskPreview,
  Priority,
  Task,
  User,
  UserStory,
  UserStoryAttachment,
  UserStoryGeneratePreview,
} from '@/types';
import AssigneeMultiSelect from '@/components/AssigneeMultiSelect';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];

function progressLabel(s: UserStory) {
  const total = s.taskCount + s.subtaskCount;
  const done = s.completedTaskCount + s.completedSubtaskCount;
  return `${done}/${total} · ${s.progressPercent}%`;
}

function assigneeAvatars(story: UserStory, members: User[]) {
  const ids = storyAssigneeIds(story);
  return ids
    .map(id => members.find(m => m.id === id))
    .filter(Boolean)
    .slice(0, 4) as User[];
}

export default function UserStoriesPanel({
  projectId,
  sectionId,
  sectionName,
  members,
}: {
  projectId: string;
  sectionId: string;
  sectionName: string;
  members: User[];
}) {
  const currentUser = useAppStore(s => s.currentUser);
  const syncTasks = useAppStore(s => s.syncTasks);
  const [stories, setStories] = useState<UserStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [storyTasks, setStoryTasks] = useState<Record<string, Task[]>>({});
  const [collapsedParents, setCollapsedParents] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    storyId: string;
    replaceGenerated: boolean;
    data: UserStoryGeneratePreview;
  } | null>(null);
  const [assignStory, setAssignStory] = useState<UserStory | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listSectionUserStories(sectionId);
      setStories(rows);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load user stories');
    } finally {
      setLoading(false);
    }
  }, [sectionId]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTasks = async (storyId: string) => {
    try {
      const rows = await api.listUserStoryTasks(storyId);
      setStoryTasks(prev => ({ ...prev, [storyId]: rows }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load story tasks');
    }
  };

  const toggleExpand = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    await loadTasks(id);
  };

  const onGeneratePreview = async (storyId: string, replaceGenerated: boolean) => {
    setGenerating(storyId);
    try {
      const data = await api.generateUserStoryTasksPreview(storyId);
      if (!data.tasks.length) {
        toast.message('No new tasks suggested (existing titles preserved)');
        return;
      }
      setPreview({ storyId, replaceGenerated, data });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenerating(null);
    }
  };

  const onDelete = async (storyId: string) => {
    if (!confirm('Delete this user story? Linked tasks stay; they become unlinked.')) return;
    try {
      await api.deleteUserStory(storyId);
      toast.success('User story deleted');
      setStories(prev => prev.filter(s => s.id !== storyId));
      if (expanded === storyId) setExpanded(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const toggleParentCollapse = (taskId: string) => {
    setCollapsedParents(prev => {
      const n = new Set(prev);
      if (n.has(taskId)) n.delete(taskId);
      else n.add(taskId);
      return n;
    });
  };

  const toggleTaskAssigned = async (story: UserStory, task: Task, assign: boolean) => {
    const storyAids = storyAssigneeIds(story);
    if (assign && storyAids.length === 0) {
      toast.error('Assign people to the user story first, then check tasks to assign them');
      return;
    }
    try {
      const ids = assign ? storyAids : [];
      await api.patchTask(task.id, { assigneeIds: ids });
      // Keep nested subtasks in sync when toggling a top-level task.
      if (!task.parentTaskId) {
        const kids = (storyTasks[story.id] || []).filter(t => t.parentTaskId === task.id);
        for (const st of kids) {
          await api.patchTask(st.id, { assigneeIds: ids });
        }
      }
      await loadTasks(story.id);
      await syncTasks();
      toast.success(assign ? 'Task assigned' : 'Task left unassigned (still under story)');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update assignment');
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-border/40 bg-muted/20 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <BookOpen className="h-3.5 w-3.5 text-primary" />
          User Stories
          <span className="font-normal text-muted-foreground/60">({stories.length})</span>
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => setExtractOpen(true)}
          >
            <FileUp className="h-3 w-3 mr-1" /> From requirements
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-3 w-3 mr-1" /> Add story
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-muted-foreground/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> Loading…
        </div>
      ) : stories.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/50 italic py-2">
          No user stories in {sectionName} yet. Existing tasks without a story still work as before.
        </p>
      ) : (
        <div className="space-y-1.5">
          {stories.map(story => {
            const open = expanded === story.id;
            const tasks = storyTasks[story.id] || [];
            const tops = tasks.filter(t => !t.parentTaskId);
            const childrenOf = (pid: string) => tasks.filter(t => t.parentTaskId === pid);
            const avatars = assigneeAvatars(story, members);
            return (
              <div key={story.id} className="rounded-lg border border-border/35 bg-card/80 overflow-hidden">
                <button
                  type="button"
                  onClick={() => void toggleExpand(story.id)}
                  className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-foreground break-words">
                        {story.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/40 text-muted-foreground">
                        {story.priority}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/40 capitalize text-muted-foreground">
                        {story.status.replace(/_/g, ' ')}
                      </span>
                      {avatars.length > 0 && (
                        <span className="flex -space-x-1.5">
                          {avatars.map(u => (
                            <span
                              key={u.id}
                              title={u.name}
                              className="h-5 w-5 rounded-full bg-primary/20 text-primary text-[8px] font-bold flex items-center justify-center border border-background"
                            >
                              {(u.name || '?').slice(0, 2).toUpperCase()}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] text-muted-foreground/60 flex flex-wrap gap-x-2">
                      <span>{progressLabel(story)}</span>
                      {story.dueDate && <span>· due {story.dueDate}</span>}
                    </div>
                  </div>
                </button>

                {open && (
                  <div className="px-3 pb-3 pt-0 space-y-2 border-t border-border/25">
                    {story.description && (
                      <pre className="text-[11px] whitespace-pre-wrap text-muted-foreground/80 bg-muted/20 rounded-md p-2 max-h-40 overflow-auto font-sans">
                        {story.description}
                      </pre>
                    )}
                    {story.acceptanceCriteria && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground mb-1">
                          Acceptance criteria
                        </p>
                        <pre className="text-[11px] whitespace-pre-wrap text-muted-foreground/80 bg-muted/20 rounded-md p-2 max-h-32 overflow-auto font-sans">
                          {story.acceptanceCriteria}
                        </pre>
                      </div>
                    )}

                    <StoryAttachments storyId={story.id} />

                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-[11px]"
                        disabled={generating === story.id}
                        onClick={() => void onGeneratePreview(story.id, false)}
                      >
                        {generating === story.id ? (
                          <Loader2 className="h-3 w-3 animate-spin mr-1" />
                        ) : (
                          <Sparkles className="h-3 w-3 mr-1" />
                        )}
                        Generate Tasks
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        disabled={generating === story.id}
                        onClick={() => void onGeneratePreview(story.id, true)}
                        title="Replace only AI-generated tasks on confirm; keep manual ones"
                      >
                        Regenerate AI tasks
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => setAssignStory(story)}
                      >
                        Assign
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-[11px] text-red-400"
                        onClick={() => void onDelete(story.id)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Delete
                      </Button>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                        Tasks
                      </p>
                      {tops.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground/50 italic">No tasks yet</p>
                      ) : (
                        tops.map(t => {
                          const kids = childrenOf(t.id);
                          const collapsed = collapsedParents.has(t.id);
                          const isAssigned = taskAssigneeIds(t).length > 0;
                          return (
                            <div
                              key={t.id}
                              className="rounded-md border border-border/30 bg-background/60 px-2.5 py-2"
                            >
                              <div className="flex items-start gap-1.5">
                                <Checkbox
                                  checked={isAssigned}
                                  className="mt-0.5"
                                  title={isAssigned ? 'Assigned — uncheck to leave under story only' : 'Check to assign to story assignees'}
                                  onCheckedChange={v => void toggleTaskAssigned(story, t, v === true)}
                                />
                                {kids.length > 0 ? (
                                  <button
                                    type="button"
                                    className="mt-0.5 text-muted-foreground"
                                    onClick={() => toggleParentCollapse(t.id)}
                                    aria-label={collapsed ? 'Expand subtasks' : 'Collapse subtasks'}
                                  >
                                    {collapsed ? (
                                      <ChevronRight className="h-3.5 w-3.5" />
                                    ) : (
                                      <ChevronDown className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                ) : (
                                  <span className="w-3.5" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-medium text-foreground">{t.title}</div>
                                  <div className="text-[10px] text-muted-foreground/55 capitalize">
                                    {t.status.replace(/_/g, ' ')} · {t.priority}
                                    {kids.length > 0 && (
                                      <span className="ml-1.5">· {kids.length} subtask(s)</span>
                                    )}
                                    <span className="ml-1.5 normal-case">
                                      · {isAssigned ? 'assigned' : 'unassigned'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              {!collapsed && kids.length > 0 && (
                                <ul className="mt-1.5 ml-5 space-y-1 border-l border-border/30 pl-2">
                                  {kids.map(st => {
                                    const stAssigned = taskAssigneeIds(st).length > 0;
                                    return (
                                      <li key={st.id} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                                        <Checkbox
                                          checked={stAssigned}
                                          className="mt-0.5"
                                          onCheckedChange={v => void toggleTaskAssigned(story, st, v === true)}
                                        />
                                        <span>
                                          <span className="font-medium text-foreground/80">{st.title}</span>
                                          <span className="ml-1.5 capitalize opacity-60">
                                            {st.status.replace(/_/g, ' ')}
                                          </span>
                                          <span className="ml-1.5 opacity-50">
                                            · {stAssigned ? 'assigned' : 'unassigned'}
                                          </span>
                                        </span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <CreateUserStoryDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        projectId={projectId}
        sectionId={sectionId}
        members={members}
        currentUserId={currentUser?.id || ''}
        onCreated={story => {
          setStories(prev => [story, ...prev]);
          setCreateOpen(false);
        }}
      />

      <ExtractStoriesDialog
        open={extractOpen}
        onOpenChange={setExtractOpen}
        projectId={projectId}
        sectionId={sectionId}
        members={members}
        onCreated={created => {
          setStories(prev => [...created, ...prev]);
          setExtractOpen(false);
          void syncTasks();
        }}
      />

      {preview && (
        <GeneratePreviewDialog
          preview={preview.data}
          replaceGenerated={preview.replaceGenerated}
          onClose={() => setPreview(null)}
          onConfirmed={async tasks => {
            try {
              const created = await api.confirmGenerateUserStoryTasks(preview.storyId, {
                replaceGenerated: preview.replaceGenerated,
                tasks,
              });
              toast.success(
                created.length
                  ? `Created ${created.length} task(s)`
                  : 'Nothing selected to create',
              );
              setPreview(null);
              await load();
              await loadTasks(preview.storyId);
              await syncTasks();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Create failed');
            }
          }}
        />
      )}

      {assignStory && (
        <AssignStoryDialog
          story={assignStory}
          members={members}
          onClose={() => setAssignStory(null)}
          onSaved={updated => {
            setStories(prev => prev.map(s => (s.id === updated.id ? updated : s)));
            setAssignStory(null);
          }}
        />
      )}
    </div>
  );
}

function StoryAttachments({ storyId }: { storyId: string }) {
  const [items, setItems] = useState<UserStoryAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await api.getUserStoryAttachments(storyId));
    } catch {
      /* ignore */
    }
  }, [storyId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setUploading(true);
    try {
      for (const file of list) {
        const att = await api.uploadUserStoryAttachment(storyId, file);
        setItems(prev => [...prev, att]);
        toast.success(`${file.name} uploaded`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
          <Paperclip className="h-3 w-3" /> Attachments
        </p>
        <button
          type="button"
          className="text-[11px] text-primary/70 hover:text-primary flex items-center gap-1"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          <Upload className="h-3 w-3" />
          {uploading ? 'Uploading…' : 'Browse'}
        </button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          multiple
          onChange={e => {
            if (e.target.files) void uploadFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div
        onDragOver={e => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
        }}
        className={`rounded-md border border-dashed px-3 py-4 text-center text-[11px] transition-colors ${
          dragOver ? 'border-primary bg-primary/5 text-primary' : 'border-border/40 text-muted-foreground/50'
        }`}
      >
        Drag & drop files here (PDF, DOCX, images…)
      </div>
      {items.length > 0 && (
        <ul className="space-y-1">
          {items.map(att => (
            <li
              key={att.id}
              className="flex items-center justify-between gap-2 text-[11px] px-2 py-1 rounded border border-border/30"
            >
              <span className="truncate">{att.filename}</span>
              <button
                type="button"
                className="text-red-400 shrink-0"
                onClick={async () => {
                  try {
                    await api.deleteUserStoryAttachment(storyId, att.id);
                    setItems(prev => prev.filter(a => a.id !== att.id));
                  } catch {
                    toast.error('Could not delete');
                  }
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GeneratePreviewDialog({
  preview,
  replaceGenerated,
  onClose,
  onConfirmed,
}: {
  preview: UserStoryGeneratePreview;
  replaceGenerated: boolean;
  onClose: () => void;
  onConfirmed: (tasks: GeneratedTaskPreview[]) => Promise<void>;
}) {
  // Task checkbox = create. Created tasks stay unassigned until the story is assigned.
  const [includeTasks, setIncludeTasks] = useState<Set<string>>(
    () => new Set(preview.tasks.map(t => t.key)),
  );
  const [includeSubs, setIncludeSubs] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const t of preview.tasks) for (const st of t.subtasks) s.add(st.key);
    return s;
  });
  const [saving, setSaving] = useState(false);

  const allTaskKeys = preview.tasks.map(t => t.key);
  const allSubKeys = preview.tasks.flatMap(t => t.subtasks.map(s => s.key));

  const selectAll = () => {
    setIncludeTasks(new Set(allTaskKeys));
    setIncludeSubs(new Set(allSubKeys));
  };
  const deselectAll = () => {
    setIncludeTasks(new Set());
  };

  const confirm = async () => {
    const selected: GeneratedTaskPreview[] = preview.tasks
      .filter(t => includeTasks.has(t.key))
      .map(t => ({
        ...t,
        assign: false,
        subtasks: t.subtasks.filter(st => includeSubs.has(st.key)),
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
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review generated tasks</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Check tasks to create under this user story. They stay unassigned until you assign the
          story (or check Assign after the story has assignees).
          {replaceGenerated ? ' AI-generated tasks will be replaced on confirm.' : ''}
        </p>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={selectAll}>
            Include all
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]" onClick={deselectAll}>
            Include none
          </Button>
        </div>
        <div className="space-y-2">
          {preview.tasks.map(t => (
            <div key={t.key} className="rounded-md border border-border/40 p-2 space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer">
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
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.title}</div>
                  {t.description && (
                    <div className="text-[11px] text-muted-foreground/70 mt-0.5">{t.description}</div>
                  )}
                  <div className="text-[10px] text-muted-foreground/50 mt-0.5">
                    {includeTasks.has(t.key) ? 'Will be created · unassigned' : 'Skipped'}
                  </div>
                </div>
              </label>
              {t.subtasks.length > 0 && (
                <div className="ml-6 space-y-1 border-l border-border/30 pl-2">
                  {t.subtasks.map(st => (
                    <label key={st.key} className="flex items-start gap-2 cursor-pointer">
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
                      <span className="text-[12px]">{st.title}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={saving} onClick={() => void confirm()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create tasks
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AssignStoryDialog({
  story,
  members,
  onClose,
  onSaved,
}: {
  story: UserStory;
  members: User[];
  onClose: () => void;
  onSaved: (s: UserStory) => void;
}) {
  const [ids, setIds] = useState<Set<string>>(() => new Set(storyAssigneeIds(story)));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const updated = await api.patchUserStory(story.id, { assigneeIds: [...ids] });
      toast.success('Assignees updated');
      onSaved(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign: {story.title}</DialogTitle>
        </DialogHeader>
        <AssigneeMultiSelect members={members} selectedIds={ids} onChange={setIds} />
        <Button type="button" className="w-full" disabled={saving} onClick={() => void save()}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save assignees
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function CreateUserStoryDialog({
  open,
  onOpenChange,
  projectId,
  sectionId,
  members,
  currentUserId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  sectionId: string;
  members: User[];
  currentUserId: string;
  onCreated: (s: UserStory) => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle('');
      setDescription('');
      setAcceptance('');
      setPriority('Medium');
      setAssigneeIds(new Set(currentUserId ? [currentUserId] : []));
      setDueDate('');
      setPendingFiles([]);
    }
  }, [open, currentUserId]);

  const submit = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    setSaving(true);
    try {
      const story = await api.createUserStory({
        projectId,
        sectionId,
        title: title.trim(),
        description,
        acceptanceCriteria: acceptance,
        priority,
        assigneeIds: [...assigneeIds],
        dueDate: dueDate || null,
      });
      for (const file of pendingFiles) {
        try {
          await api.uploadUserStoryAttachment(story.id, file);
        } catch {
          toast.error(`Could not upload ${file.name}`);
        }
      }
      toast.success('User story created');
      onCreated(story);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New user story</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="As a user, I want…" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description (markdown / pasted specs OK)
            </label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={6}
              placeholder="Paste requirements, meeting notes, client specs…"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Attachments (drag & drop or browse)
            </label>
            <div
              onDragOver={e => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) setPendingFiles(prev => [...prev, ...files]);
              }}
              className={`rounded-md border border-dashed px-3 py-3 text-center text-[11px] ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border/40 text-muted-foreground/50'
              }`}
            >
              Drop files here
              <label className="ml-2 text-primary cursor-pointer underline">
                browse
                <input
                  type="file"
                  className="sr-only"
                  multiple
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) setPendingFiles(prev => [...prev, ...files]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {pendingFiles.length > 0 && (
              <ul className="mt-1 text-[11px] space-y-0.5">
                {pendingFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      className="text-red-400"
                      onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Acceptance criteria</label>
            <Textarea
              value={acceptance}
              onChange={e => setAcceptance(e.target.value)}
              rows={3}
              placeholder="Given / When / Then…"
              className="font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Due date</label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Assignees</label>
            <AssigneeMultiSelect members={members} selectedIds={assigneeIds} onChange={setAssigneeIds} />
          </div>
          <Button type="button" className="w-full" disabled={saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create user story
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExtractStoriesDialog({
  open,
  onOpenChange,
  projectId,
  sectionId,
  members,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projectId: string;
  sectionId: string;
  members: User[];
  onCreated: (stories: UserStory[]) => void;
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<ExtractedStoryPreview[] | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [includeTaskKeys, setIncludeTaskKeys] = useState<Set<string>>(new Set());
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    if (open) {
      setText('');
      setFile(null);
      setPreview(null);
      setChecked(new Set());
      setIncludeTaskKeys(new Set());
    }
  }, [open]);

  const runExtract = async () => {
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
      const keys = new Set<string>();
      for (const s of res.stories) for (const t of s.tasks ?? []) keys.add(t.key);
      setIncludeTaskKeys(keys);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Extract failed');
    } finally {
      setLoading(false);
    }
  };

  const saveSelected = async () => {
    if (!preview) return;
    const selected = preview.filter(s => checked.has(s.key));
    if (!selected.length) {
      toast.error('Select at least one story');
      return;
    }
    const storiesPayload = selected.map(s => ({
      ...s,
      tasks: (s.tasks ?? [])
        .filter(t => includeTaskKeys.has(t.key))
        .map(t => ({ ...t, assign: false })),
    }));
    if (storiesPayload.some(s => (s.tasks?.length ?? 0) === 0)) {
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
      toast.success(`Created ${created.length} user stor${created.length === 1 ? 'y' : 'ies'}`);
      onCreated(created);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Extract user stories from requirements</DialogTitle>
        </DialogHeader>
        {!preview ? (
          <div className="space-y-3">
            <Textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={6}
              placeholder="Paste requirements…"
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
              className={`rounded-md border border-dashed px-3 py-4 text-center text-[11px] ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border/40 text-muted-foreground/50'
              }`}
            >
              {file ? (
                <span className="text-foreground">{file.name}</span>
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
            <Button type="button" className="w-full" disabled={loading} onClick={() => void runExtract()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Extract stories (preview)
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex gap-2">
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
            <div className="space-y-2">
              {preview.map(s => {
                const taskN = s.tasks?.length ?? 0;
                const includedN = (s.tasks ?? []).filter(t => includeTaskKeys.has(t.key)).length;
                const subN = (s.tasks ?? [])
                  .filter(t => includeTaskKeys.has(t.key))
                  .reduce((n, t) => n + (t.subtasks?.length ?? 0), 0);
                return (
                <div
                  key={s.key}
                  className="rounded-md border border-border/40 p-2 space-y-1.5"
                >
                  <label className="flex items-start gap-2 cursor-pointer">
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
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate" title={s.title}>{s.title}</div>
                      {s.description && (
                        <div className="text-[11px] text-muted-foreground/70 mt-0.5 line-clamp-3">
                          {s.description}
                        </div>
                      )}
                      {(taskN > 0 || subN > 0) && (
                        <div className="text-[10px] text-muted-foreground/50 mt-1">
                          {includedN}/{taskN} task{taskN === 1 ? '' : 's'} selected
                          {subN ? ` · ${subN} subtask${subN === 1 ? '' : 's'}` : ''}
                        </div>
                      )}
                    </div>
                  </label>
                  {taskN > 0 && (
                    <ul className="ml-6 space-y-1 border-l border-border/30 pl-2">
                      {(s.tasks ?? []).map(t => (
                        <li key={t.key} className="flex items-start gap-1.5 text-[11px]">
                          <Checkbox
                            checked={includeTaskKeys.has(t.key)}
                            onCheckedChange={() => {
                              setIncludeTaskKeys(prev => {
                                const n = new Set(prev);
                                if (n.has(t.key)) n.delete(t.key);
                                else n.add(t.key);
                                return n;
                              });
                            }}
                          />
                          <span>
                            {t.title}
                            <span className="ml-1 text-muted-foreground/45">
                              {includeTaskKeys.has(t.key) ? '· include' : '· skip'}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );})}
            </div>
            <p className="text-[10px] text-muted-foreground/50">
              Story checkbox = create story. Task checkbox = create that task. Unchecked tasks are skipped.
              Created tasks stay unassigned until you assign the user story.
            </p>
            <Button type="button" className="w-full" disabled={saving} onClick={() => void saveSelected()}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create selected stories
              {(preview.some(s => (s.tasks?.length ?? 0) > 0)) ? ' + tasks' : ''}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
