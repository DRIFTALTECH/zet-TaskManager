/**
 * RecommendationCard — human-friendly employee recommendation (no scores shown).
 */

import { UserSkillBadges } from '@/components/SkillsPicker';
import {
  buildFriendlyWhyBullets,
  type WorkloadLevel,
} from '@/lib/recommendationDisplay';
import { cn } from '@/lib/utils';

const WORKLOAD_STYLE: Record<WorkloadLevel, string> = {
  Light: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  Medium: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
  Busy: 'text-orange-400 bg-orange-500/10 border-orange-500/25',
};

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">{label}</p>
      <div className="text-sm font-medium text-foreground">{children}</div>
    </div>
  );
}

export interface RecommendationCardProps {
  taskTitle: string;
  projectName?: string | null;
  sectionName?: string | null;
  currentOwnerName: string;
  currentOwnerId?: string | null;
  dueDate: string;
  status?: string;
  expectedResult?: string;
  
  hasRecommendation: boolean;
  recommendedOwnerName?: string | null;
  recommendedOwnerId?: string | null;
  requiredSkills?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  availableFrom?: string | null;
  workload?: WorkloadLevel;
  whyBullets?: string[];
  
  scheduleReason?: string | null;
  
  onViewEmployee?: (userId: string) => void;
  onAssigneeClick?: () => void;

  /** Forecast-visibility controls — does NOT change task status */
  forecastHidden?: boolean;
  onMarkCompleted?: () => void;
  onRestore?: () => void;
}

