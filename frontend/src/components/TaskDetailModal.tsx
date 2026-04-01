import { useAppStore } from '@/stores/appStore';
import { Task, Priority, TaskStatus } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import {
  Calendar,
  Tag,
  User,
  Clock,
  AlertTriangle,
  Plus,
  X,
  Trash2,
  FolderOpen,
  Layers,
  Mail,
  UserCircle,
  CheckCircle2,
  CircleDot,
  MessageSquareText,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { taskAssigneeIds } from '@/lib/task-utils';
import { api } from '@/lib/api';
import type { TaskFeedback } from '@/types';

interface Props {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type CustomFieldRow = { localId: string; key: string; value: string };

const priorityColors: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

const statusColors: Record<TaskStatus, string> = {
  backlog: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/15 text-blue-400',
  in_review: 'bg-purple-500/15 text-purple-400',
  done: 'bg-green-500/15 text-green-400',
  completed: 'bg-green-500/15 text-green-400',
};

const statusLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  completed: 'Completed',
};

function newRow(): CustomFieldRow {
  return { localId: crypto.randomUUID(), key: '', value: '' };
}

function rowsFromTask(customFields: Record<string, string> | undefined): CustomFieldRow[] {
  const entries = Object.entries(customFields || {});
  if (entries.length === 0) return [];
  return entries.map(([key, value]) => ({
    localId: crypto.randomUUID(),
    key,
    value,
  }));
}

function recordFromRows(rows: CustomFieldRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (k) out[k] = r.value.trim();
  }
  return out;
}

function sortedAssigneeKey(ids: string[]) {
  return [...ids].sort().join('|');
}

function customFieldsSignature(cf: Record<string, string> | undefined): string {
  const o = cf || {};
  return JSON.stringify(
    Object.keys(o)
      .sort()
      .reduce<Record<string, string>>((acc, k) => {
        acc[k] = o[k];
        return acc;
      }, {}),
  );
}

