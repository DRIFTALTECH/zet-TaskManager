import { useAppStore } from '@/stores/appStore';
import { Task, Priority, TaskStatus, TaskChecklist, TaskAttachment } from '@/types';
import { Dialog, DialogContent, DialogDescription } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Calendar, Tag, Clock, AlertTriangle, Plus, X, Trash2,
  FolderOpen, Layers, Mail, UserCircle, CircleDot,
  MessageSquare, Send, User2, CheckCircle2, RotateCcw, ChevronRight,
  CheckSquare, Square, Paperclip, Download, Upload, Sparkles,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { taskAssigneeIds, isTaskAssignedTo } from '@/lib/task-utils';
import UserAvatar from '@/components/UserAvatar';
import { dueBucketDateTextClass, getDueBucket } from '@/lib/due-date-utils';
import { api } from '@/lib/api';
import type { TaskFeedback } from '@/types';
import { motion, AnimatePresence } from 'framer-motion';

interface Props { task: Task | null; open: boolean; onOpenChange: (open: boolean) => void; }
type CustomFieldRow = { localId: string; key: string; value: string };

// ── Config maps ───────────────────────────────────────────────────────────────
const priorityConfig: Record<Priority, { style: string; dot: string; ring: string }> = {
  Urgent: { style: 'bg-red-500/15 text-red-400 border-red-500/30', dot: 'bg-red-400', ring: 'ring-red-400/40' },
  High:   { style: 'bg-orange-500/15 text-orange-400 border-orange-500/30', dot: 'bg-orange-400', ring: 'ring-orange-400/40' },
  Medium: { style: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', dot: 'bg-yellow-400', ring: 'ring-yellow-400/40' },
  Low:    { style: 'bg-green-500/15 text-green-400 border-green-500/30', dot: 'bg-green-400', ring: 'ring-green-400/40' },
};
const statusConfig: Record<TaskStatus, { style: string; label: string; bar: string }> = {
  backlog:     { style: 'bg-slate-500/15 text-slate-400 border-slate-500/30', label: 'Backlog',     bar: 'bg-slate-500' },
  in_progress: { style: 'bg-blue-500/15 text-blue-400 border-blue-500/30',   label: 'In Progress', bar: 'bg-blue-500' },
  in_review:   { style: 'bg-violet-500/15 text-violet-400 border-violet-500/30', label: 'In Review', bar: 'bg-violet-500' },
  done:        { style: 'bg-green-500/15 text-green-400 border-green-500/30', label: 'Done',        bar: 'bg-green-500' },
  completed:   { style: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30', label: 'Completed', bar: 'bg-emerald-500' },
};

// ── Avatar helpers ────────────────────────────────────────────────────────────
function fmtDate(d: string) {
  try { return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return d; }
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
function tsShort(iso: string) { return iso.slice(0, 16).replace('T', ' '); }
function newRow(): CustomFieldRow { return { localId: crypto.randomUUID(), key: '', value: '' }; }
function rowsFromTask(cf?: Record<string, string>): CustomFieldRow[] {
  return Object.entries(cf || {}).map(([key, value]) => ({ localId: crypto.randomUUID(), key, value }));
}
function recordFromRows(rows: CustomFieldRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) { const k = r.key.trim(); if (k) out[k] = r.value.trim(); }
  return out;
}
function sortedKey(ids: string[]) { return [...ids].sort().join('|'); }
function cfSig(cf?: Record<string, string>) {
  return JSON.stringify(Object.keys(cf || {}).sort().reduce<Record<string, string>>((a, k) => { a[k] = (cf || {})[k]; return a; }, {}));
}

function useElapsedTime(epochStart: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!epochStart) return;
    const id = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(id);
  }, [epochStart]);
  if (!epochStart) return '';
  const secs = Math.max(0, Math.floor((Date.now() - epochStart) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SectionLabel({ icon: Icon, label, accent = 'text-muted-foreground/60' }: { icon: React.ElementType; label: string; accent?: string }) {
  return (
    <div className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] mb-3 ${accent}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{label}</span>
    </div>
  );
}

function Avatar({ name, avatar, size = 'md' }: { name: string; avatar?: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap: Record<string, 'sm' | 'md' | 'lg'> = { sm: 'sm', md: 'md', lg: 'lg' };
  return <UserAvatar name={name} avatar={avatar} size={sizeMap[size]} />;
}

// ═══════════════════════════════════════════════════════════════════════════════
const TaskDetailModal = ({ task, open, onOpenChange }: Props) => {
  const {
    users, projects, kanbanColumns, updateTask, currentUser, deleteTask, reopenTaskToBacklog,
    activeTimers, startTimer, stopTimer,
  } = useAppStore();

  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftPriority, setDraftPriority] = useState<Priority>('Medium');
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>([]);
  const [draftCustomRows, setDraftCustomRows] = useState<CustomFieldRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [feedbackList, setFeedbackList] = useState<TaskFeedback[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [newFeedbackText, setNewFeedbackText] = useState('');
  const [postingFeedback, setPostingFeedback] = useState(false);
  const [editingFeedbackId, setEditingFeedbackId] = useState<string | null>(null);
  const [editingFeedbackText, setEditingFeedbackText] = useState('');

  // @mention state
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStartPos, setMentionStartPos] = useState(0);
  const [mentionDropdownIdx, setMentionDropdownIdx] = useState(0);
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummarizing, setAiSummarizing] = useState(false);

  // ── Checklists ──────────────────────────────────────────────────────────────
  const [checklists, setChecklists] = useState<TaskChecklist[]>([]);
  const [checklistsLoading, setChecklistsLoading] = useState(false);
  const [newCheckTitle, setNewCheckTitle] = useState('');
  const [newCheckPriority, setNewCheckPriority] = useState<string>('Medium');
  const [addingCheck, setAddingCheck] = useState(false);
  const [showCheckForm, setShowCheckForm] = useState(false);

  // ── Attachments ─────────────────────────────────────────────────────────────
  const [attachments, setAttachments] = useState<TaskAttachment[]>([]);
  const [attachmentsLoading, setAttachmentsLoading] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'admin';
  const isCompleted = task?.status === 'completed';
  const canReopenToBacklog = Boolean(
    currentUser && task && isCompleted &&
    (currentUser.id === task.createdBy || isTaskAssignedTo(task, currentUser.id) || isManager),
  );
  const canEditTaskFields = Boolean(currentUser && task && !isCompleted && currentUser.id === task.createdBy);
  // Rescheduling (due date) is allowed for the creator, any assignee, or a manager/admin.
  const canReschedule = Boolean(
    currentUser && task && !isCompleted &&
    (currentUser.id === task.createdBy || isTaskAssignedTo(task, currentUser.id) || isManager),
  );
  const canManageAssignees = Boolean(task && !isCompleted && projects.some(p => p.id === task?.projectId));
  const canDeleteTask = Boolean(currentUser && task && currentUser.id === task.createdBy);
  const assigneeKey = task ? sortedKey(taskAssigneeIds(task)) : '';

  const resetDraft = useCallback((t: Task) => {
    setDraftTitle(t.title);
    setDraftDescription(t.description ?? '');
    setDraftPriority(t.priority);
    setDraftAssigneeIds([...taskAssigneeIds(t)]);
    setDraftCustomRows(rowsFromTask(t.customFields));
  }, []);

  const loadFeedback = useCallback(async () => {
    if (!task?.id) return;
    setFeedbackLoading(true);
    try { setFeedbackList(await api.listTaskFeedback(task.id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load feedback'); }
    finally { setFeedbackLoading(false); }
  }, [task?.id]);

  const loadChecklists = useCallback(async () => {
    if (!task?.id) return;
    setChecklistsLoading(true);
    try { setChecklists(await api.getChecklists(task.id)); }
    catch { /* silently ignore */ }
    finally { setChecklistsLoading(false); }
  }, [task?.id]);

  const loadAttachments = useCallback(async () => {
    if (!task?.id) return;
    setAttachmentsLoading(true);
    try { setAttachments(await api.getAttachments(task.id)); }
    catch { /* silently ignore */ }
    finally { setAttachmentsLoading(false); }
  }, [task?.id]);

  useEffect(() => { if (task && open) resetDraft(task); }, [open, task?.id, assigneeKey, resetDraft]);
  useEffect(() => {
    if (!open || !task?.id) return;
    void loadFeedback();
    void loadChecklists();
    void loadAttachments();
    setNewFeedbackText(''); setEditingFeedbackId(null); setEditingFeedbackText('');
    setShowCheckForm(false); setNewCheckTitle(''); setNewCheckPriority('Medium');
  }, [open, task?.id, loadFeedback, loadChecklists, loadAttachments]);

  const isDirty = useMemo(() => {
    if (!task) return false;
    const cfMatch = cfSig(recordFromRows(draftCustomRows)) === cfSig(task.customFields);
    const contentDirty = canEditTaskFields && (
      draftTitle !== task.title || draftDescription !== (task.description ?? '') ||
      draftPriority !== task.priority || !cfMatch
    );
    const assigneeDirty = canManageAssignees && sortedKey(draftAssigneeIds) !== sortedKey(taskAssigneeIds(task));
    return contentDirty || assigneeDirty;
  }, [task, draftTitle, draftDescription, draftPriority, draftAssigneeIds, draftCustomRows, canEditTaskFields, canManageAssignees]);

  const timerEpochStart = task ? (activeTimers[task.id] ?? null) : null;
  const elapsed = useElapsedTime(timerEpochStart);
  const isTimerActive = !!timerEpochStart;
  const canUseTaskTimer = Boolean(
    task && currentUser && isTaskAssignedTo(task, currentUser.id) &&
    task.status !== 'completed' && task.status !== 'done',
  );

  // @mention candidates — must be before early return to satisfy Rules of Hooks
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return users.filter(u => u.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, users]);

  if (!task) return null;

  const project = projects.find(p => p.id === task.projectId);
  const section = project?.sections.find(s => s.id === task.sectionId);
  const assigner = users.find(u => u.id === task.assignedBy);
  const creator = users.find(u => u.id === task.createdBy);
  const projectMembers = project
    ? users.filter(u => project.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [];
  const assigneeUsers = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;
  const isDoneDue = task.status === 'completed' || task.status === 'done';
  const dueBucket = getDueBucket(task.dueDate);
  const isOverdue = dueBucket === 'overdue' && !isDoneDue;
  const taskRef = `TF-${task.id.replace(/\D/g, '').padStart(3, '0')}`;
  const displayPriority = canEditTaskFields ? draftPriority : task.priority;
  const statusCfg = statusConfig[task.status] ?? statusConfig.backlog;
  // Resolve the display label from kanban columns so custom columns show their real name
  const statusLabel = kanbanColumns.find(c => c.id === task.status)?.label ?? statusCfg.label;
  const priCfg = priorityConfig[displayPriority] ?? priorityConfig.Medium;
  const taskCreatedTimeline = fmtTaskCreatedTimeline(task.createdAt);

  const toggleAssignee = (uid: string) => setDraftAssigneeIds(prev =>
    prev.includes(uid) ? prev.filter(id => id !== uid) : [...prev, uid]);

  const saveAll = async () => {
    const title = draftTitle.trim();
    if (canEditTaskFields && !title) { toast.error('Title is required'); return; }
    const ids = [...new Set(draftAssigneeIds)];
    if (canManageAssignees && ids.length === 0) { toast.error('At least one assignee is required'); return; }
    setSaving(true);
    try {
      const patch: Parameters<typeof updateTask>[1] = {};
      if (canEditTaskFields) { patch.title = title; patch.description = draftDescription; patch.priority = draftPriority; patch.customFields = recordFromRows(draftCustomRows); }
      if (canManageAssignees) patch.assigneeIds = ids;
      if (Object.keys(patch).length === 0) { setSaving(false); return; }
      await updateTask(task.id, patch);
      toast.success('Task saved');
      onOpenChange(false);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save task'); }
    finally { setSaving(false); }
  };

  const changeDueDate = async (newDate: string) => {
    if (!task || !newDate || newDate === task.dueDate?.slice(0, 10)) return;
    try {
      await updateTask(task.id, { dueDate: newDate });
      toast.success('Due date updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update due date');
    }
  };

  const postFeedback = async () => {
    if (!newFeedbackText.trim()) return;
    setPostingFeedback(true);
    try {
      const created = await api.createTaskFeedback(task.id, newFeedbackText.trim(), mentionedUserIds);
      setFeedbackList(prev => [...prev, created]);
      setNewFeedbackText('');
      setMentionedUserIds([]);
      setMentionQuery(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not post feedback'); }
    finally { setPostingFeedback(false); }
  };

  const handleCommentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setNewFeedbackText(val);
    const pos = e.target.selectionStart ?? val.length;
    // Find last @ before cursor that hasn't been closed by a space
    const textBefore = val.slice(0, pos);
    const match = textBefore.match(/@([^\s@]*)$/);
    if (match) {
      setMentionQuery(match[1]);
      setMentionStartPos(textBefore.length - match[0].length);
      setMentionDropdownIdx(0);
    } else {
      setMentionQuery(null);
    }
  };

  const handleCommentKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionQuery !== null && mentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setMentionDropdownIdx(i => (i + 1) % mentionCandidates.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setMentionDropdownIdx(i => (i - 1 + mentionCandidates.length) % mentionCandidates.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertMention(mentionCandidates[mentionDropdownIdx]);
        return;
      }
      if (e.key === 'Escape') { setMentionQuery(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
      e.preventDefault();
      void postFeedback();
    }
  };

  const insertMention = (user: typeof users[number]) => {
    const before = newFeedbackText.slice(0, mentionStartPos);
    const after = newFeedbackText.slice(mentionStartPos + 1 + (mentionQuery?.length ?? 0));
    const newText = `${before}@${user.name} ${after}`;
    setNewFeedbackText(newText);
    setMentionedUserIds(prev => prev.includes(user.id) ? prev : [...prev, user.id]);
    setMentionQuery(null);
    // Restore focus + cursor after name
    requestAnimationFrame(() => {
      if (commentTextareaRef.current) {
        const pos = before.length + user.name.length + 2; // +2 for "@ " + space
        commentTextareaRef.current.focus();
        commentTextareaRef.current.setSelectionRange(pos, pos);
      }
    });
  };

  const saveFeedbackEdit = async () => {
    if (!editingFeedbackId || !editingFeedbackText.trim()) return;
    try {
      const updated = await api.patchTaskFeedback(task.id, editingFeedbackId, editingFeedbackText.trim());
      setFeedbackList(prev => prev.map(f => f.id === updated.id ? updated : f));
      setEditingFeedbackId(null); setEditingFeedbackText('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not update feedback'); }
  };

  const deleteFeedback = async (id: string) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await api.deleteTaskFeedback(task.id, id);
      setFeedbackList(prev => prev.filter(f => f.id !== id));
      if (editingFeedbackId === id) { setEditingFeedbackId(null); setEditingFeedbackText(''); }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete feedback'); }
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

  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty && !window.confirm('You have unsaved changes. Close without saving?')) return;
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-[1060px] flex max-h-[min(92dvh,92vh)] min-h-0 flex-col gap-0 overflow-hidden border-border/30 bg-card p-0 rounded-2xl shadow-2xl">
          <DialogDescription className="sr-only">Task details for {task.title}</DialogDescription>

          {/* ── Header ────────────────────────────────────────────── */}
          <div className="shrink-0 px-7 pt-5 pb-4 border-b border-border/30 bg-gradient-to-b from-muted/30 to-transparent">

            {/* Breadcrumb */}
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/50 mb-4 flex-wrap pr-10">
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
                {canEditTaskFields ? (
                  <textarea
                    value={draftTitle}
                    onChange={e => setDraftTitle(e.target.value)}
                    rows={3}
                    className="w-full text-[22px] font-bold bg-muted/40 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:bg-muted/60 placeholder:text-muted-foreground/30 border border-transparent focus:border-primary/20 transition-all leading-snug resize-y min-h-[2.85rem] max-h-[12rem] whitespace-pre-wrap break-words"
                    placeholder="Task title"
                  />
                ) : (
                  <h2 className="text-[22px] font-bold text-foreground leading-snug break-words whitespace-normal">
                    {task.title}
                  </h2>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1 shrink-0">
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
                {canDeleteTask && (
                  <button
                    onClick={() => setDeleteConfirmOpen(true)}
                    className="p-2.5 rounded-xl hover:bg-red-500/10 text-muted-foreground/30 hover:text-red-400 transition-all duration-150 group"
                    title="Delete task"
                  >
                    <Trash2 className="h-4 w-4 group-hover:scale-110 transition-transform" />
                  </button>
                )}
              </div>
            </div>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mt-4">
              <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border ${statusCfg.style}`}>
                {statusLabel}
              </span>
              <span className={`text-[11px] px-3 py-1 rounded-full font-semibold border flex items-center gap-1.5 ${priCfg.style}`}>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${priCfg.dot}`} />
                {displayPriority}
              </span>
              {task.isStarted && (
                <span title="Started" className="w-6 h-6 rounded-full font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 inline-flex items-center justify-center">
                  <CircleDot className="h-3 w-3" />
                </span>
              )}
              {task.approvedByManager && (
                <span title="Approved" className="w-6 h-6 rounded-full font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center justify-center">
                  <CheckCircle2 className="h-3 w-3" />
                </span>
              )}
              {isOverdue && (
                <span title="Overdue" className="w-6 h-6 rounded-full font-semibold bg-red-500/15 text-red-400 border border-red-500/20 inline-flex items-center justify-center">
                  <AlertTriangle className="h-3 w-3" />
                </span>
              )}
            </div>
          </div>

          {/* ── Body ──────────────────────────────────────────────── */}
          <div className="flex flex-1 min-h-0 divide-x divide-border/20">

            {/* ── LEFT pane ─────────────────────────────────────── */}
            <div className="flex-1 min-w-0 overflow-y-auto overscroll-contain p-7 space-y-7">

              {/* Description */}
              <section>
                <SectionLabel icon={MessageSquare} label="Description" accent="text-blue-400/70" />
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
                {canEditTaskFields ? (
                  <textarea
                    value={draftDescription}
                    onChange={e => setDraftDescription(e.target.value)}
                    placeholder="Add a description…"
                    rows={5}
                    className="w-full rounded-xl border border-border/50 bg-muted/20 px-4 py-3.5 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 resize-none transition-all placeholder:text-muted-foreground/35"
                  />
                ) : (
                  <div className="rounded-xl border border-border/30 bg-muted/10 px-4 py-4 text-sm leading-relaxed text-foreground min-h-[88px] whitespace-pre-wrap">
                    {task.description?.trim()
                      ? task.description
                      : <span className="text-muted-foreground/40 italic">No description provided.</span>
                    }
                  </div>
                )}
              </section>

              {/* Manage Assignees (manager only) */}
              {canManageAssignees && (
                <section>
                  <SectionLabel icon={User2} label="Manage Assignees" accent="text-violet-400/70" />
                  <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/25 bg-card max-h-[280px] overflow-y-auto">
                    {projectMembers.map(u => (
                      <label
                        key={u.id}
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-primary/5 transition-colors group"
                      >
                        <Checkbox checked={draftAssigneeIds.includes(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
                        <Avatar name={u.name} avatar={u.avatar} size="sm" />
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

              {/* Custom Fields */}
              {(canEditTaskFields || Object.keys(task.customFields || {}).length > 0) && (
                <section>
                  <SectionLabel icon={Plus} label="Custom Fields" accent="text-amber-400/70" />
                  {canEditTaskFields ? (
                    <div className="space-y-2.5">
                      {draftCustomRows.map(row => (
                        <div key={row.localId} className="flex items-center gap-2">
                          <input
                            value={row.key}
                            onChange={e => setDraftCustomRows(prev => prev.map(r => r.localId === row.localId ? { ...r, key: e.target.value } : r))}
                            placeholder="Field name"
                            className="flex-1 min-w-0 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-muted-foreground/35"
                          />
                          <input
                            value={row.value}
                            onChange={e => setDraftCustomRows(prev => prev.map(r => r.localId === row.localId ? { ...r, value: e.target.value } : r))}
                            placeholder="Value"
                            className="flex-[2] min-w-0 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all placeholder:text-muted-foreground/35"
                          />
                          <button
                            onClick={() => setDraftCustomRows(prev => prev.filter(r => r.localId !== row.localId))}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400 transition-colors"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => setDraftCustomRows(prev => [...prev, newRow()])}
                        className="mt-1 text-sm text-primary/60 hover:text-primary flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-primary/8 transition-colors font-medium"
                      >
                        <Plus className="h-3.5 w-3.5" /> Add field
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {Object.entries(task.customFields || {}).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-3 text-sm rounded-xl border border-border/30 px-4 py-2.5 bg-muted/10 hover:bg-muted/20 transition-colors">
                          <span className="font-semibold text-muted-foreground shrink-0 w-28 truncate">{key}</span>
                          <span className="w-px h-3.5 bg-border/40 shrink-0" />
                          <span className="text-foreground flex-1 break-words">{value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* ── Checklists ── */}
              <section>
                {(() => {
                  const done = checklists.filter(c => c.isDone).length;
                  const total = checklists.length;
                  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

                  const addChecklist = async () => {
                    if (!newCheckTitle.trim()) return;
                    setAddingCheck(true);
                    try {
                      const item = await api.createChecklist(task.id, newCheckTitle.trim(), newCheckPriority);
                      setChecklists(prev => [...prev, item]);
                      setNewCheckTitle(''); setNewCheckPriority('Medium'); setShowCheckForm(false);
                    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add item'); }
                    finally { setAddingCheck(false); }
                  };

                  const toggleCheck = async (item: TaskChecklist) => {
                    try {
                      const updated = await api.patchChecklist(task.id, item.id, { isDone: !item.isDone });
                      setChecklists(prev => prev.map(c => c.id === updated.id ? updated : c));
                    } catch { toast.error('Could not update item'); }
                  };

                  const deleteCheck = async (itemId: string) => {
                    try {
                      await api.deleteChecklist(task.id, itemId);
                      setChecklists(prev => prev.filter(c => c.id !== itemId));
                    } catch { toast.error('Could not delete item'); }
                  };

                  return (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                          <CheckSquare className="h-3.5 w-3.5 shrink-0" />
                          <span>Checklist {total > 0 ? `(${done}/${total})` : ''}</span>
                        </div>
                        <button
                          onClick={() => setShowCheckForm(v => !v)}
                          className="text-[11px] text-primary/60 hover:text-primary flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary/8 transition-colors font-medium"
                        >
                          <Plus className="h-3 w-3" /> Add
                        </button>
                      </div>

                      {total > 0 && (
                        <div className="mb-3">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground/50 mb-1">
                            <span>Progress</span>
                            <span className={pct === 100 ? 'text-emerald-400 font-bold' : ''}>{pct}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-emerald-500' : 'bg-primary'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {checklistsLoading ? (
                        <div className="py-4 flex justify-center">
                          <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {checklists.map(item => {
                            const pc = { Urgent: 'text-red-400', High: 'text-orange-400', Medium: 'text-yellow-400', Low: 'text-green-400' }[item.priority] ?? 'text-muted-foreground/50';
                            return (
                              <div key={item.id} className="flex items-center gap-2.5 group rounded-xl px-2 py-1.5 hover:bg-muted/30 transition-colors">
                                <button onClick={() => void toggleCheck(item)} className="shrink-0 text-muted-foreground/50 hover:text-primary transition-colors">
                                  {item.isDone
                                    ? <CheckSquare className="h-4 w-4 text-emerald-400" />
                                    : <Square className="h-4 w-4" />}
                                </button>
                                <span className={`flex-1 text-sm min-w-0 truncate ${item.isDone ? 'line-through text-muted-foreground/40' : 'text-foreground'}`}>
                                  {item.title}
                                </span>
                                <span className={`text-[10px] font-semibold shrink-0 ${pc}`}>{item.priority}</span>
                                <button
                                  onClick={() => void deleteCheck(item.id)}
                                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-all shrink-0"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {showCheckForm && (
                        <div className="mt-3 space-y-2 p-3 rounded-xl border border-border/40 bg-muted/20">
                          <input
                            autoFocus
                            value={newCheckTitle}
                            onChange={e => setNewCheckTitle(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') void addChecklist(); if (e.key === 'Escape') setShowCheckForm(false); }}
                            placeholder="Item title…"
                            className="w-full bg-transparent text-sm border border-border/40 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-muted-foreground/35"
                          />
                          <div className="flex items-center gap-2">
                            <select
                              value={newCheckPriority}
                              onChange={e => setNewCheckPriority(e.target.value)}
                              className="text-xs flex-1 border border-border/40 rounded-lg px-2 py-1.5 bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
                            >
                              {['Low', 'Medium', 'High', 'Urgent'].map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                            <button
                              onClick={() => void addChecklist()}
                              disabled={addingCheck || !newCheckTitle.trim()}
                              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 font-semibold transition-all"
                            >
                              {addingCheck ? '…' : 'Add'}
                            </button>
                            <button onClick={() => setShowCheckForm(false)} className="text-xs px-3 py-1.5 rounded-lg border border-border/40 hover:bg-muted/60 transition-colors text-muted-foreground">
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}

                      {total === 0 && !showCheckForm && (
                        <p className="text-xs text-muted-foreground/35 italic">No checklist items yet</p>
                      )}
                    </>
                  );
                })()}
              </section>

              {/* ── Attachments ── */}
              <section>
                {(() => {
                  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingFile(true);
                    try {
                      const att = await api.uploadAttachment(task.id, file);
                      setAttachments(prev => [...prev, att]);
                      toast.success(`${file.name} uploaded`);
                    } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
                    finally { setUploadingFile(false); e.target.value = ''; }
                  };

                  const handleDelete = async (att: TaskAttachment) => {
                    try {
                      await api.deleteAttachment(task.id, att.id);
                      setAttachments(prev => prev.filter(a => a.id !== att.id));
                      toast.success('Attachment deleted');
                    } catch { toast.error('Could not delete attachment'); }
                  };

                  const fmtSize = (bytes: number) => {
                    if (bytes < 1024) return `${bytes} B`;
                    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
                    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
                  };

                  return (
                    <>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground/60">
                          <Paperclip className="h-3.5 w-3.5 shrink-0" />
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
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate text-foreground">{att.filename}</p>
                                <p className="text-[10px] text-muted-foreground/50">{fmtSize(att.sizeBytes)} · {att.uploaderName}</p>
                              </div>
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
                                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-all shrink-0"
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

              {/* Comments */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel
                    icon={MessageSquare}
                    label={feedbackList.length > 0 ? `Comments (${feedbackList.length})` : 'Comments'}
                    accent="text-emerald-400/70"
                  />
                  {feedbackList.length > 1 && (
                    <button
                      onClick={async () => {
                        setAiSummarizing(true);
                        setAiSummary(null);
                        try {
                          const res = await api.aiSummarizeTask(task.id);
                          setAiSummary(res.summary);
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : 'Could not summarize');
                        } finally {
                          setAiSummarizing(false);
                        }
                      }}
                      disabled={aiSummarizing}
                      className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:text-primary/80 disabled:opacity-40 transition-colors"
                    >
                      <Sparkles className="h-3 w-3" />
                      {aiSummarizing ? 'Summarizing…' : 'AI Summary'}
                    </button>
                  )}
                </div>

                {aiSummary && (
                  <div className="mb-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-foreground leading-relaxed whitespace-pre-wrap">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="flex items-center gap-1.5 text-primary font-semibold text-[11px] uppercase tracking-wide">
                        <Sparkles className="h-3 w-3" /> AI Summary
                      </span>
                      <button onClick={() => setAiSummary(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                    {aiSummary}
                  </div>
                )}

                {feedbackLoading ? (
                  <div className="flex items-center justify-center py-10 gap-2 text-sm text-muted-foreground">
                    <div className="w-4 h-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    Loading comments…
                  </div>
                ) : (
                  <div className="space-y-3 mb-5">
                    {feedbackList.length === 0 && (
                      <div className="text-center py-8 px-4 rounded-xl border border-dashed border-border/30 bg-muted/5">
                        <MessageSquare className="h-7 w-7 text-muted-foreground/20 mx-auto mb-2" />
                        <p className="text-sm text-muted-foreground/40 italic">No comments yet. Start the conversation!</p>
                      </div>
                    )}
                    <AnimatePresence initial={false}>
                      {feedbackList.map(fb => {
                        const isOwn = currentUser?.id === fb.userId;
                        return (
                          <motion.div
                            key={fb.id}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.96 }}
                            transition={{ duration: 0.15 }}
                            className={`flex gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}
                          >
                            <Avatar name={fb.authorName || '?'} avatar={users.find(u => u.id === fb.userId)?.avatar} size="sm" />
                            <div className={`flex-1 min-w-0 flex flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                              <div className={`flex items-center gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                                <span className="text-xs font-semibold text-foreground">{fb.authorName}</span>
                                <span className="text-[10px] text-muted-foreground/40 font-mono">{tsShort(fb.createdAt)}</span>
                              </div>
                              {editingFeedbackId === fb.id ? (
                                <div className="w-full space-y-2">
                                  <textarea
                                    value={editingFeedbackText}
                                    onChange={e => setEditingFeedbackText(e.target.value)}
                                    rows={3}
                                    className="w-full rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                                  />
                                  <div className="flex gap-2">
                                    <Button size="sm" onClick={() => void saveFeedbackEdit()} disabled={!editingFeedbackText.trim()}>Save</Button>
                                    <Button size="sm" variant="ghost" onClick={() => { setEditingFeedbackId(null); setEditingFeedbackText(''); }}>Cancel</Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed max-w-[88%] whitespace-pre-wrap shadow-sm ${
                                    isOwn
                                      ? 'bg-primary/12 text-foreground rounded-tr-md border border-primary/15'
                                      : 'bg-muted/50 text-foreground rounded-tl-md border border-border/30'
                                  }`}>
                                    {fb.message}
                                  </div>
                                  {isOwn && (
                                    <div className="flex gap-1 mt-0.5">
                                      <button
                                        onClick={() => { setEditingFeedbackId(fb.id); setEditingFeedbackText(fb.message); }}
                                        className="text-[11px] text-muted-foreground/50 hover:text-primary px-2 py-0.5 rounded-md hover:bg-primary/10 transition-colors"
                                      >Edit</button>
                                      <button
                                        onClick={() => void deleteFeedback(fb.id)}
                                        className="text-[11px] text-muted-foreground/50 hover:text-red-400 px-2 py-0.5 rounded-md hover:bg-red-500/10 transition-colors"
                                      >Delete</button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}

                {/* Comment input */}
                <div className="flex gap-3 items-end">
                  {currentUser && <Avatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />}
                  <div className="flex-1 relative">
                    {/* @mention dropdown */}
                    <AnimatePresence>
                      {mentionQuery !== null && mentionCandidates.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.1 }}
                          className="absolute bottom-full mb-1.5 left-0 w-56 glass border border-border/40 rounded-xl shadow-xl z-50 overflow-hidden"
                        >
                          {mentionCandidates.map((u, i) => (
                            <button
                              key={u.id}
                              onMouseDown={e => { e.preventDefault(); insertMention(u); }}
                              className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors ${
                                i === mentionDropdownIdx ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/40 text-foreground/80'
                              }`}
                            >
                              <Avatar name={u.name} avatar={u.avatar} size="sm" />
                              <div className="min-w-0">
                                <p className="font-medium truncate text-xs">{u.name}</p>
                                <p className="text-[10px] text-muted-foreground/50 capitalize">{u.role}</p>
                              </div>
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <textarea
                      ref={commentTextareaRef}
                      value={newFeedbackText}
                      onChange={handleCommentChange}
                      onKeyDown={handleCommentKeyDown}
                      placeholder="Add a comment… (@ to mention, Enter to send)"
                      rows={2}
                      className="w-full rounded-xl border border-border/40 bg-muted/20 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 resize-none pr-14 transition-all placeholder:text-muted-foreground/35 leading-relaxed"
                    />
                    <button
                      onClick={() => void postFeedback()}
                      disabled={postingFeedback || !newFeedbackText.trim()}
                      className="absolute right-2.5 bottom-2.5 p-2 rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-25 transition-all hover:scale-105 active:scale-95 shadow-sm"
                    >
                      <Send className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </section>
            </div>

            {/* ── RIGHT sidebar ─────────────────────────────────── */}
            <div className="w-[255px] shrink-0 overflow-y-auto overscroll-contain p-6 space-y-6 bg-muted/5">

              {/* Priority */}
              <section>
                <SectionLabel icon={AlertTriangle} label="Priority" accent="text-orange-400/70" />
                {canEditTaskFields ? (
                  <div className="space-y-1.5">
                    {(['Low', 'Medium', 'High', 'Urgent'] as Priority[]).map(p => (
                      <button
                        key={p}
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
                  <span className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border ${priorityConfig[task.priority].style}`}>
                    <span className={`w-2 h-2 rounded-full ${priorityConfig[task.priority].dot}`} />
                    {task.priority}
                  </span>
                )}
              </section>

              {/* Due Date */}
              <section>
                <SectionLabel icon={Calendar} label="Due Date" accent="text-cyan-400/70" />
                {canReschedule ? (
                  <input
                    type="date"
                    value={task.dueDate?.slice(0, 10) || ''}
                    onChange={e => void changeDueDate(e.target.value)}
                    className="text-sm font-semibold bg-muted/40 border border-border/50 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all [color-scheme:dark]"
                  />
                ) : (
                  <>
                    <div className={`text-sm font-bold ${dueBucketDateTextClass(dueBucket, isDoneDue)}`}>
                      {fmtDate(task.dueDate)}
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{task.dueDate}</div>
                  </>
                )}
                {!isDoneDue && dueBucket === 'today' && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 dark:text-red-300 bg-red-500/10 px-2 py-0.5 rounded-md border border-red-500/25">
                    Due today
                  </div>
                )}
                {!isDoneDue && dueBucket === 'tomorrow' && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold text-orange-600 dark:text-orange-300 bg-orange-500/10 px-2 py-0.5 rounded-md border border-orange-500/25">
                    Due tomorrow
                  </div>
                )}
                {!isDoneDue && dueBucket === 'later' && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/40 px-2 py-0.5 rounded-md border border-border/40">
                    Upcoming
                  </div>
                )}
                {isOverdue && (
                  <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-red-400/80 bg-red-500/8 px-2 py-0.5 rounded-md border border-red-500/15">
                    <AlertTriangle className="h-3 w-3" /> Past due
                  </div>
                )}
              </section>

              {/* Assignees (read-only) */}
              {!canManageAssignees && (
                <section>
                  <SectionLabel icon={User2} label="Assignees" accent="text-violet-400/70" />
                  {assigneeUsers.length === 0 ? (
                    <p className="text-xs text-muted-foreground/40 italic">Unassigned</p>
                  ) : (
                    <div className="space-y-2.5">
                      {assigneeUsers.map(u => (
                        <div key={u.id} className="flex items-center gap-2.5 group">
                          <Avatar name={u.name} avatar={u.avatar} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{u.name}</div>
                            <div className="text-[10px] text-muted-foreground/60 truncate">{u.email}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Tags */}
              {task.tags.length > 0 && (
                <section>
                  <SectionLabel icon={Tag} label="Tags" accent="text-pink-400/70" />
                  <div className="flex flex-wrap gap-1.5">
                    {task.tags.map(tag => (
                      <span key={tag} className="text-[11px] px-2.5 py-1 rounded-full border border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground hover:border-border/70 transition-colors cursor-default">{tag}</span>
                    ))}
                  </div>
                </section>
              )}

              {/* People */}
              <section>
                <SectionLabel icon={UserCircle} label="People" accent="text-indigo-400/70" />
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 group">
                    <Avatar name={creator?.name ?? '?'} avatar={creator?.avatar} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold">
                        {creator?.id === assigner?.id ? 'Created & assigned by' : 'Created by'}
                      </div>
                      <div className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{creator?.name ?? task.createdBy}</div>
                      {creator?.email && (
                        <div className="text-[10px] text-muted-foreground/50 flex items-center gap-1 truncate mt-0.5">
                          <Mail className="h-2.5 w-2.5 shrink-0" />{creator.email}
                        </div>
                      )}
                    </div>
                  </div>
                  {creator?.id !== assigner?.id && (
                    <div className="flex items-center gap-2.5 group">
                      <Avatar name={assigner?.name ?? '?'} avatar={assigner?.avatar} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold">Assigned by</div>
                        <div className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{assigner?.name ?? task.assignedBy}</div>
                        {assigner?.email && (
                          <div className="text-[10px] text-muted-foreground/50 flex items-center gap-1 truncate mt-0.5">
                            <Mail className="h-2.5 w-2.5 shrink-0" />{assigner.email}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Timeline */}
              <section>
                <SectionLabel icon={Clock} label="Timeline" accent="text-slate-400/70" />
                <div className="space-y-2.5">
                  <div>
                    <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold mb-0.5">Time tracked</div>
                    <div className="text-sm font-bold text-foreground tabular-nums">{fmtTime(task.timeTracked)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold mb-0.5">Created</div>
                    <div className="text-[11px] text-foreground/60 tabular-nums">{taskCreatedTimeline}</div>
                  </div>
                  {task.startedAt && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold mb-0.5">Started</div>
                      <div className="text-[11px] font-mono text-blue-400/70">{task.startedAt}</div>
                    </div>
                  )}
                  {task.completedAt && (
                    <div>
                      <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold mb-0.5">Completed</div>
                      <div className="text-[11px] font-mono text-emerald-400/70">{task.completedAt}</div>
                    </div>
                  )}
                </div>
              </section>
            </div>
          </div>

          {/* ── Footer ──────────────────────────────────────────── */}
          {(canEditTaskFields || canManageAssignees) && (
            <div className="shrink-0 border-t border-border/25 px-7 py-4 flex items-center gap-3 bg-gradient-to-t from-muted/20 to-transparent">
              <div className="flex items-center gap-2.5 ml-auto">
                {isDirty && (
                  <button
                    onClick={() => resetDraft(task)}
                    disabled={saving}
                    className="text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/60 hover:border-border/80 transition-all text-muted-foreground hover:text-foreground font-medium"
                  >
                    Discard
                  </button>
                )}
                <button
                  onClick={() => void saveAll()}
                  disabled={!isDirty || saving}
                  className="text-sm px-5 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-35 transition-all font-semibold shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-[0.98]"
                >
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          )}
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
    </>
  );
};

export default TaskDetailModal;
