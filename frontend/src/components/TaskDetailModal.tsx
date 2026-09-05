import { useAppStore } from '@/stores/appStore';
import AttachmentViewer, { type ViewableAttachment } from '@/components/AttachmentViewer';
import { useElapsedTime } from '@/hooks/useElapsedTime';
import { Task, Priority, TaskStatus, TaskAttachment, TaskFeedback } from '@/types';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  Calendar, Tag, Clock, AlertTriangle, Plus, X, Trash2,
  FolderOpen, Layers, Mail, UserCircle, CircleDot,
  MessageSquare, User2, CheckCircle2, RotateCcw, ChevronRight,
  Paperclip, Download, Upload, Sparkles, Eye, BookOpen, Flag, Save, Undo2, Loader2, ChevronLeft,
  ChevronsUpDown,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { taskAssigneeIds, isTaskAssignedTo, normalizePriority, childTasksOf, isTaskDone, isDoneBoardStatus } from '@/lib/task-utils';
import { projectPickerLabel } from '@/lib/project-utils';
import UserAvatar from '@/components/UserAvatar';
import { ExpandableRichText } from '@/components/ExpandableRichText';
import { CommentsRail } from '@/components/CommentsRail';
import { Hint } from '@/components/ui/hint';
import { MODAL_HEADER_ACTION, MODAL_HEADER_ACTION_PRIMARY } from '@/lib/field-styles';
import { priorityTextClass } from '@/lib/priority-styles';
import { FieldLabel } from '@/components/ui/field';
import { DatePickerInput } from '@/components/DatePickerInput';
import { FIELD_GRID, HIDE_EMPTY_FIELDS } from '@/lib/field-styles';
import { useShowEmptyFields } from '@/hooks/useShowEmptyFields';
import { WorkTypeSelect } from '@/components/dash/WorkTypeSelect';
import { HoursMinutesInput, formatHM, secondsToDecimalHours } from '@/components/HoursMinutesInput';
import { AssigneeCell } from '@/components/dash/DashCells';
import { SprintSelect } from '@/components/SprintSelect';
import { dueBucketDateTextClass, getDueBucket } from '@/lib/due-date-utils';
import { api } from '@/lib/api';
import { promptActualHours } from '@/components/ActualHoursDialog';
import { queryClient, taskKeys } from '@/lib/queryClient';
import { InlineSubtaskComposer } from '@/components/InlineSubtaskComposer';
import { WorkItemTable } from '@/components/WorkItemTable';
import { formatLocalDateTime } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
interface Props {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Steps back to whatever this was opened from. Absent at the top level. */
  onBack?: () => void;
  /** Turn this task into a story. */
  onConvert?: (taskId: string) => void;
}

