import { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, CheckCircle2, ChevronDown, Clock, Inbox, RefreshCw, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import type { TimesheetSubmission, TimesheetSubmissionReview, TimesheetSubmissionStatus, User } from '@/types';
import {
  formatDurationHms,
  formatSubmissionDateTime,
  isoWeekMonday,
  statusBadgeClass,
  statusDisplayLabel,
  submissionReviewerColumnText,
} from '@/lib/timesheetSubmission';
import UserAvatar from '@/components/UserAvatar';
import TimesheetSubmissionReviewPanel from '@/components/timesheet/TimesheetSubmissionReviewPanel';
import TimesheetSubmissionAuditInfo from '@/components/timesheet/TimesheetSubmissionAuditInfo';
import { useAppStore } from '@/stores/appStore';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

type StatusFilter = 'all' | TimesheetSubmissionStatus;

function weekLabel(sub: TimesheetSubmission) {
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T12:00:00`);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  return `${fmt(sub.weekStart)} – ${fmt(sub.weekEnd)}`;
}

export default function TimesheetManagePanel({ onClose }: { onClose: () => void }) {
  const { users, currentUser } = useAppStore();
  const isManagerial = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [rows, setRows] = useState<TimesheetSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<StatusFilter>('all');
  const [filterEmployee, setFilterEmployee] = useState('all');
  const [filterWeek, setFilterWeek] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [reviewById, setReviewById] = useState<Record<string, TimesheetSubmissionReview>>({});
  const [reviewLoadingId, setReviewLoadingId] = useState<string | null>(null);
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const [actingId, setActingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<TimesheetSubmission | null>(null);
  const [rejectComment, setRejectComment] = useState('');

  useEffect(() => {
    if (!isManagerial) onClose();
  }, [isManagerial, onClose]);

  const employeeOptions = useMemo(() => {
    if (!currentUser || !isManagerial) return [] as User[];
    return users.filter(u => u.isActive !== false);
  }, [users, currentUser, isManagerial]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!isManagerial) return;
    if (!opts?.silent) setLoading(true);
    try {
      const weekStart = filterWeek ? isoWeekMonday(filterWeek) : undefined;
      setRows(await api.getManagerTimesheetSubmissions({
        // 'draft' is never a manager filter (a draft has not been submitted yet),
        // and the endpoint only accepts the three submitted states.
        status: filterStatus === 'all' || filterStatus === 'draft' ? undefined : filterStatus,
        userId: filterEmployee === 'all' ? undefined : filterEmployee,
        weekStart,
      }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load timesheets');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterEmployee, filterWeek, isManagerial]);

  useEffect(() => { void load(); }, [load]);

  const fetchReview = useCallback(async (submissionId: string) => {
    setReviewLoadingId(submissionId);
    setReviewErrors(prev => {
      const next = { ...prev };
      delete next[submissionId];
      return next;
    });
    try {
      const review = await api.getTimesheetSubmissionReview(submissionId);
      setReviewById(prev => ({ ...prev, [submissionId]: review }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not load timesheet review';
      setReviewErrors(prev => ({ ...prev, [submissionId]: msg }));
    } finally {
      setReviewLoadingId(null);
    }
  }, []);

  const toggleExpand = (sub: TimesheetSubmission) => {
    if (!sub.id) return;
    if (expandedId === sub.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sub.id);
    if (!reviewById[sub.id] || reviewErrors[sub.id]) {
      void fetchReview(sub.id);
    }
  };

  const applySubmissionUpdate = useCallback((updated: TimesheetSubmission) => {
    if (!updated.id) return;
    const matchesFilter = (sub: TimesheetSubmission) => {
      if (filterStatus !== 'all' && sub.status !== filterStatus) return false;
      if (filterEmployee !== 'all' && sub.userId !== filterEmployee) return false;
      if (filterWeek && sub.weekStart !== isoWeekMonday(filterWeek)) return false;
      return true;
    };
    setRows(prev => (
      matchesFilter(updated)
        ? prev.map(r => r.id === updated.id ? updated : r)
        : prev.filter(r => r.id !== updated.id)
    ));
    setReviewById(prev => {
      const review = prev[updated.id!];
      if (!review) return prev;
      return { ...prev, [updated.id!]: { ...review, submission: updated } };
    });
  }, [filterStatus, filterEmployee, filterWeek]);

  const approve = async (sub: TimesheetSubmission) => {
    if (!sub.id) return;
    setActingId(sub.id);
    try {
      const updated = await api.approveTimesheetSubmission(sub.id);
      toast.success(`Approved ${sub.userName ?? 'timesheet'}`);
      applySubmissionUpdate(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not approve');
    } finally {
      setActingId(null);
    }
  };

  const markAsPending = async (sub: TimesheetSubmission) => {
    if (!sub.id) return;
    setActingId(sub.id);
    try {
      const updated = await api.reopenTimesheetSubmission(sub.id);
      toast.success(`Marked ${sub.userName ?? 'timesheet'} as pending`);
      applySubmissionUpdate(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not mark as pending');
    } finally {
      setActingId(null);
    }
  };

  const confirmReject = async () => {
    if (!rejectTarget?.id) return;
    const id = rejectTarget.id;
    setActingId(id);
    try {
      const updated = await api.rejectTimesheetSubmission(id, rejectComment.trim());
      toast.success(`Rejected ${rejectTarget.userName ?? 'timesheet'}`);
      setRejectTarget(null);
      setRejectComment('');
      applySubmissionUpdate(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reject');
    } finally {
      setActingId(null);
    }
  };

  const totalForRow = (sub: TimesheetSubmission) => {
    if (!sub.id) return null;
    return reviewById[sub.id]?.totalSeconds ?? null;
  };

  if (!isManagerial) return null;

  return (
    <div className="min-h-full flex flex-col">
      <div className="px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Timesheets</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Manage timesheets
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              Review submitted, approved, and rejected team timesheets.
            </p>
          </div>
          <Button variant="outline" onClick={onClose} className="rounded-xl gap-2 shrink-0">
            <ArrowLeft className="h-4 w-4" />
            Back to timesheet
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-5 rounded-xl border border-border/70 bg-card/50 p-2.5">
          <Select value={filterStatus} onValueChange={v => setFilterStatus(v as StatusFilter)}>
            <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="submitted">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filterEmployee} onValueChange={setFilterEmployee}>
            <SelectTrigger className="h-8 w-auto min-w-[140px] text-xs">
              <SelectValue placeholder="Employee" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All employees</SelectItem>
              {employeeOptions.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filterWeek}
              onChange={e => setFilterWeek(e.target.value)}
              className="h-8 rounded-lg border border-border/60 bg-background px-2.5 text-xs"
              aria-label="Filter by week"
            />
            {filterWeek && (
              <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setFilterWeek('')}>
                Clear week
              </Button>
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 rounded-lg gap-1.5 text-xs ml-auto"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-8">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/40 bg-muted/10 px-6 py-14 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground/70">No timesheets match your filters</p>
            <p className="text-xs text-muted-foreground/45 mt-1">Submitted timesheets from your team will appear here.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-border/35 bg-card shadow-sm overflow-hidden">
            <div className="hidden sm:grid sm:grid-cols-[1.2fr_1fr_0.75fr_1fr_0.7fr_1fr_2rem] gap-4 px-5 py-3 border-b border-border/30 bg-muted/20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/55">
              <span>Employee</span>
              <span>Week</span>
              <span>Status</span>
              <span>Reviewed by</span>
              <span>Total hours</span>
              <span>Submitted at</span>
              <span />
            </div>
            <ul className="divide-y divide-border/25">
              {rows.map(sub => {
                const user = users.find(u => u.id === sub.userId);
                const expanded = expandedId === sub.id;
                const busy = actingId === sub.id;
                const total = totalForRow(sub);
                const canApprove = isManagerial && sub.status === 'submitted';
                const canReject = isManagerial && (sub.status === 'submitted' || sub.status === 'approved');
                const canMarkPending = isManagerial && (sub.status === 'approved' || sub.status === 'rejected');
                return (
                  <li key={sub.id!}>
                    <button
                      type="button"
                      onClick={() => toggleExpand(sub)}
                      className={cn(
                        'w-full flex flex-col sm:grid sm:grid-cols-[1.2fr_1fr_0.75fr_1fr_0.7fr_1fr_2rem] gap-3 sm:gap-4 sm:items-center px-5 py-4 text-left transition-colors',
                        expanded ? 'bg-muted/20' : 'hover:bg-muted/15',
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <UserAvatar name={sub.userName ?? user?.name ?? '?'} avatar={user?.avatar ?? ''} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{sub.userName ?? user?.name ?? 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground/55 truncate sm:hidden">{weekLabel(sub)}</p>
                          <p className="text-xs text-muted-foreground/55 truncate sm:hidden">{submissionReviewerColumnText(sub)}</p>
                        </div>
                      </div>
                      <span className="text-sm tabular-nums text-muted-foreground hidden sm:block">{weekLabel(sub)}</span>
                      <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border w-fit', statusBadgeClass(sub.status))}>
                        {statusDisplayLabel(sub.status)}
                      </span>
                      <span className="text-sm text-muted-foreground hidden sm:block min-w-0 truncate">
                        {submissionReviewerColumnText(sub)}
                      </span>
                      <span className="text-sm font-bold tabular-nums">
                        {total !== null ? formatDurationHms(total) : '—'}
                      </span>
                      <span className="text-sm text-muted-foreground tabular-nums">{formatSubmissionDateTime(sub.submittedAt)}</span>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 text-muted-foreground/50 justify-self-end transition-transform hidden sm:block',
                          expanded && 'rotate-180',
                        )}
                      />
                    </button>

                    <AnimatePresence initial={false}>
                      {expanded && sub.id && (
                        <motion.div
                          key="review"
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: 'easeOut' }}
                          className="overflow-hidden border-t border-border/25 bg-muted/5"
                        >
                          <TimesheetSubmissionReviewPanel
                            review={reviewById[sub.id] ?? null}
                            loading={reviewLoadingId === sub.id}
                            error={reviewErrors[sub.id] ?? null}
                          />

                          <TimesheetSubmissionAuditInfo
                            submission={sub}
                            className="mx-5 mb-3 space-y-1 rounded-lg bg-background/50 border border-border/30 px-3 py-2.5"
                          />

                          {sub.status === 'rejected' && sub.rejectionNote && (
                            <p className="mx-5 mb-3 text-sm rounded-lg bg-amber-500/10 border border-amber-500/25 px-3 py-2 text-amber-800 dark:text-amber-300">
                              <span className="font-semibold">Rejection note: </span>{sub.rejectionNote}
                            </p>
                          )}

                          {(canApprove || canReject || canMarkPending) && (
                            <div className="flex flex-wrap items-center justify-end gap-2 px-5 py-4 border-t border-border/20 bg-muted/10">
                              {canMarkPending && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy || reviewLoadingId === sub.id}
                                  onClick={e => { e.stopPropagation(); void markAsPending(sub); }}
                                  className="rounded-xl gap-1.5"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  {busy ? '…' : 'Mark as Pending'}
                                </Button>
                              )}
                              {canApprove && (
                                <Button
                                  size="sm"
                                  disabled={busy || reviewLoadingId === sub.id}
                                  onClick={e => { e.stopPropagation(); void approve(sub); }}
                                  className="rounded-xl gap-1.5"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  {busy ? '…' : 'Approve'}
                                </Button>
                              )}
                              {canReject && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy || reviewLoadingId === sub.id}
                                  onClick={e => { e.stopPropagation(); setRejectTarget(sub); setRejectComment(''); }}
                                  className="rounded-xl gap-1.5 border-destructive/30 text-destructive hover:bg-destructive/10"
                                >
                                  <XCircle className="h-3.5 w-3.5" />
                                  Reject
                                </Button>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      <Dialog open={!!rejectTarget} onOpenChange={o => { if (!o) setRejectTarget(null); }}>
        <DialogContent className="rounded-2xl max-w-md">
          <DialogHeader>
            <DialogTitle>Reject timesheet</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {rejectTarget?.userName} · {rejectTarget && weekLabel(rejectTarget)}
          </p>
          <div className="space-y-1.5 pt-2">
            <Label htmlFor="reject-comment" className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">
              Comment (optional)
            </Label>
            <textarea
              id="reject-comment"
              value={rejectComment}
              onChange={e => setRejectComment(e.target.value)}
              rows={3}
              placeholder="Reason for rejection…"
              className={cn(
                'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y min-h-[72px]',
              )}
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRejectTarget(null)} className="rounded-xl">Cancel</Button>
            <Button
              variant="destructive"
              disabled={actingId === rejectTarget?.id}
              onClick={() => void confirmReject()}
              className="rounded-xl"
            >
              {actingId === rejectTarget?.id ? 'Rejecting…' : 'Reject timesheet'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
