import { useState, useEffect } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { DateInput } from '@/components/ui/date-input';
import { toast } from 'sonner';
import type { Priority } from '@/types';
import { Users, Layers, Tag, Plus, X, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { localTodayISO, localTomorrowISO } from '@/lib/due-date-utils';
import { api } from '@/lib/api';
import type { TaskPrefill } from '@/pages/AIPage';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefill?: TaskPrefill;
}

const priorities: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];

const priorityChoice: Record<Priority, string> = {
  Urgent: 'border-red-500/30 bg-red-500/15 text-red-400',
  High: 'border-orange-500/30 bg-orange-500/15 text-orange-400',
  Medium: 'border-yellow-500/35 bg-yellow-500/15 text-yellow-400',
  Low: 'border-green-500/30 bg-green-500/15 text-green-400',
};

const CreateTaskModal = ({ open, onOpenChange, prefill }: Props) => {
  const { currentUser, projects, users, createTask, addSection, selectedProjectId } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [manualProjectId, setManualProjectId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [tagsStr, setTagsStr] = useState('');
  const [showNewSection, setShowNewSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState('');
  const [creatingSec, setCreatingSec] = useState(false);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const userProjects = currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : [];

  const implicitProject =
    selectedProjectId && userProjects.some(p => p.id === selectedProjectId) ? selectedProjectId : null;
  const effectiveProjectId = implicitProject ?? manualProjectId;
  const selectedProject = projects.find(p => p.id === effectiveProjectId);
  const showProjectPicker = !implicitProject;

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
    if (open) setDueDate(localTodayISO());
  }, [open]);

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
    setPriority('Medium');
    setTagsStr('');
    setShowNewSection(false);
    setNewSectionName('');
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
      return toast.error(
        showProjectPicker ? 'Please fill in title, project, and section' : 'Please fill in title and section',
      );
    }
    const ids = [...assigneeIds];
    if (ids.length === 0) return toast.error('Select at least one person assigned to this task');
    try {
      await createTask({
        title: title.trim(),
        description: description.trim(),
        projectId: effectiveProjectId,
        sectionId,
        assigneeIds: ids,
        assignedBy: currentUser.id,
        createdBy: currentUser.id,
        dueDate: dueDate.trim() || localTodayISO(),
        priority,
        tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
      });
      toast.success('Task created');
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
      <DialogContent className="sm:max-w-lg flex max-h-[min(90dvh,92vh)] min-h-0 flex-col gap-0 overflow-hidden border-border/80 bg-card p-0">
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

            <div className="rounded-xl border border-border/60 p-4 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Layers className="h-3.5 w-3.5" /> {showProjectPicker ? 'Project & section' : 'Section'}
              </div>
              {showProjectPicker && (
                <div className="space-y-1.5">
                  <Label htmlFor="ct-project">Project</Label>
                  <select
                    id="ct-project"
                    value={manualProjectId}
                    onChange={e => handleManualProjectChange(e.target.value)}
                    className={field}
                  >
                    <option value="">Choose project…</option>
                    {userProjects.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {selectedProject && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="ct-section">Section</Label>
                    {!showNewSection && (
                      <button
                        type="button"
                        onClick={() => setShowNewSection(true)}
                        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
                      >
                        <Plus className="h-3 w-3" /> New section
                      </button>
                    )}
                  </div>
                  {showNewSection ? (
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={newSectionName}
                        onChange={e => setNewSectionName(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') void handleCreateSection();
                          if (e.key === 'Escape') { setShowNewSection(false); setNewSectionName(''); }
                        }}
                        placeholder="Section name…"
                        className={field}
                        disabled={creatingSec}
                      />
                      <button
                        type="button"
                        onClick={() => void handleCreateSection()}
                        disabled={!newSectionName.trim() || creatingSec}
                        className="shrink-0 px-3 py-2 text-xs rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-40 transition-opacity"
                      >
                        {creatingSec ? '…' : 'Create'}
                      </button>
                      <button
                        type="button"
                        onClick={() => { setShowNewSection(false); setNewSectionName(''); }}
                        className="shrink-0 p-2 rounded-xl border border-border/60 text-muted-foreground hover:bg-muted/50 transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <select
                      id="ct-section"
                      value={sectionId}
                      onChange={e => setSectionId(e.target.value)}
                      className={field}
                    >
                      <option value="">
                        {selectedProject.sections.length === 0 ? 'No sections yet — create one →' : 'Choose section…'}
                      </option>
                      {selectedProject.sections.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>

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
