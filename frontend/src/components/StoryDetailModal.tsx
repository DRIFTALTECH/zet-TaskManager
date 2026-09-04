import { useAppStore } from '@/stores/appStore';
import { KanbanColumn, Priority, Task, TaskStatus, UserStory, UserStoryAttachment, UserStoryFeedback } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  Calendar, Tag, Clock, AlertTriangle, Plus, X, Trash2,
  FolderOpen, Layers, CircleDot, MessageSquare,
  User2, CheckCircle2, Check, Paperclip, Download, Upload, BookOpen, FileText, Sparkles, Loader2, ChevronsUpDown,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, type ElementType } from 'react';
import { useQuery } from '@tanstack/react-query';
import UserAvatar from '@/components/UserAvatar';
import RichTextEditor from '@/components/RichTextEditor';
import { FieldLabel } from '@/components/ui/field';
import { DatePickerInput } from '@/components/DatePickerInput';
import { FIELD_GRID, HIDE_EMPTY_FIELDS } from '@/lib/field-styles';
import { useShowEmptyFields } from '@/hooks/useShowEmptyFields';
import { SprintSelect } from '@/components/SprintSelect';
import { projectPickerLabel } from '@/lib/project-utils';
import { dueBucketDateTextClass, getDueBucket } from '@/lib/due-date-utils';
import { api } from '@/lib/api';
import { GenerateTasksPreviewDialog } from '@/components/GenerateTasksPreviewDialog';
import { PrdWorkbench } from '@/components/prd/PrdWorkbench';
import { CommentsRail } from '@/components/CommentsRail';
import { WorkTypeSelect } from '@/components/dash/WorkTypeSelect';
import { WorkItemRow } from '@/components/WorkItemRow';
import { formatHM } from '@/components/HoursMinutesInput';
import { AssigneeCell } from '@/components/dash/DashCells';
import { queryClient, removeUserStory, storyKeys, upsertUserStory } from '@/lib/queryClient';
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
  onUpdated?: (s: UserStory) => void;
  /** Turn this story into a task. */
  onConvert?: (storyId: string) => void;
}