const TaskDetailModal = ({ task, open, onOpenChange }: Props) => {
  const { users, projects, updateTask, currentUser, approveTask, deleteTask } = useAppStore();
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
  const [approvingCompletion, setApprovingCompletion] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const isManager = currentUser?.role === 'manager';
  const isCompleted = task?.status === 'completed';
  const canEditTaskFields = Boolean(
    currentUser && task && !isCompleted && currentUser.id === task.createdBy,
  );
  const canManageAssignees = Boolean(
    isManager && task && !isCompleted && projects.some(p => p.id === task.projectId),
  );
  const canDeleteTask = Boolean(currentUser && task && currentUser.id === task.createdBy);

  const assigneeKey = task ? sortedAssigneeKey(taskAssigneeIds(task)) : '';

  const resetDraftFromTask = useCallback((t: Task) => {
    setDraftTitle(t.title);
    setDraftDescription(t.description ?? '');
    setDraftPriority(t.priority);
    setDraftAssigneeIds([...taskAssigneeIds(t)]);
    setDraftCustomRows(rowsFromTask(t.customFields));
  }, []);

  const loadFeedback = useCallback(async () => {
    if (!task?.id) return;
    setFeedbackLoading(true);
    try {
      const list = await api.listTaskFeedback(task.id);
      setFeedbackList(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load feedback');
    } finally {
      setFeedbackLoading(false);
    }
  }, [task?.id]);

  useEffect(() => {
    if (!task || !open) return;
    resetDraftFromTask(task);
  }, [open, task?.id, assigneeKey, resetDraftFromTask]);

  useEffect(() => {
    if (!open || !task?.id) return;
    void loadFeedback();
    setNewFeedbackText('');
    setEditingFeedbackId(null);
    setEditingFeedbackText('');
  }, [open, task?.id, loadFeedback]);

  const isDirty = useMemo(() => {
    if (!task) return false;
    const assigneesMatch = sortedAssigneeKey(draftAssigneeIds) === sortedAssigneeKey(taskAssigneeIds(task));
    const cfMatch =
      customFieldsSignature(recordFromRows(draftCustomRows)) === customFieldsSignature(task.customFields);
    const contentDirty =
      canEditTaskFields &&
      (draftTitle !== task.title ||
        draftDescription !== (task.description ?? '') ||
        draftPriority !== task.priority ||
        !cfMatch);
    const assigneeDirty = canManageAssignees && !assigneesMatch;
    return contentDirty || assigneeDirty;
  }, [
    task,
    draftTitle,
    draftDescription,
    draftPriority,
    draftAssigneeIds,
    draftCustomRows,
    canEditTaskFields,
    canManageAssignees,
  ]);

  const displayPriority = canEditTaskFields ? draftPriority : task?.priority ?? 'Medium';

  if (!task) return null;

  const project = projects.find(p => p.id === task.projectId);
  const section = project?.sections.find(s => s.id === task.sectionId);
  const assigner = users.find(u => u.id === task.assignedBy);
  const creator = users.find(u => u.id === task.createdBy);
  const projectMembers = project
    ? users.filter(u => project.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  const assigneeUsers = taskAssigneeIds(task).map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users;

  const saveAll = async () => {
    if (!task) return;
    const title = draftTitle.trim();
    if (canEditTaskFields && !title) {
      toast.error('Title is required');
      return;
    }
    const ids = [...new Set(draftAssigneeIds)];
    if (canManageAssignees && ids.length === 0) {
      toast.error('At least one assignee is required');
      return;
    }
    setSaving(true);
    try {
      const patch: Parameters<typeof updateTask>[1] = {};
      if (canEditTaskFields) {
        patch.title = title;
        patch.description = draftDescription;
        patch.priority = draftPriority;
        patch.customFields = recordFromRows(draftCustomRows);
      }
      if (canManageAssignees) {
        patch.assigneeIds = ids;
      }
      if (Object.keys(patch).length === 0) {
        setSaving(false);
        return;
      }
      await updateTask(task.id, patch);
      toast.success('Task saved');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save task');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    resetDraftFromTask(task);
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const formatLongDate = (d: string) => {
    try {
      return new Date(d + 'T12:00:00').toLocaleDateString(undefined, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return d;
    }
  };

  const isOverdue = new Date(task.dueDate) < new Date() && task.status !== 'completed';

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

  const toggleAssigneeDraft = (userId: string) => {
    setDraftAssigneeIds(prev => {
      const i = prev.indexOf(userId);
      if (i >= 0) return prev.filter(id => id !== userId);
      return [...prev, userId];
    });
  };

  const updateCustomRow = (localId: string, field: 'key' | 'value', value: string) => {
    setDraftCustomRows(prev => prev.map(r => (r.localId === localId ? { ...r, [field]: value } : r)));
  };

  const removeCustomRow = (localId: string) => {
    setDraftCustomRows(prev => prev.filter(r => r.localId !== localId));
  };

  const addCustomFieldRow = () => {
    setDraftCustomRows(prev => [...prev, newRow()]);
  };

  const postFeedback = async () => {
    if (!task || !newFeedbackText.trim()) return;
    setPostingFeedback(true);
    try {
      const created = await api.createTaskFeedback(task.id, newFeedbackText.trim());
      setFeedbackList(prev => [...prev, created]);
      setNewFeedbackText('');
      toast.success('Feedback posted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not post feedback');
    } finally {
      setPostingFeedback(false);
    }
  };

  const saveFeedbackEdit = async () => {
    if (!task || !editingFeedbackId || !editingFeedbackText.trim()) return;
    try {
      const updated = await api.patchTaskFeedback(task.id, editingFeedbackId, editingFeedbackText.trim());
      setFeedbackList(prev => prev.map(f => (f.id === updated.id ? updated : f)));
      setEditingFeedbackId(null);
      setEditingFeedbackText('');
      toast.success('Feedback updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update feedback');
    }
  };

  const deleteFeedback = async (id: string) => {
    if (!task || !window.confirm('Delete this feedback?')) return;
    try {
      await api.deleteTaskFeedback(task.id, id);
      setFeedbackList(prev => prev.filter(f => f.id !== id));
      if (editingFeedbackId === id) {
        setEditingFeedbackId(null);
        setEditingFeedbackText('');
      }
      toast.success('Feedback deleted');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete feedback');
    }
  };

  const taskRef = `TF-${task.id.replace(/\D/g, '').padStart(3, '0')}`;

  const handleOpenChange = (next: boolean) => {
    if (!next && isDirty) {
      const ok = window.confirm('You have unsaved changes. Close without saving?');
      if (!ok) return;
    }
    onOpenChange(next);
  };

  const showTaskActionsFooter = canEditTaskFields || canManageAssignees;

  const handleDeleteTask = async () => {
    if (!task) return;
    setDeleting(true);
    try {
      await deleteTask(task.id);
      toast.success('Task deleted');
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete task');
    } finally {
      setDeleting(false);
    }
  };

  const handleApproveCompletion = async () => {
    if (!task) return;
    setApprovingCompletion(true);
    try {
      await approveTask(task.id);
      toast.success('Task approved');
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setApprovingCompletion(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl flex max-h-[min(90dvh,92vh)] min-h-0 flex-col gap-0 overflow-hidden border-border/80 bg-card p-0">
        <DialogHeader className="shrink-0 px-6 pt-2 pb-4 border-b border-border/60 text-left space-y-2">
          <div className="flex items-center flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FolderOpen className="h-3.5 w-3.5" />
              {project?.name ?? 'Unknown project'}
            </span>
            <span className="text-border">/</span>
            <span className="inline-flex items-center gap-1">
              <Layers className="h-3.5 w-3.5" />
              {section?.name ?? 'Section'}
            </span>
            <span className="text-border">/</span>
            <span className="font-mono text-foreground/80">{taskRef}</span>
          </div>
          <div className="flex items-start justify-between gap-3 pr-10">
            <DialogTitle className="text-xl font-semibold leading-tight flex-1 min-w-0">
              {canEditTaskFields ? (
                <input
                  value={draftTitle}
                  onChange={e => setDraftTitle(e.target.value)}
                  className="w-full bg-muted/50 rounded-lg px-3 py-2 text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder="Task title"
                />
              ) : (
                <span className="block px-1">{task.title}</span>
              )}
            </DialogTitle>
            {canDeleteTask && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
              </Button>
            )}
          </div>
          {canEditTaskFields ? (
            <DialogDescription className="text-sm text-muted-foreground">
              Edit below; changes apply in this window. Click <strong className="text-foreground font-medium">Save changes</strong> to persist, then the dialog closes.
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">Task details</DialogDescription>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[task.status] ?? 'bg-muted'}`}>
              {statusLabels[task.status] ?? task.status}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${priorityColors[displayPriority]}`}>
              {displayPriority} priority
            </span>
            {task.isStarted && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 inline-flex items-center gap-1">
                <CircleDot className="h-3 w-3" /> Work started
              </span>
            )}
            {task.approvedByManager && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-green-500/10 text-green-400 border border-green-500/20 inline-flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Manager approved
              </span>
            )}
            {isOverdue && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-500/15 text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-6">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Description</h3>
            {canEditTaskFields ? (
              <textarea
                value={draftDescription}
                onChange={e => setDraftDescription(e.target.value)}
                placeholder="Add a description…"
                className="w-full min-h-[120px] rounded-xl border border-border/80 bg-muted/20 px-3 py-3 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            ) : (
              <div className="rounded-xl border border-border/60 bg-muted/10 px-4 py-3 text-sm leading-relaxed text-foreground min-h-[80px] whitespace-pre-wrap">
                {task.description?.trim() ? task.description : <span className="text-muted-foreground italic">No description</span>}
              </div>
            )}
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Task details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border/60 p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" /> Due date
                </div>
                <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : 'text-foreground'}`}>{formatLongDate(task.dueDate)}</p>
                <p className="text-xs text-muted-foreground font-mono">{task.dueDate}</p>
              </div>
              <div className="rounded-xl border border-border/60 p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" /> Time tracked (task total)
                </div>
                <p className="text-sm font-medium">{formatTime(task.timeTracked)}</p>
                <p className="text-xs text-muted-foreground">Sum of all assignees&apos; logged time</p>
              </div>
              <div className="rounded-xl border border-border/60 p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserCircle className="h-3.5 w-3.5" /> Assigned by
                </div>
                <p className="text-sm font-medium">{assigner?.name ?? task.assignedBy}</p>
                {assigner?.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" />{assigner.email}</p>}
              </div>
              <div className="rounded-xl border border-border/60 p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <User className="h-3.5 w-3.5" /> Created by
                </div>
                <p className="text-sm font-medium">{creator?.name ?? task.createdBy}</p>
                {creator?.email && <p className="text-xs text-muted-foreground flex items-center gap-1"><Mail className="h-3 w-3 shrink-0" />{creator.email}</p>}
              </div>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Assigned to</h3>
            {!canManageAssignees && (
              <div className="flex flex-wrap gap-2 mb-3">
                {assigneeUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No assignees</p>
                ) : (
                  assigneeUsers.map(u => (
                    <div
                      key={u.id}
                      className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/10 px-3 py-2"
                    >
                      <div className="w-8 h-8 rounded-full bg-primary/15 flex items-center justify-center text-xs font-bold text-primary">
                        {getInitials(u.name)}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{u.name}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
            {canManageAssignees && project && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Choose everyone responsible for this task. They must be project members.</p>
                <div className="rounded-xl border border-border/60 divide-y divide-border/50 max-h-[220px] overflow-y-auto bg-muted/5">
                  {projectMembers.map(u => (
                    <label
                      key={u.id}
                      className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/30 transition-colors duration-100"
                    >
                      <Checkbox
                        checked={draftAssigneeIds.includes(u.id)}
                        onCheckedChange={() => toggleAssigneeDraft(u.id)}
                      />
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold shrink-0">
                        {getInitials(u.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{u.name}</div>
                        <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          {task.tags.length > 0 && (
            <>
              <Separator />
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" /> Tags
                </h3>
                <div className="flex gap-1.5 flex-wrap">
                  {task.tags.map(tag => (
                    <span key={tag} className="text-xs px-2.5 py-1 rounded-full border bg-muted/40">
                      {tag}
                    </span>
                  ))}
                </div>
              </section>
            </>
          )}

          <Separator />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Timeline</h3>
            <ul className="text-sm text-muted-foreground space-y-1.5">
              <li>Created <span className="text-foreground font-mono text-xs">{task.createdAt}</span></li>
              {task.startedAt && <li>Started <span className="text-foreground font-mono text-xs">{task.startedAt}</span></li>}
              {task.completedAt && <li>Completed <span className="text-foreground font-mono text-xs">{task.completedAt}</span></li>}
            </ul>
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1.5">
              <MessageSquareText className="h-3.5 w-3.5" /> Feedback
            </h3>
            {feedbackLoading ? (
              <p className="text-sm text-muted-foreground py-2">Loading feedback…</p>
            ) : (
              <div className="space-y-3 mb-4">
                {feedbackList.length === 0 && <p className="text-sm text-muted-foreground">No feedback yet.</p>}
                {feedbackList.map(fb => (
                  <div key={fb.id} className="rounded-xl border border-border/60 bg-muted/5 p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-foreground">{fb.authorName || 'Unknown'}</span>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">
                        {fb.createdAt.slice(0, 16).replace('T', ' ')}
                      </span>
                    </div>
                    {editingFeedbackId === fb.id ? (
                      <div className="space-y-2">
                        <textarea
                          value={editingFeedbackText}
                          onChange={e => setEditingFeedbackText(e.target.value)}
                          rows={3}
                          className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                        />
                        <div className="flex gap-2">
                          <Button type="button" size="sm" onClick={() => void saveFeedbackEdit()} disabled={!editingFeedbackText.trim()}>
                            Save
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingFeedbackId(null);
                              setEditingFeedbackText('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm text-foreground whitespace-pre-wrap">{fb.message}</p>
                        {currentUser?.id === fb.userId && (
                          <div className="flex gap-2 pt-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingFeedbackId(fb.id);
                                setEditingFeedbackText(fb.message);
                              }}
                            >
                              Edit
                            </Button>
                            <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void deleteFeedback(fb.id)}>
                              Delete
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Add feedback</Label>
              <textarea
                value={newFeedbackText}
                onChange={e => setNewFeedbackText(e.target.value)}
                placeholder="Share an update or note for the project…"
                rows={2}
                className="w-full rounded-xl border border-border/80 bg-muted/20 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
              <Button type="button" size="sm" onClick={() => void postFeedback()} disabled={postingFeedback || !newFeedbackText.trim()}>
                {postingFeedback ? 'Posting…' : 'Post feedback'}
              </Button>
            </div>
          </section>

          <Separator />

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Custom fields</h3>
            {canEditTaskFields ? (
              <div className="space-y-2">
                {draftCustomRows.map(row => (
                  <div key={row.localId} className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-border/60 px-3 py-2.5 bg-muted/5">
                    <input
                      value={row.key}
                      onChange={e => updateCustomRow(row.localId, 'key', e.target.value)}
                      placeholder="Field name"
                      className="min-w-[100px] flex-1 bg-muted/30 rounded-lg px-2 py-1.5 text-sm border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <input
                      value={row.value}
                      onChange={e => updateCustomRow(row.localId, 'value', e.target.value)}
                      placeholder="Value"
                      className="min-w-[120px] flex-[2] bg-muted/30 rounded-lg px-2 py-1.5 text-sm border border-border/40 focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                    <button
                      type="button"
                      onClick={() => removeCustomRow(row.localId)}
                      className="text-muted-foreground hover:text-red-400 transition-colors shrink-0 p-1"
                      aria-label="Remove row"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCustomFieldRow}
                  className="mt-1 px-3 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors inline-flex items-center gap-1 text-sm"
                >
                  <Plus className="h-4 w-4" /> Add field
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {Object.keys(task.customFields || {}).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No custom fields</p>
                ) : (
                  Object.entries(task.customFields || {}).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2 text-sm rounded-lg border border-border/60 px-3 py-2.5 bg-muted/5">
                      <span className="font-medium text-muted-foreground min-w-[100px] shrink-0">{key}</span>
                      <span className="text-foreground flex-1 break-words">{value}</span>
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <Separator />

          <section>
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 block">Priority</Label>
            {canEditTaskFields ? (
              <div className="flex flex-wrap gap-1.5">
                {(['Low', 'Medium', 'High', 'Urgent'] as Priority[]).map(p => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setDraftPriority(p)}
                    className={`text-xs px-3 py-2 rounded-lg border font-medium transition-all ${
                      priorityColors[p]
                    } ${
                      draftPriority === p
                        ? 'ring-2 ring-primary/60 ring-offset-2 ring-offset-background scale-[1.02]'
                        : 'opacity-75 hover:opacity-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            ) : (
              <span className={`inline-flex text-xs px-3 py-2 rounded-lg font-medium border ${priorityColors[task.priority]}`}>{task.priority}</span>
            )}
          </section>
        </div>

        {isManager && task.status === 'done' && (
          <div className="shrink-0 border-t border-border/60 px-6 py-3 flex flex-wrap items-center justify-end gap-2 bg-amber-500/5">
            <span className="text-xs text-muted-foreground mr-auto max-w-[min(100%,280px)]">
              In Done — approve to mark completed and remove from the dashboard (still listed under completed elsewhere).
            </span>
            <Button
              type="button"
              className="bg-green-600 text-white hover:bg-green-700 border-green-600 shadow-sm"
              onClick={() => void handleApproveCompletion()}
              disabled={approvingCompletion}
            >
              {approvingCompletion ? 'Approving…' : 'Approve completion'}
            </Button>
          </div>
        )}

        {showTaskActionsFooter && (
          <div className="shrink-0 border-t border-border/60 px-6 py-4 flex flex-wrap items-center justify-end gap-2 bg-card">
            {canEditTaskFields && (
              <Button type="button" variant="outline" onClick={discardChanges} disabled={!isDirty || saving}>
                Discard changes
              </Button>
            )}
            {!canEditTaskFields && canManageAssignees && (
              <span className="text-xs text-muted-foreground mr-auto">Assignee changes only</span>
            )}
            <Button type="button" onClick={() => void saveAll()} disabled={!isDirty || saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>

    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this task?</AlertDialogTitle>
          <AlertDialogDescription>
            This cannot be undone. Only you can delete tasks you created.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={deleting}
            onClick={e => {
              e.preventDefault();
              void handleDeleteTask();
            }}
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
