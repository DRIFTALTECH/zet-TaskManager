import { DollarSign } from 'lucide-react';
import type { TimesheetReviewEntry, TimesheetSubmissionReview } from '@/types';
import {
  dayNameForIso,
  formatDisplayDate,
  formatDurationHms,
} from '@/lib/timesheetSubmission';
import { cn } from '@/lib/utils';

function ReadOnlyEntryRow({ entry }: { entry: TimesheetReviewEntry }) {
  return (
    <li className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4 px-4 sm:px-5 py-3 sm:py-3.5 hover:bg-muted/20 transition-colors">
      <p className="min-w-0 flex-1 text-sm sm:text-[15px] font-medium text-foreground">
        {entry.description || <span className="text-muted-foreground/40 italic">No description</span>}
      </p>
      <div className="flex items-center gap-2.5 sm:gap-4 shrink-0 flex-wrap sm:flex-nowrap">
        <span className="text-[13px] text-muted-foreground truncate max-w-[220px]">
          {entry.projectName}
          <span className="text-muted-foreground/40 mx-1">/</span>
          {entry.sectionName}
        </span>
        <span className="font-mono text-[13px] tabular-nums text-foreground/70">
          {entry.timeFrom}
          <span className="text-muted-foreground/40 mx-0.5">–</span>
          {entry.timeTo}
        </span>
        <span className="text-base font-bold tabular-nums text-foreground shrink-0 w-[78px] text-right">
          {formatDurationHms(entry.seconds)}
        </span>
        <span
          title={entry.billable ? 'Billable' : 'Non-billable'}
          className={cn(
            'flex items-center justify-center h-8 w-8 rounded-lg shrink-0',
            entry.billable ? 'text-emerald-500' : 'text-muted-foreground/30',
          )}
        >
          <DollarSign className="h-4 w-4" />
        </span>
      </div>
    </li>
  );
}

export default function TimesheetSubmissionReviewPanel({
  review,
  loading,
  error,
}: {
  review: TimesheetSubmissionReview | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <div className="h-7 w-7 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-5 py-8 text-center text-sm text-destructive/80">{error}</div>
    );
  }
  if (!review) return null;

  return (
    <div className="space-y-3 pt-1 pb-2">
      <div className="flex items-center justify-end px-5">
        <div className="flex items-center gap-2.5 bg-primary/8 border border-primary/20 rounded-xl px-4 py-2">
          <span className="text-[11px] font-bold text-primary/70 uppercase tracking-wide">Week total</span>
          <span className="text-lg font-bold tabular-nums text-foreground">
            {formatDurationHms(review.totalSeconds)}
          </span>
        </div>
      </div>

      <div className="space-y-3 px-3 sm:px-4">
        {review.days.map(day => (
          <section
            key={day.workDate}
            className="rounded-2xl border border-border/30 overflow-hidden bg-card/80 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border/20 bg-muted/10">
              <div className="flex items-baseline gap-3 min-w-0">
                <h3 className="text-sm sm:text-base font-bold text-foreground">{dayNameForIso(day.workDate)}</h3>
                <span className="text-sm font-mono text-muted-foreground/60 tabular-nums">
                  {formatDisplayDate(day.workDate)}
                </span>
              </div>
              <span
                className={cn(
                  'text-sm font-bold tabular-nums px-3 py-1.5 rounded-xl border',
                  day.totalSeconds > 0
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'text-muted-foreground/40 bg-muted/30 border-border/30',
                )}
              >
                {day.totalSeconds > 0 ? formatDurationHms(day.totalSeconds) : '0m'}
              </span>
            </div>

            {day.entries.length === 0 ? (
              <div className="px-5 py-5 text-center text-sm text-muted-foreground/40 italic">
                No entries
              </div>
            ) : (
              <ul className="divide-y divide-border/20">
                {[...day.entries]
                  .sort((a, b) => b.timeFrom.localeCompare(a.timeFrom))
                  .map(entry => (
                    <ReadOnlyEntryRow key={entry.id} entry={entry} />
                  ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
