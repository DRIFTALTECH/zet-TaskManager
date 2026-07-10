/**
 * Shared visual tokens and small UI primitives for analytics pages.
 */

import { cn } from '@/lib/utils';
import { normalizePriority } from '@/lib/task-utils';
import { sanitizeStructuredInsight } from '@/lib/insightUtils';
import type { ProjectStatusLabel } from '@/lib/analyticsApi';

export const KPI_VARIANTS = {
  blue: {
    card: 'border-blue-500/20 bg-blue-500/[0.06]',
    icon: 'text-blue-400',
    value: 'text-blue-400',
  },
  emerald: {
    card: 'border-emerald-500/20 bg-emerald-500/[0.06]',
    icon: 'text-emerald-400',
    value: 'text-emerald-400',
  },
  red: {
    card: 'border-red-500/20 bg-red-500/[0.06]',
    icon: 'text-red-400',
    value: 'text-red-400',
  },
  amber: {
    card: 'border-amber-500/20 bg-amber-500/[0.06]',
    icon: 'text-amber-400',
    value: 'text-amber-400',
  },
  orange: {
    card: 'border-orange-500/20 bg-orange-500/[0.06]',
    icon: 'text-orange-400',
    value: 'text-orange-400',
  },
  violet: {
    card: 'border-violet-500/20 bg-violet-500/[0.06]',
    icon: 'text-violet-400',
    value: 'text-violet-400',
  },
  neutral: {
    card: 'border-border/30 bg-muted/[0.04]',
    icon: 'text-muted-foreground',
    value: 'text-foreground',
  },
} as const;

export type KpiVariant = keyof typeof KPI_VARIANTS;

export function AnalyticsKpiCard({
  icon: Icon,
  label,
  value,
  sub,
  variant = 'neutral',
}: {
  icon: React.FC<{ className?: string }>;
  label: string;
  value: string | number;
  sub?: string;
  variant?: KpiVariant;
}) {
  const v = KPI_VARIANTS[variant];
  return (
    <div className={cn('rounded-2xl border p-4 space-y-2 hover:border-border/50 transition-colors', v.card)}>
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', v.icon)} />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
      </div>
      <p className={cn('text-2xl font-bold tabular-nums', v.value)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground leading-snug">{sub}</p>}
    </div>
  );
}

export const PRIORITY_CHIP: Record<string, string> = {
  Urgent: 'text-red-400 border-red-500/30 bg-red-500/10',
  Critical: 'text-red-400 border-red-500/30 bg-red-500/10',
  High: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  Medium: 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10',
  Low: 'text-slate-400 border-slate-500/25 bg-slate-500/10',
};

export function PriorityChip({ priority, className }: { priority: string; className?: string }) {
  const normalized = normalizePriority(priority);
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0',
        PRIORITY_CHIP[normalized] ?? 'text-muted-foreground border-border/40 bg-muted/40',
        className,
      )}
    >
      {normalized}
    </span>
  );
}

export const TASK_STATUS_CHIP: Record<string, string> = {
  in_progress: 'bg-blue-500/10 text-blue-400 border-blue-500/25',
  todo: 'bg-muted/50 text-muted-foreground border-border/40',
  in_review: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  backlog: 'bg-muted/40 text-muted-foreground/70 border-border/30',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/25',
};

export const TASK_STATUS_LABEL: Record<string, string> = {
  in_progress: 'In Progress',
  todo: 'To Do',
  in_review: 'In Review',
  backlog: 'Backlog',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function TaskStatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-bold',
        TASK_STATUS_CHIP[status] ?? 'bg-muted/50 text-muted-foreground border-border/40',
      )}
    >
      {TASK_STATUS_LABEL[status] ?? status}
    </span>
  );
}

export const PROJECT_STATUS_CHIP: Record<ProjectStatusLabel, string> = {
  'On Track': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
  'Needs Attention': 'bg-amber-500/10 text-amber-400 border-amber-500/25',
  'At Risk': 'bg-red-500/10 text-red-400 border-red-500/25',
};

export function ProjectStatusChip({ status }: { status: ProjectStatusLabel | string }) {
  const key = status as ProjectStatusLabel;
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0',
        PROJECT_STATUS_CHIP[key] ?? PROJECT_STATUS_CHIP['On Track'],
      )}
    >
      {status}
    </span>
  );
}

export function OverdueChip() {
  return (
    <span className="rounded-full border px-2 py-0.5 text-[10px] font-bold bg-red-500/10 text-red-400 border-red-500/25">
      Overdue
    </span>
  );
}

export function AnalyticsSection({
  title,
  icon: Icon,
  iconClassName,
  badge,
  children,
  className,
  tone = 'default',
}: {
  title: string;
  icon?: React.FC<{ className?: string }>;
  iconClassName?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  tone?: 'default' | 'muted' | 'warm' | 'alert';
}) {
  const toneClass = {
    default: 'bg-card border-border/30',
    muted: 'bg-muted/[0.03] border-border/25',
    warm: 'bg-amber-500/[0.03] border-amber-500/15',
    alert: 'bg-red-500/[0.03] border-red-500/15',
  }[tone];

  return (
    <section className={cn('rounded-2xl border p-5 space-y-3', toneClass, className)}>
      <div className="flex items-center gap-2">
        {Icon && <Icon className={cn('h-4 w-4', iconClassName ?? 'text-violet-400')} />}
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export interface StructuredInsight {
  decision?: string;
  why?: string;
  evidence?: string[];
  recommendation?: string;
}

export function StructuredInsightBody({ insight }: { insight: StructuredInsight }) {
  const clean = sanitizeStructuredInsight(insight);
  const evidence = clean.evidence ?? [];

  return (
    <div className="space-y-4">
      {clean.decision && (
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.07] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-violet-400/80 mb-1.5">Decision</p>
          <p className="text-sm font-medium leading-relaxed text-foreground">{clean.decision}</p>
        </div>
      )}
      {clean.why && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Why?</p>
          <p className="text-sm text-foreground/85 leading-relaxed">{clean.why}</p>
        </div>
      )}
      {evidence.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Evidence</p>
          <ul className="space-y-1.5">
            {evidence.map((item, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/80">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400/80 shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
      {clean.recommendation && (
        <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.06] px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400/80 mb-1.5">Recommendation</p>
          <p className="text-sm text-foreground/90 leading-relaxed">{clean.recommendation}</p>
        </div>
      )}
    </div>
  );
}
