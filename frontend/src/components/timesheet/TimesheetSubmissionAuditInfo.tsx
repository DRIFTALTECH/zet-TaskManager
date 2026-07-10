import type { TimesheetSubmission } from '@/types';
import { submissionAuditLines } from '@/lib/timesheetSubmission';

export default function TimesheetSubmissionAuditInfo({
  submission,
  className,
}: {
  submission: TimesheetSubmission;
  className?: string;
}) {
  const lines = submissionAuditLines(submission);
  if (lines.length <= 1 && submission.status === 'draft') return null;

  return (
    <div className={className}>
      {lines.map(({ label, value }) => (
        <p key={label} className="text-sm">
          <span className="opacity-60">{label}: </span>
          <span className="font-medium tabular-nums">{value}</span>
        </p>
      ))}
    </div>
  );
}
