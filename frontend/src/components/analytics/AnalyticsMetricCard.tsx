/**
 * AnalyticsMetricCard — summary card with title, one-line explanation, metric, and optional inline AI.
 */

import type { ReactNode } from 'react';
import type { InsightScope } from '@/lib/analyticsApi';
import { AIInsightsPanel } from './AIInsightsPanel';
import { cn } from '@/lib/utils';

interface AnalyticsMetricCardProps {
  title: string;
  explanation: string;
  metric: ReactNode;
  metricClassName?: string;
  insightScope?: InsightScope;
  insightContext?: Record<string, unknown>;
  className?: string;
}

export function AnalyticsMetricCard({
  title,
  explanation,
  metric,
  metricClassName,
  insightScope,
  insightContext,
  className,
}: AnalyticsMetricCardProps) {
  return (
    <div className={cn('rounded-2xl border border-border/30 bg-card p-4 space-y-3', className)}>
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground/80 leading-snug">{explanation}</p>
      </div>
      <p className={cn('text-2xl font-bold tabular-nums', metricClassName ?? 'text-foreground')}>
        {metric}
      </p>
      {insightScope && insightContext && (
        <AIInsightsPanel
          scope={insightScope}
          context={insightContext}
          variant="inline"
          autoLoad
        />
      )}
    </div>
  );
}
