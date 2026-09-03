import { useAppStore } from '@/stores/appStore';
import { KanbanColumn, Priority, Task, TaskStatus, UserStory, UserStoryAttachment } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Calendar, Tag, Clock, AlertTriangle, Plus, X, Trash2,
  FolderOpen, Layers, UserCircle, CircleDot, MessageSquare,
  User2, CheckCircle2, Check, Paperclip, Download, Upload, BookOpen, FileText, Sparkles, Loader2,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, type ElementType } from 'react';
import UserAvatar from '@/components/UserAvatar';
import { SprintSelect } from '@/components/SprintSelect';
import { dueBucketDateTextClass, getDueBucket } from '@/lib/due-date-utils';
import { api } from '@/lib/api';
import { GenerateTasksPreviewDialog } from '@/components/GenerateTasksPreviewDialog';
import { removeUserStory, upsertUserStory } from '@/lib/queryClient';
import type { UserStoryGeneratePreview } from '@/types';
import { isStoryConfirmed, isTaskConfirmed, normalizePriority, rollupStoryHours, storyAssigneeIds } from '@/lib/task-utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const priorityConfig: Record<Priority, { style: string; dot: string; ring: string }> = {
  Urgent: { style: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30', dot: 'bg-red-400', ring: 'ring-red-400/40' },
  High:   { style: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30', dot: 'bg-orange-400', ring: 'ring-orange-400/40' },
  Medium: { style: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400', ring: 'ring-yellow-400/40' },
  Low:    { style: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30', dot: 'bg-green-400', ring: 'ring-green-400/40' },
};
const statusConfig: Record<TaskStatus, { style: string; label: string }> = {
  backlog:     { style: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30', label: 'Backlog' },
  in_progress: { style: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30', label: 'In Progress' },
  in_review:   { style: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30', label: 'In Review' },
  done:        { style: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30', label: 'Done' },
  completed:   { style: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', label: 'Completed' },
};

function dateOnly(s?: string | null) {
  return (s ?? '').trim().slice(0, 10);
}
function fmtDate(d: string) {
  try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function sortedKey(ids: string[]) { return [...ids].sort().join('|'); }

const NONE = '__none__';

function SectionLabel({ icon: Icon, label, accent = 'text-muted-foreground/60' }: { icon: ElementType; label: string; accent?: string }) {
  return (
    <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] mb-3 ${accent}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function StoryTaskRow({
  task, doneColumnId, isManager, approving, onApprove, onClick,
}: {
  task: Task;
  doneColumnId?: string;
  isManager?: boolean;
  approving?: boolean;
  onApprove?: () => void;
  onClick: () => void;
}) {
  const done = task.status === doneColumnId || task.status === 'done' || task.status === 'completed';
  const confirmed = isTaskConfirmed(task);
  const canApprove = !!isManager && done && !confirmed;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl border border-border/40 bg-muted/10 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors"
    >
      {done ? (
        <span
          role={canApprove ? 'button' : undefined}
          title={canApprove ? 'Approve' : confirmed ? 'Approved' : 'Done'}
          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
            confirmed
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : 'border-emerald-500 text-emerald-600 dark:text-emerald-400'
          } ${canApprove ? 'cursor-pointer' : ''}`}
          onClick={e => {
            e.stopPropagation();
            if (canApprove && !approving) onApprove?.();
          }}
        >
          <Check className="h-3 w-3" />
        </span>
      ) : (
        <span className="h-5 w-5 shrink-0 rounded-full border border-border/50" />
      )}
      <span className={`min-w-0 flex-1 truncate text-sm ${done ? 'text-muted-foreground' : ''}`}>{task.title}</span>
    </button>
  );
}

interface Props {
  story: UserStory | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: Task[];
  columns: KanbanColumn[];
  doneColumnId: string;
  onTaskClick: (t: Task) => void;
  onAddTask: () => void;
  isManager?: boolean;
  approvingId?: string | null;
  onApprove?: (id: string) => void;
  onUpdated?: (s: UserStory) => void;
}

export default function StoryDetailModal({
  story, open, onOpenChange, tasks, columns, doneColumnId,
  onTaskClick, onAddTask, isManager, approvingId, onApprove, onUpdated,
}: Props) {
  const { users, projects, currentUser, syncTasks, tasks: storeTasks } = useAppStore();
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftAcceptance, setDraftAcceptance] = useState('');
  const [draftPriority, setDraftPriority] = useState<Priority>('Medium');
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [draftSprint, setDraftSprint] = useState('');
  const [draftStoryPoints, setDraftStoryPoints] = useState('');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftDueDate, setDraftDueDate] = useState('');
  const [draftSectionId, setDraftSectionId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [attachments, setAttachments] = useState<UserStoryAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [taskPreview, setTaskPreview] = useState<UserStoryGeneratePreview | null>(null);

  const canEdit = Boolean(
    currentUser && story &&
    (currentUser.role === 'superadmin' || projects.some(p => p.id === story.projectId)),
  );
  const canDelete = Boolean(
    currentUser && story &&
    (currentUser.id === story.reporterId || currentUser.role === 'superadmin'),
  );
  const assigneeKey = story ? sortedKey(storyAssigneeIds(story)) : '';

  const resetDraft = useCallback((s: UserStory) => {
    setDraftTitle(s.title);
    setDraftDescription(s.description ?? '');
    setDraftAcceptance(s.acceptanceCriteria ?? '');
    setDraftPriority(normalizePriority(String(s.priority)));
    setDraftAssigneeIds([...storyAssigneeIds(s)]);
    setDraftSprint(s.sprint ?? '');
    setDraftStoryPoints(s.storyPoints != null && s.storyPoints > 0 ? String(s.storyPoints) : '');
    setDraftStartDate(dateOnly(s.startDate));
    setDraftDueDate(dateOnly(s.dueDate));
    setDraftSectionId(s.sectionId ?? '');
    setDraftStatus(s.status);
    setDraftTags([...(s.tags ?? [])]);
    setTagInput('');
  }, []);

  useEffect(() => { if (story && open) resetDraft(story); }, [open, story?.id, assigneeKey, resetDraft]);

  useEffect(() => {
    if (!open || !story) { setAttachments([]); return; }
    let cancelled = false;
    void api.getUserStoryAttachments(story.id)
      .then(rows => { if (!cancelled) setAttachments(rows); })
      .catch(() => { if (!cancelled) setAttachments([]); });
    return () => { cancelled = true; };
  }, [open, story?.id]);

  const isDirty = useMemo(() => {
    if (!story || !canEdit) return false;
    return (
      draftTitle !== story.title ||
      draftDescription !== (story.description ?? '') ||
      draftAcceptance !== (story.acceptanceCriteria ?? '') ||
      draftPriority !== normalizePriority(String(story.priority)) ||
      sortedKey(draftAssigneeIds) !== sortedKey(storyAssigneeIds(story)) ||
      draftSprint.trim() !== (story.sprint ?? '').trim() ||
      (draftStoryPoints.trim() || '') !== (story.storyPoints != null && story.storyPoints > 0 ? String(story.storyPoints) : '') ||
      draftStartDate !== dateOnly(story.startDate) ||
      draftDueDate !== dateOnly(story.dueDate) ||
      draftSectionId !== (story.sectionId ?? '') ||
      draftStatus !== story.status ||
      sortedKey(draftTags) !== sortedKey(story.tags ?? [])
    );
  }, [story, canEdit, draftTitle, draftDescription, draftAcceptance, draftPriority, draftAssigneeIds, draftSprint, draftStoryPoints, draftStartDate, draftDueDate, draftSectionId, draftStatus, draftTags]);

  if (!story) return null;

  const project = projects.find(p => p.id === story.projectId);
  const section = project?.sections.find(s => s.id === (draftSectionId || story.sectionId));
  const reporter = users.find(u => u.id === story.reporterId);
  const projectMembers = project
    ? users.filter(u => project.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const displayStatus = canEdit ? draftStatus : story.status;
  const isDoneDue = displayStatus === 'completed' || displayStatus === 'done' || displayStatus === doneColumnId;
  const dueBucket = getDueBucket(canEdit ? draftDueDate : (story.dueDate ?? ''));
  const isOverdue = dueBucket === 'overdue' && !isDoneDue;
  const storyRef = `US-${story.id.replace(/\D/g, '').padStart(3, '0')}`;
  const displayPriority = canEdit ? draftPriority : normalizePriority(String(story.priority));
  const statusCfg = statusConfig[displayStatus as TaskStatus] ?? statusConfig.backlog;
  const statusLabel = columns.find(c => c.id === displayStatus)?.label ?? statusCfg.label;
  const priCfg = priorityConfig[displayPriority] ?? priorityConfig.Medium;
  const statusOptions = [
    ...columns.map(c => ({ id: c.id, label: c.label })),
    ...((displayStatus === 'completed' || story.status === 'completed') && !columns.some(c => c.id === 'completed')
      ? [{ id: 'completed', label: 'Completed' }]
      : []),
  ];
  if (displayStatus && !statusOptions.some(s => s.id === displayStatus)) {
    statusOptions.push({ id: displayStatus, label: statusCfg.label });
  }
  const doneN = tasks.filter(t => t.status === 'done' || t.status === 'completed' || t.status === doneColumnId).length;
  const pct = Math.min(100, story.progressPercent || 0);
  const showApprove = !!isManager && !isStoryConfirmed(story) && isDoneDue;
  const hours = rollupStoryHours(storeTasks, story.id);
  const fmtH = (h: number) => (h >= 10 ? `${Math.round(h)}h` : `${Math.round(h * 10) / 10}h`);

  const toggleAssignee = (uid: string) => setDraftAssigneeIds(prev =>
    prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);

  const addTag = () => {
    const next = tagInput.trim().replace(/,$/, '');
    if (!next || draftTags.includes(next)) { setTagInput(''); return; }
    setDraftTags(prev => [...prev, next]);
    setTagInput('');
  };

  const parseHours = (raw: string, label: string): number | null => {
    const v = raw.trim();
    if (!v) return 0;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number`);
    return n;
  };

  const saveAll = async () => {
    const title = draftTitle.trim();
    if (!title) { toast.error('Title is required'); return; }
    let storyPoints: number;
    try {
      storyPoints = parseHours(draftStoryPoints, 'Story points') ?? 0;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invalid number');
      return;
    }
    setSaving(true);
    try {
      const updated = await api.patchUserStory(story.id, {
        title,
        description: draftDescription,
        acceptanceCriteria: draftAcceptance,
        priority: draftPriority,
        assigneeIds: [...new Set(draftAssigneeIds)],
        sprint: draftSprint.trim(),
        storyPoints,
        startDate: draftStartDate || null,
        dueDate: draftDueDate || null,
        sectionId: draftSectionId,
        status: draftStatus || story.status,
        tags: draftTags,
      });
      upsertUserStory(updated);
      onUpdated?.(updated);
      if (updated.status === 'done' || updated.status === 'completed' || updated.status === doneColumnId) {
        await syncTasks();
      }
      toast.success('Story saved');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save story'); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteUserStory(story.id);
      removeUserStory(story.id, story.projectId);
      toast.success('Story deleted');
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete story'); }
    finally { setDeleting(false); }
  };

  const generateTasks = async () => {
    if (!story) return;
    if (isDirty) {
      toast.error('Save story changes first');
      return;
    }
    setGenerating(true);
    try {
      const data = await api.generateUserStoryTasksPreview(story.id);
      if (!data.tasks.length) {
        toast.message('No new tasks suggested');
        return;
      }
      setTaskPreview(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generate failed');
    } finally {
      setGenerating(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onOpenChange(next);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFile(true);
    try {
      const att = await api.uploadUserStoryAttachment(story.id, file);
      setAttachments(prev => [...prev, att]);
      toast.success(`${file.name} uploaded`);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
    finally { setUploadingFile(false); e.target.value = ''; }
  };

  const handleDeleteAtt = async (att: UserStoryAttachment) => {
    try {
      await api.deleteUserStoryAttachment(story.id, att.id);
      setAttachments(prev => prev.filter(a => a.id !== att.id));
      toast.success('Attachment deleted');
    } catch { toast.error('Could not delete attachment'); }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[1060px] flex max-h-[min(92dvh,92vh)] min-h-0 flex-col gap-0 overflow-hidden border-border/30 bg-card p-0 rounded-2xl shadow-2xl">
          <DialogTitle className="sr-only">{story.title}</DialogTitle>
          <DialogDescription className="sr-only">Story details for {story.title}</DialogDescription>

          <div className="shrink-0 px-7 pt-5 pb-4 border-b border-border/30 bg-gradient-to-b from-muted/30 to-transparent">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mb-4 flex-wrap pr-10">
              <BookOpen className="h-3 w-3 shrink-0" />
              <span>Story</span>
              <span className="opacity-30">/</span>
              <FolderOpen className="h-3 w-3 shrink-0" />
              <span>{project?.name ?? '—'}</span>
              <span className="opacity-30">/</span>
              <Layers className="h-3 w-3 shrink-0" />
              <span>{section?.name ?? '—'}</span>
              <span className="opacity-30">/</span>
              <span className="font-mono text-foreground/40 font-semibold tracking-wide">{storyRef}</span>
            </div>

            <div className="flex items-start gap-3 justify-between">
              <div className="flex-1 min-w-0 pr-2">
                {canEdit ? (
                  <textarea
                    value={draftTitle}
                    onChange={e => setDraftTitle(e.target.value)}
                    rows={3}
                    className="w-full text-[22px] font-bold bg-muted/40 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-muted/60 placeholder:text-muted-foreground/30 border border-transparent focus:border-primary/20 transition-all leading-snug resize-y min-h-[2.85rem] max-h-[12rem] whitespace-pre-wrap break-words"
                    placeholder="Story title"
                  />
                ) : (
                  <h2 className="text-[22px] font-bold text-foreground leading-snug break-words whitespace-normal">{story.title}</h2>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 shrink-0">
                {showApprove && (
                  <button
                    type="button"
                    disabled={approvingId === story.id}
                    onClick={() => onApprove?.(story.id)}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-all font-medium"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {approvingId === story.id ? 'Approving…' : 'Approve'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onAddTask}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-primary/8 hover:text-primary text-muted-foreground/70 transition-all duration-150 font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Add task
                </button>
                {canDelete && (
                  <button
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="p-2.5 rounded-xl hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-600 dark:text-red-400 transition-all duration-150"
                    title="Delete story"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-4">
              <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${statusCfg.style}`}>{statusLabel}</span>
              <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border flex items-center gap-1.5 ${priCfg.style}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priCfg.dot}`} />
                {displayPriority}
              </span>
              {story.approvedByManager && (
                <span title="Approved" className="w-6 h-6 rounded-full font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center justify-center">
                  <CheckCircle2 className="h-3 w-3" />
                </span>
              )}
              {isOverdue && (
                <span title="Overdue" className="w-6 h-6 rounded-full font-semibold bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/20 inline-flex items-center justify-center">
                  <AlertTriangle className="h-3 w-3" />
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto">{doneN}/{tasks.length} tasks · {pct}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mt-3">
              <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border/20">
            <div className="flex-1 min-w-0 md:overflow-y-auto overscroll-contain p-5 sm:p-7 space-y-7">
              <section>
                <SectionLabel icon={MessageSquare} label="Description" accent="text-blue-400/70" />
                {canEdit ? (
                  <textarea
                    value={draftDescription}
                    onChange={e => setDraftDescription(e.target.value)}
                    placeholder="Add a description…"
                    rows={5}
                    className="w-full rounded-xl border border-border/50 bg-muted/20 px-4 py-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 resize-none transition-all placeholder:text-muted-foreground/35"
                  />
                ) : (
                  <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4 text-sm leading-relaxed min-h-[88px] whitespace-pre-wrap">
                    {story.description?.trim() || <span className="text-muted-foreground/40 italic">No description provided.</span>}
                  </div>
                )}
              </section>

              <section>
                <SectionLabel icon={FileText} label="Acceptance criteria" accent="text-emerald-400/70" />
                {canEdit ? (
                  <textarea
                    value={draftAcceptance}
                    onChange={e => setDraftAcceptance(e.target.value)}
                    placeholder="What must be true for this story to be done…"
                    rows={5}
                    className="w-full rounded-xl border border-border/50 bg-muted/20 px-4 py-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 resize-none transition-all placeholder:text-muted-foreground/35"
                  />
                ) : (
                  <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4 text-sm leading-relaxed min-h-[88px] whitespace-pre-wrap">
                    {story.acceptanceCriteria?.trim() || <span className="text-muted-foreground/40 italic">None added.</span>}
                  </div>
                )}
              </section>

              {canEdit && (
                <section>
                  <SectionLabel icon={User2} label="Manage Assignees" accent="text-violet-400/70" />
                  <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/25 bg-card max-h-[280px] overflow-y-auto">
                    {projectMembers.length === 0 && (
                      <p className="px-4 py-3 text-sm text-muted-foreground/50">No project members.</p>
                    )}
                    {projectMembers.map(u => (
                      <label key={u.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-primary/5 transition-colors group">
                        <Checkbox checked={draftAssigneeIds.includes(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
                        <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{u.name}</div>
                          <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                        </div>
                        {u.role === 'manager' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-bold shrink-0">Mgr</span>
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <section>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel icon={Layers} label={`Tasks (${doneN}/${tasks.length})`} accent="text-sky-400/70" />
                </div>
                {tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground/35 italic">No tasks yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {tasks.map(t => (
                      <StoryTaskRow
                        key={t.id}
                        task={t}
                        doneColumnId={doneColumnId}
                        isManager={isManager}
                        approving={approvingId === t.id}
                        onApprove={() => onApprove?.(t.id)}
                        onClick={() => onTaskClick(t)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                    <Paperclip className="h-3.5 w-3.5 shrink-0" />
                    <span>Attachments {attachments.length > 0 ? `(${attachments.length})` : ''}</span>
                  </div>
                  {canEdit && (
                    <label className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary/8 transition-colors font-medium cursor-pointer">
                      <Upload className="h-3 w-3" />
                      {uploadingFile ? 'Uploading…' : 'Upload'}
                      <input type="file" className="sr-only" onChange={e => void handleFileUpload(e)} disabled={uploadingFile} />
                    </label>
                  )}
                </div>
                {attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground/35 italic">No attachments yet</p>
                ) : (
                  <div className="space-y-2">
                    {attachments.map(att => (
                      <div key={att.id} className="flex items-center gap-2.5 group rounded-xl border border-border/30 px-3 py-2.5 bg-muted/10 hover:bg-muted/25 transition-colors">
                        <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{att.filename}</p>
                          <p className="text-[10px] text-muted-foreground/50">{fmtSize(att.sizeBytes)} · {att.uploaderName}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void api.downloadUserStoryAttachment(story.id, att.id, att.filename).catch(() => toast.error('Download failed'))}
                          className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-all shrink-0"
                          title="Download"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteAtt(att)}
                            className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-600 dark:text-red-400 transition-all shrink-0"
                            title="Delete"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="w-full md:w-[255px] shrink-0 md:overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-6 bg-muted/5">
              <section>
                <SectionLabel icon={AlertTriangle} label="Priority" accent="text-orange-400/70" />
                {canEdit ? (
                  <div className="space-y-1.5">
                    {(['Low', 'Medium', 'High', 'Urgent'] as Priority[]).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setDraftPriority(p)}
                        className={`w-full text-xs px-3 py-2 rounded-xl border font-semibold transition-all text-left flex items-center gap-2.5 ${priorityConfig[p].style} ${
                          draftPriority === p
                            ? `ring-2 ring-offset-1 ring-offset-card ${priorityConfig[p].ring} opacity-100 shadow-sm`
                            : 'opacity-45 hover:opacity-70'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${priorityConfig[p].dot}`} />
                        {p}
                      </button>
                    ))}
                  </div>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border ${priCfg.style}`}>
                    <span className={`w-2 h-2 rounded-full ${priCfg.dot}`} />
                    {displayPriority}
                  </span>
                )}
              </section>

              <section>
                <SectionLabel icon={CircleDot} label="Status" accent="text-slate-400/70" />
                {canEdit ? (
                  <Select value={draftStatus || story.status} onValueChange={setDraftStatus}>
                    <SelectTrigger className="w-full text-xs h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={`inline-flex items-center text-xs px-3 py-1.5 rounded-xl font-semibold border ${statusCfg.style}`}>{statusLabel}</span>
                )}
              </section>

              <section>
                <SectionLabel icon={FolderOpen} label="Project" accent="text-sky-400/70" />
                <p className="text-sm font-semibold text-foreground">{project?.name ?? '—'}</p>
              </section>

              <section>
                <SectionLabel icon={Layers} label="Section" accent="text-teal-400/70" />
                {canEdit && project ? (
                  <Select value={draftSectionId || NONE} onValueChange={v => setDraftSectionId(v === NONE ? '' : v)}>
                    <SelectTrigger className="w-full text-xs h-9">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>None</SelectItem>
                      {project.sections.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-foreground">{section?.name ?? '—'}</p>
                )}
              </section>

              <section>
                <SectionLabel icon={Layers} label="Sprint" accent="text-violet-400/70" />
                {canEdit ? (
                  <SprintSelect value={draftSprint} onChange={setDraftSprint} projectId={story.projectId} />
                ) : (
                  <div className="text-sm text-foreground">{story.sprint?.trim() || 'No sprint'}</div>
                )}
              </section>

              <section>
                <SectionLabel icon={Clock} label="Hours (from tasks)" accent="text-amber-400/70" />
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Estimated</span>
                    <span className="font-semibold tabular-nums">{hours.estimatedHours != null ? fmtH(hours.estimatedHours) : '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Actual</span>
                    <span className="font-semibold tabular-nums">{hours.actualHours > 0 ? fmtH(hours.actualHours) : '0h'}</span>
                  </div>
                </div>
              </section>

              <section>
                <SectionLabel icon={Tag} label="Story points" accent="text-fuchsia-400/70" />
                {canEdit ? (
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={draftStoryPoints}
                    onChange={e => setDraftStoryPoints(e.target.value)}
                    placeholder="Points"
                    className="w-full text-sm font-semibold bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all"
                  />
                ) : (
                  <div className="text-sm text-foreground">{story.storyPoints != null && story.storyPoints > 0 ? story.storyPoints : '—'}</div>
                )}
              </section>

              <section>
                <SectionLabel icon={Calendar} label="Start date" accent="text-cyan-400/70" />
                {canEdit ? (
                  <input
                    type="date"
                    value={draftStartDate}
                    onChange={e => setDraftStartDate(e.target.value)}
                    className="w-full text-sm font-semibold bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 [color-scheme:dark]"
                  />
                ) : (
                  <div className="text-sm text-foreground">{draftStartDate || story.startDate ? fmtDate(draftStartDate || story.startDate || '') : '—'}</div>
                )}
              </section>

              <section>
                <SectionLabel icon={Calendar} label="Due Date" accent="text-cyan-400/70" />
                {canEdit ? (
                  <input
                    type="date"
                    value={draftDueDate}
                    onChange={e => setDraftDueDate(e.target.value)}
                    className="w-full text-sm font-semibold bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 [color-scheme:dark]"
                  />
                ) : draftDueDate || story.dueDate?.trim() ? (
                  <div className={`text-sm font-bold ${dueBucketDateTextClass(dueBucket, isDoneDue)}`}>
                    {fmtDate(draftDueDate || story.dueDate || '')}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No due date</div>
                )}
                {isOverdue && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-red-400/80 bg-red-500/8 px-2 py-0.5 rounded-md border border-red-500/15">
                    <AlertTriangle className="h-3 w-3" /> Past due
                  </div>
                )}
              </section>

              {!canEdit && (
                <section>
                  <SectionLabel icon={User2} label="Assignees" accent="text-violet-400/70" />
                  {storyAssigneeIds(story).length === 0 ? (
                    <p className="text-xs text-muted-foreground/40 italic">Unassigned</p>
                  ) : (
                    <div className="space-y-2.5">
                      {storyAssigneeIds(story).map(id => {
                        const u = users.find(x => x.id === id);
                        if (!u) return null;
                        return (
                          <div key={u.id} className="flex items-center gap-2.5">
                            <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                            <div className="text-xs font-semibold truncate">{u.name}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}

              {(canEdit || draftTags.length > 0) && (
                <section>
                  <SectionLabel icon={Tag} label="Tags" accent="text-pink-400/70" />
                  <div className="flex flex-wrap gap-1.5">
                    {draftTags.map(tag => (
                      <span key={tag} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-full border border-border/40 bg-muted/30 text-muted-foreground">
                        {tag}
                        {canEdit && (
                          <button type="button" onClick={() => setDraftTags(prev => prev.filter(t => t !== tag))} className="hover:text-foreground" aria-label={`Remove ${tag}`}>
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </span>
                    ))}
                  </div>
                  {canEdit && (
                    <input
                      value={tagInput}
                      onChange={e => setTagInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
                      }}
                      onBlur={addTag}
                      placeholder="Add tag"
                      className="mt-2 w-full text-sm bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  )}
                </section>
              )}

              <section>
                <SectionLabel icon={UserCircle} label="People" accent="text-indigo-400/70" />
                <div className="flex items-center gap-2.5">
                  <UserAvatar name={reporter?.name ?? '?'} avatar={reporter?.avatar} size="sm" />
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold">Reporter</div>
                    <div className="text-xs font-semibold truncate">{reporter?.name ?? story.reporterId}</div>
                  </div>
                </div>
              </section>

              <section>
                <SectionLabel icon={Clock} label="Created" accent="text-slate-400/70" />
                <div className="text-[11px] text-foreground/60 tabular-nums">
                  {story.createdAt ? fmtDate(dateOnly(story.createdAt) || story.createdAt) : '—'}
                </div>
              </section>
            </div>
          </div>

          {canEdit && (
            <div className="shrink-0 border-t border-border/25 px-7 py-4 flex items-center gap-3 bg-gradient-to-t from-muted/20 to-transparent">
              <button
                type="button"
                onClick={() => void generateTasks()}
                disabled={generating || saving}
                className="text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/60 transition-all text-muted-foreground hover:text-foreground font-medium inline-flex items-center gap-1.5"
              >
                {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Generate tasks
              </button>
              <div className="flex items-center gap-2.5 ml-auto">
                {isDirty && (
                  <button
                    type="button"
                    onClick={() => resetDraft(story)}
                    disabled={saving}
                    className="text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/60 hover:border-border/80 transition-all text-muted-foreground hover:text-foreground font-medium"
                  >
                    Discard
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void saveAll()}
                  disabled={!isDirty || saving}
                  className="text-sm px-5 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35 transition-all font-semibold shadow-sm"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {taskPreview && story && (
        <GenerateTasksPreviewDialog
          preview={taskPreview}
          onClose={() => setTaskPreview(null)}
          onConfirmed={async tasks => {
            const created = await api.confirmGenerateUserStoryTasks(story.id, { tasks });
            toast.success(created.length ? `Created ${created.length} task(s)` : 'Nothing selected');
            setTaskPreview(null);
            const updated = await api.getUserStory(story.id);
            upsertUserStory(updated);
            onUpdated?.(updated);
            await syncTasks();
          }}
        />
      )}

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this story?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. Linked tasks stay in the project.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={e => { e.preventDefault(); void handleDelete(); }}
            >
              {deleting ? 'Deleting…' : 'Delete story'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
