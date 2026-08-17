import type { TimesheetSubmission, TimesheetSubmissionStatus, TimesheetWorkEntry } from '@/types';

/** Monday ISO date for the week containing `iso` (YYYY-MM-DD). */
export function isoWeekMonday(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, '0');
  const dd = String(monday.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Editable when backend status is draft or rejected. */
export function timesheetWeekEditable(status: TimesheetSubmissionStatus): boolean {
  return status === 'draft' || status === 'rejected';
}

const LOCKED_STATUSES = new Set<TimesheetSubmissionStatus>(['submitted', 'approved']);

/** True when this work date is in a submitted/approved batch and cannot be edited. */
export function timesheetDateLocked(
  submission: TimesheetSubmission | null | undefined,
  workDate: string,
): boolean {
  if (!submission || !LOCKED_STATUSES.has(submission.status)) return false;
  return (submission.submittedDates ?? []).includes(workDate);
}

export function timesheetWeekSubmittable(submission: TimesheetSubmission): boolean {
  return timesheetWeekEditable(submission.status);
}

export function formatSubmissionDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function formatDurationHms(seconds: number): string {
  if (seconds <= 0) return '0h 0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function dayNameForIso(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  const js = d.getDay();
  return DAY_SHORT[js === 0 ? 6 : js - 1] ?? iso;
}

export type SelectedSubmissionDay = {
  date: string;
  dayName: string;
  entries: TimesheetWorkEntry[];
  totalSeconds: number;
};

export type SelectedSubmissionData = {
  /** Sorted unique selected ISO dates — backend submit payload. */
  dates: string[];
  /** Selected dates with scoped entries only (empty days omitted). */
  days: SelectedSubmissionDay[];
};

/** selectedDates → filter week entries → grouped days for preview / email / submit. */
export function buildSelectedSubmissionData(
  selectedDates: readonly string[],
  weekEntries: readonly TimesheetWorkEntry[],
): SelectedSubmissionData {
  const dates = [...new Set(selectedDates)].filter(Boolean).sort();
  if (dates.length === 0) return { dates: [], days: [] };
  const selected = new Set(dates);
  const scopedEntries = weekEntries.filter(e => selected.has(e.workDate));
  const days: SelectedSubmissionDay[] = [];
  for (const date of dates) {
    const entries = scopedEntries.filter(e => e.workDate === date);
    if (entries.length === 0) continue;
    days.push({
      date,
      dayName: dayNameForIso(date),
      entries,
      totalSeconds: entries.reduce((a, e) => a + e.seconds, 0),
    });
  }
  return { dates, days };
}

export function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}




export function statusDisplayLabel(status: TimesheetSubmissionStatus): string {
  switch (status) {
    case 'submitted':
      return 'Pending';
    case 'approved':
      return 'Approved';
    case 'rejected':
      return 'Rejected';
    case 'draft':
      return 'Draft';
    default:
      return status;
  }
}

export function submissionAuditLines(
  sub: TimesheetSubmission,
): Array<{ label: string; value: string }> {
  const lines: Array<{ label: string; value: string }> = [
    { label: 'Status', value: statusDisplayLabel(sub.status) },
  ];
  if (sub.status === 'approved') {
    if (sub.reviewerName) lines.push({ label: 'Approved By', value: sub.reviewerName });
    if (sub.reviewedAt) lines.push({ label: 'Approved On', value: formatSubmissionDateTime(sub.reviewedAt) });
  } else if (sub.status === 'rejected') {
    if (sub.reviewerName) lines.push({ label: 'Rejected By', value: sub.reviewerName });
    if (sub.reviewedAt) lines.push({ label: 'Rejected On', value: formatSubmissionDateTime(sub.reviewedAt) });
  } else if (sub.status === 'submitted') {
    if (sub.submittedAt) lines.push({ label: 'Submitted On', value: formatSubmissionDateTime(sub.submittedAt) });
  }
  return lines;
}

/** Manage-timesheets table: reviewer column from backend reviewer fields. */
export function submissionReviewerColumnText(sub: TimesheetSubmission): string {
  switch (sub.status) {
    case 'approved':
      return `Approved By: ${sub.reviewerName ?? '—'}`;
    case 'rejected':
      return `Rejected By: ${sub.reviewerName ?? '—'}`;
    case 'submitted':
      return 'Pending';
    default:
      return '—';
  }
}

export function statusBadgeClass(status: TimesheetSubmissionStatus): string {
  switch (status) {
    case 'submitted':
      return 'bg-sky-500/10 text-sky-600 border-sky-500/25 dark:text-sky-400';
    case 'approved':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:text-emerald-400';
    case 'rejected':
      return 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-400';
    default:
      return 'bg-muted/60 text-muted-foreground border-border/40';
  }
}
