/**
 * RecommendationScoreCard — human-friendly employee recommendation (no scores shown).
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
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold">{label}</p>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

export interface RecommendationScoreCardProps {
  assigneeName: string;
  matchedSkills?: string[];
  missingSkills?: string[];
  requiredSkills?: string[];
  whyBullets?: string[];
  availableFrom?: string | null;
  workload?: WorkloadLevel;
  className?: string;
  onAssigneeClick?: () => void;
}

export function RecommendationScoreCard({
  assigneeName,
  matchedSkills = [],
  missingSkills = [],
  requiredSkills = [],
  whyBullets = [],
  availableFrom,
  workload,
  className,
  onAssigneeClick,
}: RecommendationScoreCardProps) {
  const friendlyWhy = buildFriendlyWhyBullets({
    rawBullets: whyBullets,
    matchedSkills,
    missingSkills,
    requiredSkills,
    workload,
  });

  if (!assigneeName && friendlyWhy.length === 0 && matchedSkills.length === 0) return null;

  return (
    <div className={cn('rounded-md border border-violet-500/20 bg-violet-500/[0.06] px-2.5 py-2.5 space-y-2.5', className)}>
      {onAssigneeClick ? (
        <button
          type="button"
          onClick={onAssigneeClick}
          className="text-sm font-semibold text-violet-300 hover:text-violet-200 hover:underline text-left"
        >
          {assigneeName}
        </button>
      ) : (
        <p className="text-sm font-semibold text-violet-300">{assigneeName}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
        <FieldRow label="Matching skills">
          {matchedSkills.length > 0 ? (
            <UserSkillBadges skills={matchedSkills} />
          ) : (
            <p className="text-sm text-muted-foreground/70">None identified for this task</p>
          )}
        </FieldRow>

        <FieldRow label="Available from">
          <p className="text-sm text-foreground/90 tabular-nums">
            {availableFrom ?? 'Not sure yet'}
          </p>
        </FieldRow>

        {workload && (
          <FieldRow label="Current workload">
            <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold', WORKLOAD_STYLE[workload])}>
              {workload}
            </span>
          </FieldRow>
        )}
      </div>

      {friendlyWhy.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground/60 font-semibold mb-1.5">
            Why this recommendation?
          </p>
          <ul className="space-y-1">
            {friendlyWhy.map((bullet, i) => (
              <li key={i} className="flex items-start gap-1.5 text-sm text-foreground/85 leading-snug">
                <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
                <span>{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