export function RecommendationCard({
  taskTitle,
  projectName,
  sectionName,
  currentOwnerName,
  currentOwnerId,
  dueDate,
  status,
  expectedResult,
  hasRecommendation,
  recommendedOwnerName,
  recommendedOwnerId,
  requiredSkills = [],
  matchedSkills = [],
  missingSkills = [],
  availableFrom,
  workload,
  whyBullets = [],
  scheduleReason,
  onViewEmployee,
  onAssigneeClick,
  forecastHidden = false,
  onMarkCompleted,
  onRestore,
}: RecommendationCardProps) {
  const friendlyWhy = buildFriendlyWhyBullets({
    rawBullets: whyBullets,
    matchedSkills,
    missingSkills,
    requiredSkills,
    workload,
  });

  const isCompleted = status === 'Completed' || status === 'completed' || status === 'Done' || status === 'done' || expectedResult === 'Completed';
  const isCancelledOrArchived = status === 'Cancelled' || status === 'cancelled' || status === 'Archived' || status === 'archived' || status === 'Closed' || status === 'closed' || expectedResult === 'Cancelled';

  // If marked as completed in forecast (hidden/archived from active view)
  if (forecastHidden) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.03] p-4 flex items-start justify-between gap-4 w-full max-w-full">
        <div className="flex items-start gap-3 min-w-0">
          <span className="mt-0.5 shrink-0 text-emerald-400 text-base">✓</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground leading-snug truncate">{taskTitle}</p>
            <p className="text-xs text-muted-foreground/70 mt-0.5">
              {[projectName, sectionName].filter(Boolean).join(' · ') || <span className="italic">No project or section</span>}
            </p>
            <p className="text-[10px] text-emerald-400/80 font-medium mt-1">Completed in Forecast · Due {dueDate}</p>
          </div>
        </div>
        {onRestore && (
          <button
            type="button"
            onClick={onRestore}
            className="shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70 hover:text-foreground border border-border/30 hover:border-border/60 rounded-lg px-2.5 py-1.5 transition-colors"
          >
            <span>↩</span> Restore
          </button>
        )}
      </div>
    );
  }

  // Dedicated completed UI state
  if (isCompleted) {
    return (
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5 space-y-4 text-xs w-full max-w-full">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Task</p>
          <h3 className="text-base font-semibold text-foreground leading-snug">{taskTitle}</h3>
          <p className="text-xs text-muted-foreground/75">
            {projectName || sectionName ? (
              [projectName, sectionName].filter(Boolean).join(' · ')
            ) : (
              <span className="italic text-muted-foreground/45">No project or section</span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-1 border-t border-border/10">
          <FieldRow label="Status">
            <span className="font-semibold text-emerald-400">Completed ✅</span>
          </FieldRow>
          <FieldRow label="Completed On">
            <span className="tabular-nums font-medium text-foreground">{dueDate || 'N/A'}</span>
          </FieldRow>
          <FieldRow label="Completed By">
            <span className="font-medium text-foreground">{currentOwnerName}</span>
          </FieldRow>
        </div>
      </div>
    );
  }

  // Cancelled or archived UI state
  if (isCancelledOrArchived) {
    return (
      <div className="rounded-xl border border-border/30 bg-muted/20 p-5 space-y-4 text-xs w-full max-w-full">
        <div className="flex flex-col gap-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Task</p>
          <h3 className="text-base font-semibold text-foreground leading-snug">{taskTitle}</h3>
          <p className="text-xs text-muted-foreground/75">
            {projectName || sectionName ? (
              [projectName, sectionName].filter(Boolean).join(' · ')
            ) : (
              <span className="italic text-muted-foreground/45">No project or section</span>
            )}
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-border/10">
          <FieldRow label="Status">
            <span className="font-semibold text-muted-foreground">{status || expectedResult || 'Cancelled'}</span>
          </FieldRow>
          <FieldRow label="Current Owner">
            <span className="font-medium text-foreground">{currentOwnerName}</span>
          </FieldRow>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/30 bg-card/40 p-5 space-y-5 text-xs w-full max-w-full">
      {/* Forecast completion checkbox */}
      {onMarkCompleted && (
        <label className="flex items-center gap-2 cursor-pointer group w-fit">
          <input
            type="checkbox"
            checked={false}
            onChange={onMarkCompleted}
            className="w-3.5 h-3.5 rounded border border-border/50 accent-emerald-500 cursor-pointer"
          />
          <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground/60 group-hover:text-muted-foreground/90 transition-colors">
            Mark as Completed
          </span>
        </label>
      )}

      {/* Task & Project */}
      <div className="flex flex-col gap-1">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">Task</p>
        <h3 className="text-base font-semibold text-foreground leading-snug">{taskTitle}</h3>
        <p className="text-xs text-muted-foreground/75">
          {projectName || sectionName ? (
            [projectName, sectionName].filter(Boolean).join(' · ')
          ) : (
            <span className="italic text-muted-foreground/45">No project or section</span>
          )}
        </p>
      </div>

      {/* Grid for metadata */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 pt-1 border-t border-border/10">
        {/* Current Owner */}
        <FieldRow label="Current Owner">
          {onViewEmployee && currentOwnerId ? (
            <button
              type="button"
              onClick={() => onViewEmployee(currentOwnerId)}
              className="text-primary hover:underline text-left font-semibold"
            >
              {currentOwnerName}
            </button>
          ) : (
            <span>{currentOwnerName}</span>
          )}
        </FieldRow>

        {/* Due Date */}
        <FieldRow label="Due Date">
          <span className="tabular-nums">{dueDate || <span className="italic text-muted-foreground/45">No due date</span>}</span>
        </FieldRow>

        {/* Status / Expected Result */}
        <FieldRow label="Expected Result">
          {expectedResult ? (
            <span className={cn(
              'inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold',
              expectedResult === 'On Track' && 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
              expectedResult === 'At Risk' && 'text-amber-400 bg-amber-500/10 border-amber-500/25',
              expectedResult === 'Delayed' && 'text-red-400 bg-red-500/10 border-red-500/25',
            )}>
              {expectedResult}
            </span>
          ) : (
            <span className="italic text-muted-foreground/45">N/A</span>
          )}
        </FieldRow>

        {/* Schedule/Reasoning */}
        <FieldRow label="Schedule">
          {scheduleReason ? (
            <span className="text-muted-foreground leading-relaxed">{scheduleReason}</span>
          ) : (
            <span className="italic text-muted-foreground/40">No scheduling conflicts</span>
          )}
        </FieldRow>
      </div>

      {/* Recommendation Box */}
      <div className="pt-4 border-t border-border/10">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold mb-2.5">
          Recommendation
        </p>

        {hasRecommendation && recommendedOwnerName ? (
          <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.06] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <p className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold">Recommended Owner</p>
                {onAssigneeClick ? (
                  <button
                    type="button"
                    onClick={onAssigneeClick}
                    className="text-sm font-semibold text-violet-300 hover:text-violet-200 hover:underline text-left font-semibold"
                  >
                    {recommendedOwnerName}
                  </button>
                ) : (
                  <p className="text-sm font-semibold text-violet-300">{recommendedOwnerName}</p>
                )}
              </div>

              {workload && (
                <div className="space-y-0.5">
                  <p className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold">Current Workload</p>
                  <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold mt-0.5', WORKLOAD_STYLE[workload])}>
                    {workload}
                  </span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-violet-500/10">
              <FieldRow label="Matching Skills">
                {matchedSkills.length > 0 ? (
                  <UserSkillBadges skills={matchedSkills} />
                ) : (
                  <p className="text-xs text-muted-foreground/75">None identified for this task</p>
                )}
              </FieldRow>

              <FieldRow label="Availability">
                <p className="text-xs text-foreground/90 tabular-nums font-medium">
                  {availableFrom ? `Available from ${availableFrom}` : 'Not sure yet'}
                </p>
              </FieldRow>
            </div>

            {friendlyWhy.length > 0 && (
              <div className="pt-3 border-t border-violet-500/10">
                <p className="text-[10px] uppercase tracking-wider text-violet-400 font-semibold mb-2">
                  Reasoning
                </p>
                <ul className="space-y-1.5">
                  {friendlyWhy.map((bullet, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-foreground/85 leading-snug">
                      <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-border/20 bg-muted/20 px-4 py-3.5 text-center text-muted-foreground/70">
            Task is optimally assigned — no reassignment recommendation needed.
          </div>
        )}
      </div>
    </div>
  );
}

// Deprecated alias for backwards compatibility
export { RecommendationCard as RecommendationScoreCard };
export type { RecommendationCardProps as RecommendationScoreCardProps };
