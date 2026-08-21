/**
 * AIInsightsPanel.tsx — Reusable AI insights panel for any analytics page.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ChevronDown, ChevronUp, RefreshCw, Loader2 } from 'lucide-react';
import type { InsightScope } from '@/lib/analyticsApi';
import { AI_INSIGHT_UNAVAILABLE_MSG, AI_INSIGHTS_TITLE } from '@/lib/insightUtils';
import { useInsightGenerate } from '@/hooks/useInsightGenerate';
import { StructuredInsightBody } from '@/components/analytics/analyticsUi';
import { cn } from '@/lib/utils';

interface AIInsightsPanelProps {
  scope: InsightScope;
  context: Record<string, unknown>;
  title?: string;
  defaultCollapsed?: boolean;
  autoLoad?: boolean;
  variant?: 'panel' | 'inline';
}

function UnavailableMessage({ className, onRetry }: { className?: string; onRetry: () => void }) {
  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-muted-foreground/70">{AI_INSIGHT_UNAVAILABLE_MSG}</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-xs font-medium text-violet-600 dark:text-violet-400 hover:text-violet-300 transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

function InsightBody({ result }: { result: NonNullable<ReturnType<typeof useInsightGenerate>['result']> }) {
  return (
    <StructuredInsightBody
      insight={{
        decision: result.decision,
        why: result.why,
        evidence: result.evidence,
        recommendation: result.recommendation,
      }}
    />
  );
}

export function AIInsightsPanel({
  scope,
  context,
  title = AI_INSIGHTS_TITLE,
  defaultCollapsed = false,
  autoLoad = false,
  variant = 'panel',
}: AIInsightsPanelProps) {
  const [open, setOpen] = useState(variant === 'inline' ? true : !defaultCollapsed);
  const shouldAutoLoad = autoLoad || variant === 'inline';
  const { result, isBusy, showUnavailable, hasLoaded, load, retry } = useInsightGenerate(scope, context, {
    autoLoad: shouldAutoLoad,
  });

  if (variant === 'inline') {
    return (
      <div className="rounded-lg border border-violet-500/15 bg-violet-500/5 px-3 py-2 space-y-2" data-no-pan>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-violet-400/80">
          <Sparkles className="h-3 w-3" />
          {title}
        </div>
        {isBusy && (
          <div className="flex items-center gap-2 py-2 text-[11px] text-violet-400/90">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            Analyzing forecast…
          </div>
        )}
        {showUnavailable && (
          <UnavailableMessage className="text-[11px]" onRetry={retry} />
        )}
        {result && !isBusy && <InsightBody result={result} />}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-violet-500/20 overflow-hidden shadow-sm" data-no-pan>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left bg-gradient-to-r from-violet-500/12 via-indigo-500/8 to-transparent hover:from-violet-500/16 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-violet-500/20 flex items-center justify-center shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <span className="text-sm font-semibold text-foreground">{title}</span>
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground/50 shrink-0" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="panel"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden bg-gradient-to-b from-violet-500/[0.03] to-transparent"
          >
            <div className="px-4 pb-4 space-y-4">
              {!hasLoaded && !isBusy && (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <button
                    type="button"
                    onClick={load}
                    className="rounded-xl bg-violet-500/20 border border-violet-500/30 px-5 py-2 text-sm font-semibold text-violet-300 hover:bg-violet-500/30 transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    Generate
                  </button>
                </div>
              )}

              {isBusy && (
                <div className="flex justify-center py-6">
                  <div className="h-8 w-8 rounded-full border-2 border-violet-400/40 border-t-violet-400 animate-spin" />
                </div>
              )}

              {showUnavailable && (
                <UnavailableMessage className="text-sm text-center py-2" onRetry={retry} />
              )}

              {result && !isBusy && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className="space-y-4"
                >
                  <InsightBody result={result} />
                  <button
                    type="button"
                    onClick={retry}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-violet-600 dark:text-violet-400 transition-colors"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Regenerate
                  </button>
                </motion.div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
