import { useAppStore } from '@/stores/appStore';
import { Task, Priority, TaskStatus } from '@/types';
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
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { taskAssigneeIds, isTaskAssignedTo } from '@/lib/task-utils';
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
const AVATAR_PALETTES = [
  'bg-blue-500/20 text-blue-400 ring-blue-500/20',
  'bg-violet-500/20 text-violet-400 ring-violet-500/20',
  'bg-emerald-500/20 text-emerald-400 ring-emerald-500/20',
  'bg-orange-500/20 text-orange-400 ring-orange-500/20',
  'bg-pink-500/20 text-pink-400 ring-pink-500/20',
  'bg-teal-500/20 text-teal-400 ring-teal-500/20',
  'bg-amber-500/20 text-amber-400 ring-amber-500/20',
  'bg-cyan-500/20 text-cyan-400 ring-cyan-500/20',
];
function avatarPalette(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_PALETTES[h % AVATAR_PALETTES.length];
}
function getInitials(name: string) { return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2); }
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
function fmtTaskCreatedDisplay(createdAt: string): string {
  const p = parseTaskCreatedAt(createdAt);
  if (!p) return '';
  if (p.timeStr) return `Created ${p.dateStr} · ${p.timeStr}`;
  return `Created ${p.dateStr}`;
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

function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = { sm: 'w-8 h-8 text-[10px]', md: 'w-9 h-9 text-xs', lg: 'w-11 h-11 text-sm' };
  return (
    <div className={`${sizeMap[size]} rounded-full flex items-center justify-center font-bold shrink-0 ring-1 ${avatarPalette(name)}`}>
      {getInitials(name)}
    </div>
  );
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reopening, setReopening] = useState(false);

  const isManager = currentUser?.role === 'manager';
  const isCompleted = task?.status === 'completed';
  const canReopenToBacklog = Boolean(
    currentUser && task && isCompleted &&
    (currentUser.id === task.createdBy || isTaskAssignedTo(task, currentUser.id) || isManager),
  );
  const canEditTaskFields = Boolean(currentUser && task && !isCompleted && currentUser.id === task.createdBy);
  const canManageAssignees = Boolean(isManager && task && !isCompleted && projects.some(p => p.id === task?.projectId));
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

  useEffect(() => { if (task && open) resetDraft(task); }, [open, task?.id, assigneeKey, resetDraft]);
  useEffect(() => {
    if (!open || !task?.id) return;
    void loadFeedback();
    setNewFeedbackText(''); setEditingFeedbackId(null); setEditingFeedbackText('');
  }, [open, task?.id, loadFeedback]);

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
  const taskCreatedLine = fmtTaskCreatedDisplay(task.createdAt);
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

  const postFeedback = async () => {
    if (!newFeedbackText.trim()) return;
    setPostingFeedback(true);
    try {
      const created = await api.createTaskFeedback(task.id, newFeedbackText.trim());
      setFeedbackList(prev => [...prev, created]);
      setNewFeedbackText('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not post feedback'); }
    finally { setPostingFeedback(false); }
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
                <span className="text-[11px] px-3 py-1 rounded-full font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20 inline-flex items-center gap-1.5">
                  <CircleDot className="h-3 w-3" /> Started
                </span>
              )}
              {task.approvedByManager && (
                <span className="text-[11px] px-3 py-1 rounded-full font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1.5">
                  <CheckCircle2 className="h-3 w-3" /> Approved
                </span>
              )}
              {isOverdue && (
                <span className="text-[11px] px-3 py-1 rounded-full font-semibold bg-red-500/15 text-red-400 border border-red-500/20 flex items-center gap-1.5">
                  <AlertTriangle className="h-3 w-3" /> Overdue
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
                {(taskCreatedLine || canUseTaskTimer) && (
                  <div className="flex flex-wrap items-center justify-between gap-2 -mt-1 mb-3">
                    {taskCreatedLine ? (
                      <p className="text-[11px] text-muted-foreground/70 tabular-nums min-w-0 flex-1">{taskCreatedLine}</p>
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
                  <div className="rounded-xl border border-border/40 overflow-hidden divide-y divide-border/25 bg-card">
                    {projectMembers.map(u => (
                      <label
                        key={u.id}
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-primary/5 transition-colors group"
                      >
                        <Checkbox checked={draftAssigneeIds.includes(u.id)} onCheckedChange={() => toggleAssignee(u.id)} />
                        <Avatar name={u.name} size="sm" />
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

              {/* Comments */}
              <section>
                <SectionLabel
                  icon={MessageSquare}
                  label={feedbackList.length > 0 ? `Comments (${feedbackList.length})` : 'Comments'}
                  accent="text-emerald-400/70"
                />

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
                            <Avatar name={fb.authorName || '?'} size="sm" />
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
                  {currentUser && <Avatar name={currentUser.name} size="sm" />}
                  <div className="flex-1 relative">
                    <textarea
                      value={newFeedbackText}
                      onChange={e => setNewFeedbackText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void postFeedback(); } }}
                      placeholder="Add a comment… (Enter to send, Shift+Enter for newline)"
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
                <div className={`text-sm font-bold ${dueBucketDateTextClass(dueBucket, isDoneDue)}`}>
                  {fmtDate(task.dueDate)}
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{task.dueDate}</div>
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
                          <Avatar name={u.name} size="sm" />
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

              {/* Time Tracked */}
              <section>
                <SectionLabel icon={Clock} label="Time Tracked" accent="text-teal-400/70" />
                <div className="text-xl font-bold text-foreground tracking-tight">{fmtTime(task.timeTracked)}</div>
                <div className="text-[10px] text-muted-foreground/50 mt-0.5">Total across all assignees</div>
              </section>

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
                    <Avatar name={creator?.name ?? '?'} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] text-muted-foreground/50 uppercase tracking-wide font-semibold">Created by</div>
                      <div className="text-xs font-semibold truncate group-hover:text-primary transition-colors">{creator?.name ?? task.createdBy}</div>
                      {creator?.email && (
                        <div className="text-[10px] text-muted-foreground/50 flex items-center gap-1 truncate mt-0.5">
                          <Mail className="h-2.5 w-2.5 shrink-0" />{creator.email}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 group">
                    <Avatar name={assigner?.name ?? '?'} size="sm" />
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
                </div>
              </section>

              {/* Timeline */}
              <section>
                <SectionLabel icon={Clock} label="Timeline" accent="text-slate-400/70" />
                <div className="space-y-2.5">
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
