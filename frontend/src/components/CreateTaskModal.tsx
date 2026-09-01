import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { toast } from 'sonner';
import type { Priority, UserStory } from '@/types';
import { Users, Layers, Tag, Sparkles, BookOpen, FolderOpen, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { localTodayISO, localTomorrowISO } from '@/lib/due-date-utils';
import { api } from '@/lib/api';
import { projectPickerLabel } from '@/lib/project-utils';
import { SubtaskDraftSection } from '@/components/SubtaskSection';
import { collectSubtaskTitles, newSubtaskDraftRow, type SubtaskDraftRow } from '@/lib/subtask-utils';
import type { TaskPrefill } from '@/pages/AIPage';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: TaskPrefill;
  /** Kanban column id — new task is created in this status. */
  initialStatus?: string;
  /** When set, the task is created under this story (project locked; section still chosen per task). */
  lockStory?: UserStory | null;
}

const priorities: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];

const priorityChoice: Record<Priority, string> = {
  Urgent: 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400',
  High: 'border-orange-500/30 bg-orange-500/15 text-orange-600 dark:text-orange-400',
  Medium: 'border-yellow-500/35 bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
  Low: 'border-green-500/30 bg-green-500/15 text-green-600 dark:text-green-400',
};

const CreateTaskModal = ({ open, onOpenChange, prefill, initialStatus, lockStory }: Props) => {
  const { currentUser, projects, users, createTask, updateTask, addSection, selectedProjectId } = useAppStore();
  const statusRef = useRef(initialStatus || 'backlog');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [manualProjectId, setManualProjectId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [sprint, setSprint] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [tagsStr, setTagsStr] = useState('');
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [creatingSec, setCreatingSec] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [subtaskRows, setSubtaskRows] = useState<SubtaskDraftRow[]>(() => [newSubtaskDraftRow()]);
  const [userStoryId, setUserStoryId] = useState('');
  const [sectionStories, setSectionStories] = useState<UserStory[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(false);

  const userProjects = currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : [];

  const effectiveProjectId = manualProjectId;
  const selectedProject = projects.find(p => p.id === effectiveProjectId);

  const projectMembers = selectedProject
    ? users.filter(u => selectedProject.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  useEffect(() => {
    if (!currentUser || !effectiveProjectId) return;
    const p = projects.find(pr => pr.id === effectiveProjectId);
    if (p?.members.includes(currentUser.id)) {
      setAssigneeIds(prev => prev.size === 0 ? new Set([currentUser.id]) : prev);
    }
  }, [currentUser, effectiveProjectId, projects]);

  useEffect(() => {
    if (!open) return;
    statusRef.current = initialStatus || 'backlog';
    setDueDate(localTodayISO());
    if (lockStory) {
      setManualProjectId(lockStory.projectId);
      const secs = projects.find(p => p.id === lockStory.projectId)?.sections ?? [];
      setSectionId(secs[0]?.id ?? '');
      setUserStoryId(lockStory.id);
      return;
    }
    if (selectedProjectId && userProjects.some(p => p.id === selectedProjectId)) {
      setManualProjectId(prev => prev || selectedProjectId);
    }
  }, [open, initialStatus, lockStory]);

  // Apply AI prefill when provided
  useEffect(() => {
    if (!prefill || !open) return;
    if (prefill.title) setTitle(prefill.title);
    if (prefill.description) setDescription(prefill.description);
    if (prefill.priority) setPriority(prefill.priority);
    if (prefill.dueDate) setDueDate(prefill.dueDate);
    if (prefill.projectId) setManualProjectId(prefill.projectId);
    if (prefill.sectionId) setSectionId(prefill.sectionId);
    if (prefill.assigneeId) setAssigneeIds(new Set([prefill.assigneeId]));
    if (prefill.tags?.length) setTagsStr(prefill.tags.join(', '));
  }, [prefill, open]);

  useEffect(() => {
    if (lockStory) return;
    if (!open || !effectiveProjectId) {
      setSectionStories([]);
      setUserStoryId('');
      return;
    }
    let cancelled = false;
    setStoriesLoading(true);
    void (async () => {
      try {
        const rows = await api.listProjectUserStories(effectiveProjectId);
        if (!cancelled) {
          setSectionStories(rows);
          setUserStoryId(prev => (prev && rows.some(s => s.id === prev) ? prev : ''));
        }
      } catch {
        if (!cancelled) {
          setSectionStories([]);
          setUserStoryId('');
        }
      } finally {
        if (!cancelled) setStoriesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, effectiveProjectId, lockStory]);

  const handleGenerateDescription = async () => {
    if (!title.trim()) return toast.error('Enter a title first');
    setGeneratingDesc(true);
    try {
      const project = projects.find(p => p.id === effectiveProjectId);
      const section = project?.sections.find(s => s.id === sectionId);
      const res = await api.aiGenerateDescription(
        title,
        project?.name,
        section?.name,
      );
      setDescription(res.description);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate description');
    } finally {
      setGeneratingDesc(false);
    }
  };

  if (!currentUser) return null;

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setManualProjectId('');
    setSectionId('');
    setAssigneeIds(new Set());
    setDueDate(localTodayISO());
    setSprint('');
    setEstimatedHours('');
    setPriority('Medium');
    setTagsStr('');
    setShowNewSection(false);
    setNewSectionName('');
    setSubtaskRows([newSubtaskDraftRow()]);
    setUserStoryId('');
    setSectionStories([]);
  };

  const handleCreateSection = async () => {
    if (!newSectionName.trim() || !effectiveProjectId) return;
    setCreatingSec(true);
    try {
      await addSection(effectiveProjectId, newSectionName.trim());
      const updatedProj = useAppStore.getState().projects.find(p => p.id === effectiveProjectId);
      const newSec = updatedProj?.sections.find(s => s.name.trim() === newSectionName.trim());
      if (newSec) setSectionId(newSec.id);
      setNewSectionName('');
      setShowNewSection(false);
      toast.success('Section created');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create section');
    } finally {
      setCreatingSec(false);
    }
  };

  const handleManualProjectChange = (id: string) => {
    setManualProjectId(id);
    setSectionId('');
    setAssigneeIds(new Set(currentUser ? [currentUser.id] : []));
    setShowNewSection(false);
    setNewSectionName('');
  };

  const toggleAssignee = (userId: string) => {
    setAssigneeIds(prev => {
      const n = new Set(prev);
      if (n.has(userId)) n.delete(userId);
      else n.add(userId);
      return n;
    });
  };

  const handleSave = async () => {
    if (!title.trim() || !effectiveProjectId || !sectionId) {
      return toast.error('Please fill in title, project, and section');
    }
    const storyId = lockStory?.id || userStoryId;
    if (!storyId) {
      return toast.error('Pick a user story');
    }
    const ids = [...assigneeIds];
    const subtasks = collectSubtaskTitles(subtaskRows);
    if (subtasks.ok === false) return toast.error(subtasks.error);
    const estRaw = estimatedHours.trim();
    let est: number | null = null;
    if (estRaw) {
      const n = Number(estRaw);
      if (!Number.isFinite(n) || n < 0) return toast.error('Estimated time must be a number of hours');
      est = n > 0 ? n : null;
    }
    const status = statusRef.current || initialStatus || 'backlog';
    try {
      const created = await createTask({
        title: title.trim(),
        description: description.trim(),
        projectId: effectiveProjectId,
        sectionId,
        assigneeIds: ids,
        assignedBy: currentUser.id,
        createdBy: currentUser.id,
        dueDate: dueDate.trim() || localTodayISO(),
        sprint: sprint.trim(),
        priority,
        tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
        userStoryId: storyId,
        status,
        estimatedHours: est,
      });
      if (status && created.status !== status) {
        await updateTask(created.id, { status });
      }
      try {
        for (const subtaskTitle of subtasks.titles) {
          await api.createChecklist(created.id, subtaskTitle);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Task created, but some subtasks could not be saved');
        onOpenChange(false);
        resetForm();
        return;
      }
      // Tasker mascot animates the "task created" confirmation.
      onOpenChange(false);
      resetForm();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create task');
    }
  };

  const field =
    'w-full rounded-xl border border-border/80 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

  return (
    <Dialog
      open={open}
      onOpenChange={v => {
        onOpenChange(v);
        if (!v) resetForm();
      }}
    >
      <DialogContent className="w-[94vw] max-w-[94vw] sm:w-[65vw] sm:max-w-[65vw] flex max-h-[min(90dvh,92vh)] min-h-0 flex-col gap-0 overflow-hidden border-border/80 bg-card p-0">
        <DialogHeader className="shrink-0 px-6 pb-4 pt-2 text-left border-b border-border/60">
          <DialogTitle className="text-xl">New task</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Add a title and optional details. You can assign this task to anyone on the project.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="ct-title">
                Title <span className="text-destructive">*</span>
              </Label>
              <input
                id="ct-title"
                value={title}
                onChange={e => setTitle(e.target.value)}
                className={field}
                placeholder="Short, actionable title"
                autoFocus
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ct-desc">Description</Label>
                <button
                  type="button"
                  onClick={() => void handleGenerateDescription()}
                  disabled={!title.trim() || generatingDesc}
                  className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:text-primary/80 disabled:opacity-40 transition-colors"
                >
                  <Sparkles className="h-3 w-3" />
                  {generatingDesc ? 'Generating…' : 'AI Generate'}
                </button>
              </div>
              <textarea
                id="ct-desc"
                value={description}
                onChange={e => setDescription(e.target.value)}
                className={`${field} min-h-[100px] resize-y`}
                placeholder="Context, acceptance criteria, links…"
              />
            </div>

            {lockStory ? (
              <div className="rounded-xl border border-violet-500/25 bg-violet-500/10 px-4 py-3 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-400">User story</p>
                  <p className="text-sm font-medium truncate">{lockStory.title}</p>
                </div>
              </div>
            ) : (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" />
                Project <span className="text-destructive">*</span>
              </Label>
              <Select value={manualProjectId || undefined} onValueChange={handleManualProjectChange}>
                <SelectTrigger className="h-10 rounded-xl">
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent>
                  {userProjects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{projectPickerLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            )}

            <div className="space-y-2">
              <Label className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                Section <span className="text-destructive">*</span>
              </Label>
                <div className="flex items-start gap-1.5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Select
                      value={sectionId || undefined}
                      onValueChange={setSectionId}
                      disabled={!selectedProject}
                    >
                      <SelectTrigger className="h-10 rounded-xl">
                        <SelectValue placeholder={selectedProject ? 'Choose section' : 'Pick a project first'} />
                      </SelectTrigger>
                      <SelectContent>
                        {(selectedProject?.sections ?? []).map(s => (
                          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {showNewSection && (
                      <input
                        autoFocus
                        value={newSectionName}
                        onChange={e => setNewSectionName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void handleCreateSection();
                          if (e.key === 'Escape') { setShowNewSection(false); setNewSectionName(''); }
                        }}
                        placeholder="Section name…"
                        disabled={creatingSec}
                        className={`${field} h-10 py-0`}
                      />
                    )}
                  </div>
                  {selectedProject && (
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setShowNewSection(v => !v);
                          setNewSectionName('');
                        }}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border/80 bg-background text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                        title="Add section"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                      {showNewSection && (
                        <button
                          type="button"
                          onClick={() => void handleCreateSection()}
                          disabled={!newSectionName.trim() || creatingSec}
                          className="h-10 min-w-10 px-3 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
                        >
                          {creatingSec ? '…' : 'Add'}
                        </button>
                      )}
                    </div>
                  )}
                </div>
            </div>

            {!lockStory && effectiveProjectId && (
              <div className="rounded-xl border border-border/60 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <BookOpen className="h-3.5 w-3.5" /> User story <span className="text-destructive">*</span>
                </div>
                <Select
                  value={userStoryId || undefined}
                  onValueChange={setUserStoryId}
                  disabled={storiesLoading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={storiesLoading ? 'Loading stories…' : 'Choose user story'} />
                  </SelectTrigger>
                  <SelectContent>
                    {sectionStories.map(s => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!storiesLoading && sectionStories.length === 0 && (
                  <p className="text-[11px] text-muted-foreground/60">
                    No stories in this project yet — create one first.
                  </p>
                )}
              </div>
            )}

            {selectedProject && (
              <div className="rounded-xl border border-border/60 p-4 space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Assigned to
                </div>
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Select everyone who should work on this task.</p>
                  <div className="rounded-lg border border-border/50 bg-background divide-y divide-border/40 max-h-[200px] overflow-y-auto">
                    {projectMembers.map(u => (
                      <label
                        key={u.id}
                        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/40 transition-colors duration-100"
                      >
                        <Checkbox checked={assigneeIds.has(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">
                            {u.name}
                            {u.id === currentUser.id ? ' (you)' : ''}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                        </div>
                        <span className="text-[10px] uppercase text-muted-foreground shrink-0">{u.role}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>When is it due?</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDueDate(localTodayISO())}
                    className={cn(
                      'text-xs px-3 py-2 rounded-lg border font-semibold transition-all',
                      dueDate === localTodayISO()
                        ? 'border-amber-500/60 bg-amber-500/15 text-amber-600 dark:text-amber-100 ring-2 ring-amber-500/40'
                        : 'border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    Due today
                  </button>
                  <button
                    type="button"
                    onClick={() => setDueDate(localTomorrowISO())}
                    className={cn(
                      'text-xs px-3 py-2 rounded-lg border font-semibold transition-all',
                      dueDate === localTomorrowISO()
                        ? 'border-sky-500/60 bg-sky-500/15 text-sky-600 dark:text-sky-100 ring-2 ring-sky-500/40'
                        : 'border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                    )}
                  >
                    Due tomorrow
                  </button>
                </div>
                <Label htmlFor="ct-due" className="text-muted-foreground">
                  Due date
                </Label>
                <DateInput id="ct-due" value={dueDate} onChange={setDueDate} />
                <p className="text-[10px] text-muted-foreground/70">
                  Quick picks above, or any date using the field or calendar.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-sprint">Sprint</Label>
                <input
                  id="ct-sprint"
                  value={sprint}
                  onChange={e => setSprint(e.target.value)}
                  placeholder="e.g. Sprint 12"
                  maxLength={120}
                  className={field}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ct-estimate">Estimated time <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <div className="flex items-center gap-2">
                  <input
                    id="ct-estimate"
                    type="number"
                    min="0"
                    step="0.25"
                    inputMode="decimal"
                    value={estimatedHours}
                    onChange={e => setEstimatedHours(e.target.value)}
                    placeholder="Hours"
                    className={field}
                  />
                  <span className="text-xs text-muted-foreground shrink-0">hours</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Priority</Label>
                <div className="flex flex-wrap gap-1.5">
                  {priorities.map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPriority(p)}
                      className={cn(
                        'text-xs px-3 py-2 rounded-lg border font-medium transition-all',
                        priorityChoice[p],
                        priority === p ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background scale-[1.02]' : 'opacity-80 hover:opacity-100',
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="ct-tags" className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5" /> Tags
              </Label>
              <input
                id="ct-tags"
                value={tagsStr}
                onChange={e => setTagsStr(e.target.value)}
                className={field}
                placeholder="Comma-separated, e.g. frontend, urgent"
              />
            </div>

            <SubtaskDraftSection rows={subtaskRows} onChange={setSubtaskRows} />
          </div>
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-border/60 flex gap-2 justify-end bg-muted/10">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2.5 text-sm rounded-xl border border-border hover:bg-muted/50 transition-colors duration-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            className="px-4 py-2.5 text-sm rounded-xl bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity duration-100"
          >
            Create task
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskModal;