// ── Config maps ───────────────────────────────────────────────────────────────
const statusConfig: Record<TaskStatus, { style: string; label: string; bar: string }> = {
  backlog:     { style: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30', label: 'Backlog',     bar: 'bg-slate-500' },
  in_progress: { style: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',   label: 'In Progress', bar: 'bg-blue-500' },
  in_review:   { style: 'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30', label: 'In Review', bar: 'bg-violet-500' },
  done:        { style: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30', label: 'Done',        bar: 'bg-green-500' },
  completed:   { style: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30', label: 'Completed', bar: 'bg-emerald-500' },
};

// ── Avatar helpers ────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
}
function dateOnly(s?: string | null) {
  return (s ?? '').trim().slice(0, 10);
}
/** createdAt from API: full ISO (new tasks) or legacy YYYY-MM-DD only */
function parseTaskCreatedAt(createdAt: string): { dateStr: string; timeStr: string | null } | null {
  if (!createdAt?.trim()) return null;
  const s = createdAt.trim();
  const hasClock = /T\d{1,2}:\d{2}/.test(s);
  const d = new Date(hasClock ? s : `${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return { dateStr: createdAt, timeStr: null };
  const dateStr = d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
  const timeStr = hasClock
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : null;
  return { dateStr, timeStr };
}
function fmtTaskCreatedTimeline(createdAt: string): string {
  const p = parseTaskCreatedAt(createdAt);
  if (!p) return '';
  return p.timeStr ? `${p.dateStr} · ${p.timeStr}` : p.dateStr;
}
function fmtTime(s: number) { const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return `${h}h ${m}m`; }
function tsShort(iso: string) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${hh}:${mm}`;
  } catch {
    return iso;
  }
}
function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function sortedKey(ids: string[]) { return [...ids].sort().join('|'); }

function renderMessageWithMentions(message: string, userNames: string[]) {
  if (!message.includes('@')) return message;

  const escaped = [...new Set(userNames.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = escaped.length
    ? new RegExp(`(@(?:${escaped.join('|')}|\\S+))`, 'g')
    : /@\S+/g;

  const parts = message.split(pattern);
  return parts.map((part, i) =>
    part.startsWith('@') ? (
      <span key={i} className="font-semibold text-violet-600 dark:text-violet-400">{part}</span>
    ) : (
      part
    ),
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Avatar({ name, avatar, size = 'md' }: { name: string; avatar?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap: Record<string, 'sm' | 'md' | 'lg'> = { sm: 'sm', md: 'md', lg: 'lg' };
  return <UserAvatar name={name} avatar={avatar} size={sizeMap[size]} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
const TaskDetailModal = ({ task: listTask, open, onOpenChange, onBack, onConvert }: Props) => {
  const {
    users, projects, kanbanColumns, updateTask, currentUser, deleteTask, reopenTaskToBacklog,
    activeTimers, startTimer, stopTimer, tasks: allTasks, moveTask, createTask,
  } = useAppStore();
  const { showEmpty, toggleEmptyFields } = useShowEmptyFields();
  const { data: fullTask } = useQuery({
    queryKey: taskKeys.detail(listTask?.id ?? '_'),
    queryFn: () => api.getTask(listTask!.id),
    enabled: open && !!listTask?.id,
    staleTime: Infinity,
    placeholderData: listTask ?? undefined,
  });
  const task = fullTask ?? listTask;
  const nestedChildren = useMemo(
    () => (task ? childTasksOf(allTasks, task.id) : []),
    [task, allTasks],
  );
  /**
   * A subtask made from the open task inherits what places it — project,
   * section, story, column — so only the title is worth typing. It starts
   * unassigned; whoever picks it up assigns it.
   *
   * The one-level rule lives on the server, so a task that is itself a subtask
   * offers nothing to add to.
   */
  const canAddSubtask = !!task && !task.parentTaskId && !!currentUser;
  const addSubtask = async (title: string) => {
    if (!task || !currentUser) return;
    try {
      await createTask({
        title,
        description: '',
        projectId: task.projectId,
        sectionId: task.sectionId,
        assigneeIds: [],
        assignedBy: currentUser.id,
        createdBy: currentUser.id,
        dueDate: '',
        priority: task.priority,
        status: task.status,
        tags: [],
        parentTaskId: task.id,
        userStoryId: task.userStoryId || undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add that subtask');
    }
  };

  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftPriority, setDraftPriority] = useState<Priority>('Medium');
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [draftSprint, setDraftSprint] = useState('');
  const [draftEstimatedHours, setDraftEstimatedHours] = useState('');
  const [draftActualHours, setDraftActualHours] = useState('');
  const [draftDueDate, setDraftDueDate] = useState('');
  const [draftProjectId, setDraftProjectId] = useState('');
  const [draftSectionId, setDraftSectionId] = useState('');
  const [draftStatus, setDraftStatus] = useState('');
  const [draftStartedAt, setDraftStartedAt] = useState('');
  const [draftCompletedAt, setDraftCompletedAt] = useState('');
  const [saving, setSaving] = useState(false);

  const taskId = task?.id ?? '';
  const { data: feedbackList = [], isLoading: feedbackLoading } = useQuery({
    queryKey: taskKeys.feedback(taskId),
    queryFn: () => api.listTaskFeedback(taskId),
    enabled: open && !!taskId,
    staleTime: Infinity,
  });
  const { data: attachments = [], isLoading: attachmentsLoading } = useQuery({
    queryKey: taskKeys.attachments(taskId),
    queryFn: () => api.getAttachments(taskId),
    enabled: open && !!taskId,
    staleTime: Infinity,
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummarizing, setAiSummarizing] = useState(false);
  const [showAiSummary, setShowAiSummary] = useState(false);

  // ── Attachments ─────────────────────────────────────────────────────────────
  const [uploadingFile, setUploadingFile] = useState(false);
  // Inline viewer: preview a doc/diff/image in-app instead of downloading.
  const [viewing, setViewing] = useState<ViewableAttachment | null>(null);

  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const isCompleted = task?.status === 'completed';
  const canReopenToBacklog = Boolean(
    currentUser && task && isCompleted &&
    (currentUser.id === task.createdBy || isTaskAssignedTo(task, currentUser.id) || isManager),
  );
  const canEdit = Boolean(
    currentUser && task &&
    (currentUser.role === 'superadmin' || projects.some(p => p.id === task.projectId)),
  );
  const canDeleteTask = Boolean(
    currentUser && task &&
    (currentUser.id === task.createdBy || currentUser.role === 'superadmin'),
  );
  const assigneeKey = task ? sortedKey(taskAssigneeIds(task)) : '';

  const resetDraft = useCallback((t: Task) => {
    setDraftTitle(t.title);
    setDraftDescription(t.description ?? '');
    setDraftPriority(normalizePriority(t.priority));
    setDraftAssigneeIds([...taskAssigneeIds(t)]);
    setDraftSprint(t.sprint ?? '');
    setDraftEstimatedHours(t.estimatedHours != null && t.estimatedHours > 0 ? String(t.estimatedHours) : '');
    setDraftActualHours(secondsToDecimalHours(t.timeTracked || 0));
    setDraftDueDate(dateOnly(t.dueDate));
    setDraftProjectId(t.projectId);
    setDraftSectionId(t.sectionId);
    setDraftStatus(t.status);
    setDraftStartedAt(dateOnly(t.startedAt));
    setDraftCompletedAt(dateOnly(t.completedAt));
  }, []);

  useEffect(() => { if (task && open) resetDraft(task); }, [open, task?.id, task?.description, assigneeKey, resetDraft]);
  useEffect(() => {
    if (!open || !task?.id) return;
    setAiSummary(null); setShowAiSummary(false);
  }, [open, task?.id]);

  const isDirty = useMemo(() => {
    if (!task || !canEdit) return false;
    return (
      draftTitle !== task.title ||
      draftDescription !== (task.description ?? '') ||
      draftPriority !== normalizePriority(task.priority) ||
      sortedKey(draftAssigneeIds) !== sortedKey(taskAssigneeIds(task)) ||
      draftSprint.trim() !== (task.sprint ?? '').trim() ||
      (draftEstimatedHours.trim() || '') !== (task.estimatedHours != null && task.estimatedHours > 0 ? String(task.estimatedHours) : '') ||
      draftActualHours !== secondsToDecimalHours(task.timeTracked || 0) ||
      draftDueDate !== dateOnly(task.dueDate) ||
      draftProjectId !== task.projectId ||
      draftSectionId !== task.sectionId ||
      draftStatus !== task.status ||
      draftStartedAt !== dateOnly(task.startedAt) ||
      draftCompletedAt !== dateOnly(task.completedAt)
    );
  }, [task, canEdit, draftTitle, draftDescription, draftPriority, draftAssigneeIds, draftSprint, draftEstimatedHours, draftActualHours, draftDueDate, draftProjectId, draftSectionId, draftStatus, draftStartedAt, draftCompletedAt]);

  const timerEpochStart = task ? (activeTimers[task.id] ?? null) : null;
  const elapsed = useElapsedTime(timerEpochStart);
  const isTimerActive = !!timerEpochStart;
  const canUseTaskTimer = Boolean(
    task && currentUser && isTaskAssignedTo(task, currentUser.id) &&
    task.status !== 'completed' && task.status !== 'done',
  );

  // Must stay above the early return below — hooks cannot be conditional.
  const handleOpenChange = useUnsavedChangesGuard({ isDirty, onOpenChange, what: 'task' });

  if (!task) return null;

  const project = projects.find(p => p.id === (draftProjectId || task.projectId));
  const section = project?.sections.find(s => s.id === (draftSectionId || task.sectionId));
  const editableProjects = currentUser?.role === 'superadmin'
    ? projects
    : projects.filter(p => currentUser?.projectIds.includes(p.id));
  const assigner = users.find(u => u.id === task.assignedBy);
  const creator = users.find(u => u.id === task.createdBy);
  const projectMembers = project
    ? users.filter(u => project.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const assigneeUsers = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;
  const displayStatus = canEdit ? draftStatus : task.status;
  const isDoneDue = displayStatus === 'completed' || displayStatus === 'done';
  const dueBucket = getDueBucket(canEdit ? draftDueDate : task.dueDate);
  const isOverdue = dueBucket === 'overdue' && !isDoneDue;
  const taskRef = `TF-${task.id.replace(/\D/g, '').padStart(3, '0')}`;
  const displayPriority = canEdit ? draftPriority : normalizePriority(task.priority);
  const statusCfg = statusConfig[displayStatus as TaskStatus] ?? statusConfig.backlog;
  // Resolve the display label from kanban columns so custom columns show their real name
  const statusLabel = kanbanColumns.find(c => c.id === displayStatus)?.label ?? statusCfg.label;
  const taskCreatedTimeline = fmtTaskCreatedTimeline(task.createdAt);
  const statusOptions = [
    ...kanbanColumns.map(c => ({ id: c.id, label: c.label })),
    ...((displayStatus === 'completed' || task.status === 'completed') && !kanbanColumns.some(c => c.id === 'completed')
      ? [{ id: 'completed', label: 'Completed' }]
      : []),
  ];
  if (displayStatus && !statusOptions.some(s => s.id === displayStatus)) {
    statusOptions.push({ id: displayStatus, label: statusCfg.label });
  }

  const handleProjectChange = (pid: string) => {
    setDraftProjectId(pid);
    const next = projects.find(p => p.id === pid);
    const firstSection = next?.sections[0]?.id ?? '';
    setDraftSectionId(firstSection);
    const memberIds = new Set(next?.members ?? []);
    setDraftAssigneeIds(prev => prev.filter(id => memberIds.has(id)));
  };

  const saveAll = async () => {
    const title = draftTitle.trim();
    if (!title) { toast.error('Title is required'); return; }
    if (!draftSectionId) { toast.error('Pick a section in the selected project'); return; }
    const estRaw = draftEstimatedHours.trim();
    let estimatedHours: number | null = null;
    if (estRaw) {
      const n = Number(estRaw);
      if (!Number.isFinite(n) || n < 0) { toast.error('Estimated time must be a number of hours'); return; }
      estimatedHours = n > 0 ? n : null;
    }
    const ids = [...new Set(draftAssigneeIds)];
    // Only send actual time when it was actually touched: the server replaces the
    // task's time logs and its timesheet row with whatever arrives here, so
    // sending an unchanged value on every save would rewrite both for nothing.
    let actualHours: number | undefined;
    const actualRaw = draftActualHours.trim();
    if (actualRaw !== secondsToDecimalHours(task.timeTracked || 0)) {
      const n = actualRaw ? Number(actualRaw) : 0;
      if (!Number.isFinite(n) || n < 0) { toast.error('Actual time must be hours and minutes'); return; }
      actualHours = n;
    }
    if (
      actualHours === undefined &&
      isDoneBoardStatus(draftStatus || task.status) &&
      !isDoneBoardStatus(task.status)
    ) {
      const hours = await promptActualHours(task, 'done');
      if (hours === null) return;
      actualHours = hours;
    }
    setSaving(true);
    try {
      await updateTask(task.id, {
        title,
        description: draftDescription,
        priority: draftPriority,
        assigneeIds: ids,
        sprint: draftSprint.trim(),
        estimatedHours,
        dueDate: draftDueDate,
        projectId: draftProjectId || task.projectId,
        sectionId: draftSectionId || task.sectionId,
        status: draftStatus || task.status,
        startedAt: draftStartedAt || null,
        completedAt: draftCompletedAt || null,
        actualHours,
      });
      toast.success('Task saved');
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save task'); }
    finally { setSaving(false); }
  };

  const summarize = async (reveal: boolean) => {
    setAiSummarizing(true);
    if (reveal) setAiSummary(null);
    try {
      const res = await api.aiSummarizeTask(task.id);
      setAiSummary(res.summary);
      if (reveal) setShowAiSummary(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not summarize');
    } finally {
      setAiSummarizing(false);
    }
  };

  const handleDeleteTask = async () => {
    setDeleting(true);
    try { await deleteTask(task.id); toast.success('Task deleted'); setDeleteConfirmOpen(false); onOpenChange(false); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete task'); }
    finally { setDeleting(false); }
  };

  const handleReopenToBacklog = async () => {
    if (!task) return;
    setReopening(true);
    try {
      await reopenTaskToBacklog(task.id);
      toast.success('Task moved back to backlog on the dashboard');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move task to backlog');
    } finally { setReopening(false); }
  };



  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="flex h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] min-h-0 max-w-none flex-col gap-0 overflow-hidden rounded-2xl border-border/30 bg-card p-0 shadow-2xl sm:max-w-[min(96vw,1500px)]" style={{ maxHeight: 'none' }}>
          <DialogTitle className="sr-only">{task.title}</DialogTitle>
          <DialogDescription className="sr-only">Task details for {task.title}</DialogDescription>

          {/* ── Header ────────────────────────────────────────────── */}
          <div className="shrink-0 px-5 pt-3 pb-3 sm:px-7 border-b border-border/30 bg-gradient-to-b from-muted/30 to-transparent">

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mb-2 flex-wrap pr-10">
              {onBack && (
                <Hint label="Back">
                  <button
                    type="button"
                    onClick={onBack}
                    aria-label="Back"
                    className="-ml-1 shrink-0 rounded-md p-0.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                </Hint>
              )}
              {canEdit && onConvert ? (
                <WorkTypeSelect size="md" value="task" onChange={() => onConvert(task.id)} />
              ) : (
                <>
                  <CircleDot className="h-3 w-3 shrink-0" />
                  <span>Task</span>
                </>
              )}
              <ChevronRight className="h-3 w-3 shrink-0 opacity-30" />
              <FolderOpen className="h-3 w-3 shrink-0" />
              <span className="hover:text-foreground/70 transition-colors cursor-default">{project?.name ?? '—'}</span>
              <ChevronRight className="h-3 w-3 shrink-0 opacity-30" />
              <Layers className="h-3 w-3 shrink-0" />
              <span className="hover:text-foreground/70 transition-colors cursor-default">{section?.name ?? '—'}</span>
              <ChevronRight className="h-3 w-3 shrink-0 opacity-30" />
              <span className="font-mono text-foreground/40 font-semibold tracking-wide">{taskRef}</span>
            </div>

            {/* Title + actions */}
            <div className="flex items-start gap-3 justify-between">
              <div className="flex-1 min-w-0 pr-2">
                {canEdit ? (
                  <textarea
                    value={draftTitle}
                    onChange={e => setDraftTitle(e.target.value)}
                    ref={el => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } }}
                    rows={1}
                    className="w-full resize-none overflow-y-auto rounded-lg border border-transparent bg-transparent px-2 py-0.5 text-[18px] font-bold leading-snug tracking-tight text-foreground transition-colors placeholder:text-muted-foreground/30 hover:bg-muted/40 focus:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/30 max-h-[8rem] whitespace-pre-wrap break-words"
                    placeholder="Task title"
                  />
                ) : (
                  <h2 className="px-2 py-0.5 text-[18px] font-bold leading-snug tracking-tight text-foreground break-words whitespace-normal">
                    {task.title}
                  </h2>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 shrink-0 pr-8">
                {task.isStarted && (
                  <span title="Started" className="w-6 h-6 rounded-full font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 inline-flex items-center justify-center">
                    <CircleDot className="h-3 w-3" />
                  </span>
                )}
                {task.approvedByManager && (
                  <span title="Approved" className="w-6 h-6 rounded-full font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center justify-center">
                    <CheckCircle2 className="h-3 w-3" />
                  </span>
                )}
                {canReopenToBacklog && (
                  <button
                    onClick={() => void handleReopenToBacklog()}
                    disabled={reopening}
                    className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-border/50 hover:border-primary/50 hover:bg-primary/8 hover:text-primary text-muted-foreground/70 transition-all duration-150 font-medium"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {reopening ? 'Moving…' : 'Reopen'}
                  </button>
                )}
                {canEdit && (
                  <>
                    {isDirty && (
                      <Hint label="Discard changes">
                        <button
                          type="button"
                          onClick={() => resetDraft(task)}
                          disabled={saving}
                          aria-label="Discard changes"
                          className={MODAL_HEADER_ACTION}
                        >
                          <Undo2 className="h-4 w-4" />
                        </button>
                      </Hint>
                    )}
                    <Hint label={saving ? 'Saving…' : 'Save changes'}>
                      <button
                        type="button"
                        onClick={() => void saveAll()}
                        disabled={!isDirty || saving}
                        aria-label="Save changes"
                        className={MODAL_HEADER_ACTION_PRIMARY}
                      >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      </button>
                    </Hint>
                  </>
                )}
                {canDeleteTask && (
                  <Hint label="Delete task">
                    <button
                      onClick={() => setDeleteConfirmOpen(true)}
                      aria-label="Delete task"
                      className="p-2.5 rounded-xl hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-600 dark:text-red-400 transition-all duration-150 group"
                    >
                      <Trash2 className="h-4 w-4 group-hover:scale-110 transition-transform" />
                    </button>
                  </Hint>
                )}
              </div>
            </div>

          </div>

          {/* ── Body: fields + content scroll together, rail runs full height ── */}
          <div className="flex flex-col md:flex-row flex-1 min-h-0 overflow-y-auto md:overflow-hidden divide-y md:divide-y-0 md:divide-x divide-border/20">
            <div className="flex-1 min-w-0 md:overflow-y-auto overscroll-contain">

              {/* ── Fields ─────────────────────────────────────── */}
              <div className="border-b border-border/30 px-5 py-3 sm:px-7">
            <div className={`${FIELD_GRID} ${showEmpty ? '' : HIDE_EMPTY_FIELDS}`}>

              {/* Priority */}
              <section>
                <FieldLabel icon={AlertTriangle} label="Priority" />
                {canEdit ? (
                  <Select value={draftPriority} onValueChange={v => setDraftPriority(v as Priority)}>
                    <SelectTrigger className="w-full">
                      <div className={`flex min-w-0 items-center gap-1.5 ${priorityTextClass[displayPriority]}`}>
                        <Flag className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
                        <span className="truncate text-[13px] font-medium">{displayPriority}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {(['Urgent', 'High', 'Medium', 'Low'] as Priority[]).map(p => (
                        <SelectItem key={p} value={p}>
                          <span className={`flex items-center gap-2 ${priorityTextClass[p]}`}>
                            <Flag className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
                            <span className="text-[13px] font-medium">{p}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={`inline-flex h-7 min-w-0 items-center gap-1.5 ${priorityTextClass[displayPriority]}`}>
                    <Flag className="h-3.5 w-3.5 shrink-0" fill="currentColor" />
                    <span className="truncate text-[13px] font-medium">{displayPriority}</span>
                  </span>
                )}
              </section>

              {/* Status */}
              <section>
                <FieldLabel icon={CircleDot} label="Status" />
                {canEdit ? (
                  <Select value={draftStatus || task.status} onValueChange={setDraftStatus}>
                    <SelectTrigger className="w-full">
                      <div className={`inline-flex h-5 items-center gap-1.5 rounded-md border px-1.5 text-[12px] font-semibold ${statusCfg.style}`}>{statusLabel}</div>
                    </SelectTrigger>
                    <SelectContent>
                      {statusOptions.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className={`inline-flex h-7 items-center rounded-lg border px-2 text-[13px] font-semibold ${statusCfg.style}`}>
                    {statusLabel}
                  </span>
                )}
              </section>

              {/* Project */}
              <section>
                <FieldLabel icon={FolderOpen} label="Project" />
                {canEdit ? (
                  <Select value={draftProjectId || task.projectId} onValueChange={handleProjectChange}>
                    <SelectTrigger className="w-full">
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

              {/* Section */}
              <section data-empty={!(canEdit ? (draftSectionId || task.sectionId) : section?.name)}>
                <FieldLabel icon={Layers} label="Section" />
                {canEdit && project ? (
                  <Select
                    value={draftSectionId || task.sectionId}
                    onValueChange={setDraftSectionId}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {project.sections.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-xs text-foreground">{section?.name ?? '—'}</p>
                )}
              </section>

              {/* Sprint */}
              <section data-empty={!(canEdit ? draftSprint : task.sprint?.trim())}>
                <FieldLabel icon={Layers} label="Sprint" />
                {canEdit ? (
                  <SprintSelect value={draftSprint} onChange={setDraftSprint} projectId={draftProjectId || task.projectId} />
                ) : (
                  <div className="text-sm text-foreground">{task.sprint?.trim() || 'No sprint'}</div>
                )}
              </section>

              {/* Estimated time */}
              <section>
                <FieldLabel icon={Clock} label="Estimate" />
                {canEdit ? (
                  <HoursMinutesInput
                    value={draftEstimatedHours}
                    onChange={setDraftEstimatedHours}
                    aria-label="Estimate"
                  />
                ) : (
                  <div className="text-sm text-foreground">
                    {task.estimatedHours != null && task.estimatedHours > 0
                      ? formatHM(String(task.estimatedHours))
                      : '—'}
                  </div>
                )}
              </section>

              {/* Actual — the hours that reach the timesheet */}
              <section>
                <FieldLabel icon={Clock} label="Actual" />
                {canEdit ? (
                  <HoursMinutesInput
                    value={draftActualHours}
                    onChange={setDraftActualHours}
                    aria-label="Actual"
                  />
                ) : (
                  <div className="text-sm text-foreground">
                    {task.timeTracked > 0 ? formatHM(secondsToDecimalHours(task.timeTracked)) : '—'}
                  </div>
                )}
              </section>

              {/* Started */}
              <section data-empty={!(draftStartedAt || task.startedAt)}>
                <FieldLabel icon={Calendar} label="Started" />
                <div className="min-w-0">
                {canEdit ? (
                  <DatePickerInput
                    value={draftStartedAt}
                    onChange={setDraftStartedAt}
                    placeholder="Not started"
                    aria-label="Started"
                  />
                ) : (
                  <div className="text-sm text-foreground">
                    {draftStartedAt || task.startedAt ? formatLocalDateTime(draftStartedAt || task.startedAt || '') : '—'}
                  </div>
                )}
                </div>
              </section>

              {/* Due Date */}
              <section data-empty={!(draftDueDate || task.dueDate?.trim())}>
                <FieldLabel icon={Calendar} label="Due date" />
                <div className="flex min-w-0 items-center gap-2">
                {canEdit ? (
                  <DatePickerInput
                    value={draftDueDate}
                    onChange={setDraftDueDate}
                    placeholder="No due date"
                    aria-label="Due date"
                  />
                ) : draftDueDate || task.dueDate?.trim() ? (
                  <div className={`text-sm font-bold ${dueBucketDateTextClass(dueBucket, isDoneDue)}`}>
                    {fmtDate(draftDueDate || task.dueDate)}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No due date</div>
                )}
                {isOverdue && (
                  <div className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-500/15 bg-red-500/8 px-1.5 py-0.5 text-[11px] text-red-400/80">
                    <AlertTriangle className="h-3 w-3" /> Past due
                  </div>
                )}
                </div>
              </section>

              {/* Assignees */}
              <section>
                <FieldLabel icon={User2} label="Assignees" />
                <div className="min-w-0">
                {canEdit ? (
                  <AssigneeCell
                    assigneeIds={draftAssigneeIds}
                    members={projectMembers}
                    onChange={setDraftAssigneeIds}
                  />
                ) : assigneeUsers.length === 0 ? (
                  <p className="text-xs text-muted-foreground/40 italic">Unassigned</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {assigneeUsers.map(u => (
                      <span key={u.id} className="inline-flex items-center gap-1.5">
                        <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                        <span className="text-xs font-medium truncate">{u.name}</span>
                      </span>
                    ))}
                  </div>
                )}
                </div>
              </section>

              {/* Completed */}
              <section data-empty={!(draftCompletedAt || task.completedAt)}>
                <FieldLabel icon={Calendar} label="Completed" />
                <div className="min-w-0">
                {canEdit ? (
                  <DatePickerInput
                    value={draftCompletedAt}
                    onChange={setDraftCompletedAt}
                    placeholder="Not completed"
                    aria-label="Completed"
                  />
                ) : (
                  <div className="text-sm text-foreground">
                    {draftCompletedAt || task.completedAt ? formatLocalDateTime(draftCompletedAt || task.completedAt || '') : '—'}
                  </div>
                )}
                </div>
              </section>

              {/* Created */}
              <section>
                <FieldLabel icon={Clock} label="Created" />
                <div className="text-[11px] text-foreground/60 tabular-nums">{taskCreatedTimeline}</div>
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

              {/* Description */}
              <section>
                <FieldLabel icon={MessageSquare} label="Description" />
                {(task.dueDate || canUseTaskTimer) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 -mt-1 mb-3">
                    {task.dueDate ? (
                      <p className="text-[11px] text-muted-foreground/70 tabular-nums min-w-0 flex-1">Due {fmtDate(task.dueDate)}</p>
                    ) : (
                      <span className="flex-1 min-w-0" />
                    )}
                    {canUseTaskTimer && (
                      <div className="flex items-center gap-2 shrink-0">
                        {isTimerActive ? (
                          <>
                            <button
                              type="button"
                              className="text-sm font-semibold px-4 py-2 min-h-10 rounded-lg bg-destructive/90 text-destructive-foreground hover:bg-destructive transition-colors"
                              onClick={() => void stopTimer(task.id)}
                            >
                              Stop
                            </button>
                            {elapsed ? (
                              <span className="text-xs font-mono text-muted-foreground tabular-nums">{elapsed}</span>
                            ) : null}
                          </>
                        ) : (
                          <button
                            type="button"
                            className="text-sm font-semibold px-4 py-2 min-h-10 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            onClick={() => void startTimer(task.id)}
                          >
                            Start
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
{canEdit ? (
                  <ExpandableRichText
                    label="description"
                    value={draftDescription}
                    onChange={setDraftDescription}
                    placeholder="Add a description…"
                    className="rounded-xl border border-border/50 bg-muted/20 px-3 py-3"
                  />
                ) : task.description?.trim() ? (
                  <ExpandableRichText label="description" value={task.description} onChange={() => {}} editable={false} />
                ) : (
                  <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4 text-sm italic text-muted-foreground/40">
                    No description provided.
                  </div>
                )}
              </section>

              <WorkItemTable
                title="Subtasks"
                addLabel="Add subtask"
                items={nestedChildren}
                members={projectMembers}
                currentUserId={currentUser?.id}
                onOpen={st => window.dispatchEvent(
                  new CustomEvent('zet:open-task', { detail: { taskId: st.id } }),
                )}
                onEdit={async (st, patch) => {
                  try {
                    await updateTask(st.id, patch);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Could not update subtask');
                  }
                }}
                onDelete={async st => {
                  try {
                    await deleteTask(st.id);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Could not delete that subtask');
                  }
                }}
                onAdd={canAddSubtask ? addSubtask : undefined}
              />

              {/* ── Attachments ── */}
              <section>
                {(() => {
                  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingFile(true);
                    try {
                      const att = await api.uploadAttachment(task.id, file);
                      queryClient.setQueryData(taskKeys.attachments(task.id), (prev: TaskAttachment[] | undefined) =>
                        [...(prev ?? []), att],
                      );
                      toast.success(`${file.name} uploaded`);
                    } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
                    finally { setUploadingFile(false); e.target.value = ''; }
                  };

                  const handleDelete = async (att: TaskAttachment) => {
                    try {
                      await api.deleteAttachment(task.id, att.id);
                      queryClient.setQueryData(taskKeys.attachments(task.id), (prev: TaskAttachment[] | undefined) =>
                        (prev ?? []).filter(a => a.id !== att.id),
                      );
                      toast.success('Attachment deleted');
                    } catch { toast.error('Could not delete attachment'); }
                  };


                  return (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                          <Paperclip className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          <span>Attachments {attachments.length > 0 ? `(${attachments.length})` : ''}</span>
                        </div>
                        <label className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary/8 transition-colors font-medium cursor-pointer">
                          <Upload className="h-3 w-3" />
                          {uploadingFile ? 'Uploading…' : 'Upload'}
                          <input type="file" className="sr-only" onChange={e => void handleFileUpload(e)} disabled={uploadingFile} />
                        </label>
                      </div>

                      {attachmentsLoading ? (
                        <div className="py-4 flex justify-center">
                          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        </div>
                      ) : attachments.length === 0 ? (
                        <p className="text-xs text-muted-foreground/35 italic">No attachments yet</p>
                      ) : (
                        <div className="space-y-2">
                          {attachments.map(att => (
                            <div key={att.id} className="flex items-center gap-2.5 group rounded-xl border border-border/30 px-3 py-2.5 bg-muted/10 hover:bg-muted/25 transition-colors">
                              <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />
                              <button
                                type="button"
                                onClick={() => void setViewing(att)}
                                className="flex-1 min-w-0 text-left"
                                title="View"
                              >
                                <p className="text-xs font-medium truncate text-foreground hover:text-primary transition-colors">{att.filename}</p>
                                <p className="text-[10px] text-muted-foreground/50">{fmtSize(att.sizeBytes)} · {att.uploaderName}</p>
                              </button>
                              <button
                                onClick={() => void setViewing(att)}
                                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-all shrink-0"
                                title="View"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => void api.downloadAttachment(task.id, att.id, att.filename)}
                                className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 text-muted-foreground/50 hover:text-primary transition-all shrink-0"
                                title="Download"
                              >
                                <Download className="h-3.5 w-3.5" />
                              </button>
                              {(currentUser?.id === att.uploadedBy || isManager) && (
                                <button
                                  onClick={() => void handleDelete(att)}
                                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-600 dark:text-red-400 transition-all shrink-0"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}
              </section>

              </div>
            </div>

            {/* ── RIGHT rail: comments ────────────────────── */}
            <CommentsRail
              key={task.id}
              comments={feedbackList}
              loading={feedbackLoading}
              onPost={async (message, mentionedUserIds) => {
                const created = await api.createTaskFeedback(task.id, message, mentionedUserIds);
                queryClient.setQueryData(taskKeys.feedback(task.id), (prev: TaskFeedback[] | undefined) => [...(prev ?? []), created]);
              }}
              onEdit={async (id, message) => {
                const updated = await api.patchTaskFeedback(task.id, id, message);
                queryClient.setQueryData(taskKeys.feedback(task.id), (prev: TaskFeedback[] | undefined) =>
                  (prev ?? []).map(f => (f.id === updated.id ? updated : f)),
                );
              }}
              onDelete={async id => {
                await api.deleteTaskFeedback(task.id, id);
                queryClient.setQueryData(taskKeys.feedback(task.id), (prev: TaskFeedback[] | undefined) =>
                  (prev ?? []).filter(f => f.id !== id),
                );
              }}
              headerAction={feedbackList.length > 1 && (
                <button
                  type="button"
                  onClick={() => void summarize(true)}
                  disabled={aiSummarizing}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary transition-colors hover:text-primary/80 disabled:opacity-40"
                >
                  <Sparkles className="h-3 w-3" />
                  {aiSummarizing ? 'Summarizing…' : 'AI Summary'}
                </button>
              )}
              banner={showAiSummary && aiSummary && (
                <div className="mb-4 whitespace-pre-wrap rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-relaxed text-foreground">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                      <Sparkles className="h-3 w-3" /> AI Summary
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => void summarize(false)}
                        disabled={aiSummarizing}
                        className="flex items-center gap-1 text-[10px] font-semibold text-primary transition-colors hover:text-primary/80"
                      >
                        <RotateCcw className="h-2.5 w-2.5" />
                        Regenerate
                      </button>
                      <button onClick={() => setShowAiSummary(false)} className="text-muted-foreground transition-colors hover:text-foreground">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {aiSummary}
                </div>
              )}
            />
          </div>

        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this task?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone. All comments and time logs will be permanently lost.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={e => { e.preventDefault(); void handleDeleteTask(); }}
            >
              {deleting ? 'Deleting…' : 'Delete task'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AttachmentViewer
        attachment={viewing}
        fetchBlob={att => api.fetchAttachmentBlob(task!.id, att.id)}
        onDownload={att => void api.downloadAttachment(task!.id, att.id, att.filename)}
        onClose={() => setViewing(null)}
      />
    </>
  );
};

export default TaskDetailModal;