export default function StoryDetailModal({
  story, open, onOpenChange, tasks, columns, doneColumnId,
  onTaskClick, onAddTask, isManager, onUpdated, onConvert,
}: Props) {
  const { users, projects, currentUser, syncTasks, tasks: storeTasks } = useAppStore();
  const { showEmpty, toggleEmptyFields } = useShowEmptyFields();
  const storyId = story?.id ?? '';
  const { data: feedbackList = [], isLoading: feedbackLoading } = useQuery({
    queryKey: storyKeys.feedback(storyId),
    queryFn: () => api.listUserStoryFeedback(storyId),
    enabled: open && !!storyId,
    staleTime: Infinity,
  });
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftAcceptance, setDraftAcceptance] = useState('');
  const [draftPriority, setDraftPriority] = useState<Priority>('Medium');
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [draftSprint, setDraftSprint] = useState('');
  const [draftStoryPoints, setDraftStoryPoints] = useState('');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftDueDate, setDraftDueDate] = useState('');
  const [draftProjectId, setDraftProjectId] = useState('');
  const [draftSectionId, setDraftSectionId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [attachments, setAttachments] = useState<UserStoryAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [taskPreview, setTaskPreview] = useState<UserStoryGeneratePreview | null>(null);
  const [generateChoiceOpen, setGenerateChoiceOpen] = useState(false);
  const [brdOpen, setBrdOpen] = useState(false);

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
    setDraftProjectId(s.projectId);
    setDraftSectionId(s.sectionId ?? '');
    setDraftStatus(s.status);
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
      draftProjectId !== story.projectId ||
      draftSectionId !== (story.sectionId ?? '') ||
      draftStatus !== story.status
    );
  }, [story, canEdit, draftTitle, draftDescription, draftAcceptance, draftPriority, draftAssigneeIds, draftSprint, draftStoryPoints, draftStartDate, draftDueDate, draftProjectId, draftSectionId, draftStatus]);

  // Must stay above the early return below — hooks cannot be conditional.
  const handleOpenChange = useUnsavedChangesGuard({ isDirty, onOpenChange, what: 'story' });

  if (!story) return null;

  const project = projects.find(p => p.id === (canEdit ? (draftProjectId || story.projectId) : story.projectId));
  const editableProjects = currentUser?.role === 'superadmin'
    ? projects
    : projects.filter(p => currentUser?.projectIds.includes(p.id));
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
  const hours = rollupStoryHours(storeTasks, story.id);

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
        projectId: draftProjectId || story.projectId,
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
        <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] min-h-0 max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border/30 bg-card p-0 shadow-2xl sm:max-w-[min(96vw,1500px)]">
          <DialogTitle className="sr-only">{story.title}</DialogTitle>
          <DialogDescription className="sr-only">Story details for {story.title}</DialogDescription>

          <div className="shrink-0 px-5 pt-3 pb-3 sm:px-7 border-b border-border/30 bg-gradient-to-b from-muted/30 to-transparent">
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mb-2 flex-wrap pr-10">
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
                    ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                    rows={1}
                    className="w-full resize-none overflow-y-auto rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-[18px] font-bold leading-snug tracking-tight text-foreground transition-colors placeholder:text-muted-foreground/30 hover:bg-muted/40 focus:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-[8rem] whitespace-pre-wrap break-words"
                    placeholder="Story title"
                  />
                ) : (
                  <h2 className="px-2 py-0.5 text-[18px] font-bold leading-snug tracking-tight text-foreground break-words whitespace-normal">{story.title}</h2>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 shrink-0">
                <button
                  type="button"
                  onClick={onAddTask}
                  className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-primary/8 hover:text-primary text-muted-foreground/70 transition-all duration-150 font-medium"
                >
                  <Plus className="h-3.5 w-3.5" /> Add task
                </button>
                {canEdit && onConvert && (
                  <WorkTypeSelect
                    size="md"
                    value="story"
                    onChange={() => onConvert(story.id)}
                  />
                )}
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

            <div className="flex flex-wrap items-center gap-2 mt-2">
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
            <div className="h-1 rounded-full bg-muted/40 overflow-hidden mt-2">
              <div className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>

          {/* ── Body: fields + content scroll together, rail runs full height ── */}
          <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border/20">
            <div className="flex-1 min-w-0 md:overflow-y-auto overscroll-contain">

              {/* ── Fields ─────────────────────────────────────── */}
              <div className="border-b border-border/30 px-5 py-3 sm:px-7">
            <div className={`${FIELD_GRID} ${showEmpty ? '' : HIDE_EMPTY_FIELDS}`}>
              <section>
                <FieldLabel icon={AlertTriangle} label="Priority" />
                {canEdit ? (
                  <Select value={draftPriority} onValueChange={v => setDraftPriority(v as Priority)}>
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['Urgent', 'High', 'Medium', 'Low'] as Priority[]).map(p => (
                        <SelectItem key={p} value={p}>
                          <span className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${priorityConfig[p].dot}`} />
                            {p}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border ${priCfg.style}`}>
                    <span className={`w-2 h-2 rounded-full ${priCfg.dot}`} />
                    {displayPriority}
                  </span>
                )}
              </section>

              <section>
                <FieldLabel icon={CircleDot} label="Status" />
                {canEdit ? (
                  <Select value={draftStatus || story.status} onValueChange={setDraftStatus}>
                    <SelectTrigger className="h-8 w-full text-xs">
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
                <FieldLabel icon={FolderOpen} label="Project" />
                {canEdit ? (
                  <Select
                    value={draftProjectId || story.projectId}
                    onValueChange={pid => {
                      setDraftProjectId(pid);
                      // Sections belong to a project; the old one cannot survive the move.
                      setDraftSectionId('');
                      const dest = projects.find(p => p.id === pid);
                      setDraftAssigneeIds(prev => prev.filter(id => dest?.members.includes(id)));
                    }}
                  >
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {editableProjects.map(p => (
                        <SelectItem key={p.id} value={p.id}>{projectPickerLabel(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-sm font-semibold text-foreground">{project?.name ?? '—'}</p>
                )}
              </section>

              <section data-empty={!(canEdit ? draftSectionId : section?.name)}>
                <FieldLabel icon={Layers} label="Section" />
                {canEdit && project ? (
                  <Select value={draftSectionId || NONE} onValueChange={v => setDraftSectionId(v === NONE ? '' : v)}>
                    <SelectTrigger className="h-8 w-full text-xs">
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

              <section data-empty={!(canEdit ? draftSprint : story.sprint?.trim())}>
                <FieldLabel icon={Layers} label="Sprint" />
                {canEdit ? (
                  <SprintSelect value={draftSprint} onChange={setDraftSprint} projectId={story.projectId} />
                ) : (
                  <div className="text-sm text-foreground">{story.sprint?.trim() || 'No sprint'}</div>
                )}
              </section>

              <section>
                <FieldLabel icon={Clock} label="Estimate" />
                <div className="text-sm font-semibold tabular-nums">
                  {hours.estimatedHours != null ? formatHM(String(hours.estimatedHours)) : '—'}
                </div>
              </section>

              {/* Rolled up from this story's tasks — edited on the task, not here. */}
              <section>
                <FieldLabel icon={Clock} label="Actual" />
                <div className="text-sm font-semibold tabular-nums">
                  {hours.actualHours > 0 ? formatHM(String(hours.actualHours)) : '—'}
                </div>
              </section>

              <section data-empty={!(canEdit ? draftStoryPoints : story.storyPoints)}>
                <FieldLabel icon={Tag} label="Story points" />
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

              <section data-empty={!(draftStartDate || story.startDate)}>
                <FieldLabel icon={Calendar} label="Start date" />
                <div className="min-w-0">
                {canEdit ? (
                  <DatePickerInput
                    value={draftStartDate}
                    onChange={setDraftStartDate}
                    placeholder="No start date"
                    aria-label="Start date"
                  />
                ) : (
                  <div className="text-sm text-foreground">{draftStartDate || story.startDate ? fmtDate(draftStartDate || story.startDate || '') : '—'}</div>
                )}
                </div>
              </section>

              <section data-empty={!(draftDueDate || story.dueDate?.trim())}>
                <FieldLabel icon={Calendar} label="Due Date" />
                <div className="min-w-0">
                {canEdit ? (
                  <DatePickerInput
                    value={draftDueDate}
                    onChange={setDraftDueDate}
                    placeholder="No due date"
                    aria-label="Due date"
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
                </div>
              </section>

              <section>
                <FieldLabel icon={User2} label="Assignees" />
                <div className="min-w-0">
                {canEdit ? (
                  <AssigneeCell
                    assigneeIds={draftAssigneeIds}
                    members={projectMembers}
                    onChange={setDraftAssigneeIds}
                  />
                ) : storyAssigneeIds(story).length === 0 ? (
                  <p className="text-xs text-muted-foreground/40 italic">Unassigned</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {storyAssigneeIds(story).map(id => {
                      const u = users.find(x => x.id === id);
                      if (!u) return null;
                      return (
                        <span key={u.id} className="inline-flex items-center gap-1.5">
                          <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                          <span className="text-xs font-medium truncate">{u.name}</span>
                        </span>
                      );
                    })}
                  </div>
                )}
                </div>
              </section>

              <section>
                <FieldLabel icon={Clock} label="Created" />
                <div className="text-[11px] text-foreground/60 tabular-nums">
                  {story.createdAt ? fmtDate(dateOnly(story.createdAt) || story.createdAt) : '—'}
                </div>
              </section>
            </div>
            <button
              type="button"
              onClick={toggleEmptyFields}
              className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <ChevronsUpDown className="h-3 w-3" />
              {showEmpty ? 'Collapse empty fields' : 'Show empty fields'}
            </button>
          </div>

              <div className="p-5 sm:p-7 space-y-7">
              <section>
                <FieldLabel icon={MessageSquare} label="Description" />
{canEdit ? (
                  <RichTextEditor
                    value={draftDescription}
                    onChange={setDraftDescription}
                    placeholder="Add a description…"
                    className="rounded-xl border border-border/50 bg-muted/20 px-3 py-3"
                  />
                ) : story.description?.trim() ? (
                  <RichTextEditor value={story.description} onChange={() => {}} editable={false} />
                ) : (
                  <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4 text-sm italic text-muted-foreground/40">
                    No description provided.
                  </div>
                )}
              </section>

              <section>
                <FieldLabel icon={FileText} label="Acceptance criteria" />
{canEdit ? (
                  <RichTextEditor
                    value={draftAcceptance}
                    onChange={setDraftAcceptance}
                    placeholder="What must be true for this story to be done…"
                    className="rounded-xl border border-border/50 bg-muted/20 px-3 py-3"
                  />
                ) : story.acceptanceCriteria?.trim() ? (
                  <RichTextEditor value={story.acceptanceCriteria} onChange={() => {}} editable={false} />
                ) : (
                  <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4 text-sm italic text-muted-foreground/40">
                    None added.
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-3">
                  <FieldLabel icon={Layers} label={`Tasks (${doneN}/${tasks.length})`} />
                </div>
                {tasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground/35 italic">No tasks yet</p>
                ) : (
                  <div className="space-y-1.5">
                    {tasks.map(t => (
                      <WorkItemRow
                        key={t.id}
                        task={t}
                        doneColumnId={doneColumnId}
                        onClick={() => onTaskClick(t)}
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 opacity-60" />
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
            </div>

            {/* ── RIGHT rail: comments ────────────────────── */}
            <CommentsRail
              comments={feedbackList}
              loading={feedbackLoading}
              onPost={async (message, mentionedUserIds) => {
                const created = await api.createUserStoryFeedback(story.id, message, mentionedUserIds);
                queryClient.setQueryData(storyKeys.feedback(story.id), (prev: UserStoryFeedback[] | undefined) => [...(prev ?? []), created]);
              }}
              onEdit={async (id, message) => {
                const updated = await api.patchUserStoryFeedback(story.id, id, message);
                queryClient.setQueryData(storyKeys.feedback(story.id), (prev: UserStoryFeedback[] | undefined) =>
                  (prev ?? []).map(f => f.id === updated.id ? updated : f),
                );
              }}
              onDelete={async id => {
                await api.deleteUserStoryFeedback(story.id, id);
                queryClient.setQueryData(storyKeys.feedback(story.id), (prev: UserStoryFeedback[] | undefined) =>
                  (prev ?? []).filter(f => f.id !== id),
                );
              }}
            />
          </div>

          {canEdit && (
            <div className="shrink-0 border-t border-border/25 px-7 py-4 flex items-center gap-3 bg-gradient-to-t from-muted/20 to-transparent">
              <button
                type="button"
                onClick={() => setGenerateChoiceOpen(true)}
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

      <Dialog open={generateChoiceOpen} onOpenChange={setGenerateChoiceOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogTitle>Generate tasks</DialogTitle>
          <DialogDescription>
            Work from what this story already says, or bring in a requirements document.
          </DialogDescription>
          <div className="mt-2 grid gap-2">
            <button
              type="button"
              onClick={() => { setGenerateChoiceOpen(false); void generateTasks(); }}
              disabled={generating}
              className="flex items-start gap-3 rounded-xl border border-border/60 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:opacity-50"
            >
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">From this story</span>
                <span className="block text-xs text-muted-foreground">
                  Suggest tasks from the description and acceptance criteria.
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => { setGenerateChoiceOpen(false); setBrdOpen(true); }}
              className="flex items-start gap-3 rounded-xl border border-border/60 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/5"
            >
              <Upload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold">Upload a BRD</span>
                <span className="block text-xs text-muted-foreground">
                  Paste or drop a BRD/PRD and draft stories from it, same as the PRD studio.
                </span>
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={brdOpen} onOpenChange={setBrdOpen}>
        <DialogContent className="flex h-[calc(100dvh-3rem)] w-[calc(100vw-3rem)] max-w-none flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-[min(94vw,1200px)]">
          <div className="shrink-0 border-b border-border/40 px-6 py-4">
            <DialogTitle>Import a BRD</DialogTitle>
            <DialogDescription>
              Analyze the document into user stories, then open one to generate its tasks.
            </DialogDescription>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            <PrdWorkbench onSaved={() => { void syncTasks(); }} />
          </div>
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
