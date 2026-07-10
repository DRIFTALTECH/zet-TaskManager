/**
 * Human-friendly labels for employee recommendations (no scores shown in UI).
 */

import type { TaskDueForecastEmployee } from '@/lib/analyticsApi';

export type WorkloadLevel = 'Light' | 'Medium' | 'Busy';

const WORKLOAD_FROM_STATUS: Record<string, WorkloadLevel> = {
  Available: 'Light',
  Balanced: 'Medium',
  Overloaded: 'Busy',
};

export function workloadLevelFromEmployee(
  emp?: TaskDueForecastEmployee | null,
): WorkloadLevel | undefined {
  if (!emp) return undefined;
  if (emp.workloadStatus && WORKLOAD_FROM_STATUS[emp.workloadStatus]) {
    return WORKLOAD_FROM_STATUS[emp.workloadStatus];
  }
  const count = emp.taskCount ?? 0;
  if (count <= 3) return 'Light';
  if (count <= 6) return 'Medium';
  return 'Busy';
}

export function workloadLevelFromTaskCount(taskCount?: number): WorkloadLevel | undefined {
  if (taskCount == null) return undefined;
  if (taskCount <= 3) return 'Light';
  if (taskCount <= 6) return 'Medium';
  return 'Busy';
}

export interface FriendlyWhyInput {
  rawBullets?: string[];
  matchedSkills?: string[];
  missingSkills?: string[];
  requiredSkills?: string[];
  workload?: WorkloadLevel;
}

/** Plain-language reasons — no percentages or scores. */
export function buildFriendlyWhyBullets({
  rawBullets = [],
  matchedSkills = [],
  missingSkills = [],
  requiredSkills = [],
  workload,
}: FriendlyWhyInput): string[] {
  const bullets: string[] = [];

  if (requiredSkills.length > 0) {
    if (missingSkills.length === 0 && matchedSkills.length > 0) {
      bullets.push('Has all the required skills.');
    } else if (matchedSkills.length > 0) {
      bullets.push('Has most of the required skills.');
    }
  }

  if (workload === 'Light') {
    bullets.push('Currently has a light workload.');
  } else if (workload === 'Medium') {
    bullets.push('Has a moderate workload.');
  } else if (workload === 'Busy') {
    bullets.push('Is fairly busy right now.');
  }

  for (const line of rawBullets) {
    const lower = line.toLowerCase();
    if (lower.includes('enough free time')) {
      bullets.push('Has enough free time to help.');
    } else if (lower.includes('start this task soon')) {
      bullets.push('Can start this task soon.');
    } else if (lower.includes('before the due date')) {
      bullets.push('Can work on this before it is due.');
    } else if (lower.includes('more free time than')) {
      bullets.push('Has more free time than the current owner.');
    } else if (lower.includes('required skills') && matchedSkills.length === 0) {
      bullets.push('May be a good backup if the first choice is unavailable.');
    }
  }

  const seen = new Set<string>();
  return bullets.filter(b => {
    if (seen.has(b)) return false;
    seen.add(b);
    return true;
  });
}

export function formatAvailableFrom(date?: string | null): string | null {
  if (!date) return null;
  return date;
}

export interface RecommendationInsightSummary {
  task?: string;
  currentOwner?: string;
  suggestedPerson: string;
  matchingSkills: string[];
  availableFrom?: string | null;
  workload?: WorkloadLevel;
  reasons: string[];
}

export function recommendationInsightSummary(input: {
  taskTitle?: string;
  taskName?: string;
  currentOwner?: string;
  currentAssigneeName?: string;
  suggestedName: string;
  matchedSkills?: string[];
  missingSkills?: string[];
  requiredSkills?: string[];
  whyBullets?: string[];
  availableFrom?: string | null;
  workload?: WorkloadLevel;
}): RecommendationInsightSummary {
  return {
    task: input.taskTitle ?? input.taskName,
    currentOwner: input.currentOwner ?? input.currentAssigneeName,
    suggestedPerson: input.suggestedName,
    matchingSkills: input.matchedSkills ?? [],
    availableFrom: input.availableFrom,
    workload: input.workload,
    reasons: buildFriendlyWhyBullets({
      rawBullets: input.whyBullets,
      matchedSkills: input.matchedSkills,
      missingSkills: input.missingSkills,
      requiredSkills: input.requiredSkills,
      workload: input.workload,
    }),
  };
}
