/**
 * Project-level User Stories UI. A story is not owned by a section;
 * its tasks may live in any of the project's sections.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Paperclip,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { projectKeys, STORY_STALE_TIME, upsertUserStory, removeUserStory } from '@/lib/queryClient';
import { useAppStore } from '@/stores/appStore';
import { storyAssigneeIds, taskAssigneeIds } from '@/lib/task-utils';
import type {
  Task,
  User,
  UserStory,
  UserStoryAttachment,
  UserStoryGeneratePreview,
} from '@/types';
import AssigneeMultiSelect from '@/components/AssigneeMultiSelect';
import { AddWorkMenu } from '@/components/AddWorkMenu';
import CreateTaskModal from '@/components/CreateTaskModal';
import { CreateUserStoryDialog } from '@/components/CreateUserStoryDialog';
import { GenerateTasksPreviewDialog } from '@/components/GenerateTasksPreviewDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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
  members,
}: {
  projectId: string;
  members: User[];
}) {
  const syncTasks = useAppStore(s => s.syncTasks);
  const { data: stories = [], isLoading: loading } = useQuery({
    queryKey: projectKeys.userStories(projectId),
    queryFn: () => api.listProjectUserStories(projectId),
    staleTime: STORY_STALE_TIME,
    refetchOnMount: false,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [lockStory, setLockStory] = useState<UserStory | null>(null);
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
      removeUserStory(storyId, projectId);
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
          <AddWorkMenu
            onTask={() => { setLockStory(null); setTaskOpen(true); }}
            onStory={() => setCreateOpen(true)}
            trigger={
              <Button type="button" size="sm" variant="outline" className="h-7 text-[11px]">
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            }
          />
        </div>
      </div>

      {loading ? (
        <div className="py-4 text-center text-xs text-muted-foreground/50">
          <Loader2 className="h-3.5 w-3.5 animate-spin inline mr-1" /> Loading…
        </div>
      ) : stories.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/50 italic py-2">
          No user stories yet. Existing tasks without a story still work as before.
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
                      <span className="text-xs font-semibold text-foreground line-clamp-2 break-all" title={story.title}>
                        {story.title}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/40 text-muted-foreground">
                        {story.priority}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border/40 capitalize text-muted-foreground">
                        {(story.status || 'backlog').replace(/_/g, ' ')}
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
                        variant="outline"
                        className="h-7 text-[11px]"
                        onClick={() => { setLockStory(story); setTaskOpen(true); }}
                      >
                        <Plus className="h-3 w-3 mr-1" /> Add task
                      </Button>
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
                        className="h-7 text-[11px] text-red-600 dark:text-red-400"
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
                                    {(t.status || '').replace(/_/g, ' ')} · {t.priority}
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
                                            {(st.status || '').replace(/_/g, ' ')}
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
        onCreated={story => {
          upsertUserStory(story);
          setCreateOpen(false);
        }}
      />
      <CreateTaskModal
        open={taskOpen}
        lockStory={lockStory}
        lockProjectId={lockStory ? null : projectId}
        onOpenChange={o => {
          setTaskOpen(o);
          if (!o) setLockStory(null);
        }}
      />

      {preview && (
        <GenerateTasksPreviewDialog
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
              upsertUserStory(await api.getUserStory(preview.storyId));
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
            upsertUserStory(updated);
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
                className="text-red-600 dark:text-red-400 shrink-0"
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
