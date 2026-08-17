/**
 * WhatWillHappenNextPage — full-page deadline forecast and capacity recommendations.
 * Task-level and user-story-level forecasts are separate toggles (same conditions, different work unit).
 */

import { useCallback, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, BookOpen, CheckSquare, RefreshCw, Loader2, TrendingUp } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { ForecastPanel, type ForecastLevel, type ForecastRefreshControls } from '@/components/analytics/ForecastPanel';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import { pageEnter } from '@/lib/motion';
import { cn } from '@/lib/utils';

function defaultForecastRange() {
  const start = new Date();
  start.setDate(start.getDate() - 30);
  const end = new Date();
  end.setDate(end.getDate() + 30);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

export default function WhatWillHappenNextPage() {
  const currentUser = useAppStore(s => s.currentUser);
  const navigate = useNavigate();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [forecastRefresh, setForecastRefresh] = useState<ForecastRefreshControls | null>(null);
  const [range, setRange] = useState(defaultForecastRange);
  const [level, setLevel] = useState<ForecastLevel>('task');

  const handleRefresh = useCallback(() => {
    void forecastRefresh?.refresh();
  }, [forecastRefresh]);

  if (!isManager) return <Navigate to="/" replace />;

  const isStory = level === 'user_story';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full"
    >
      <div className="px-4 sm:px-8 pt-6 sm:pt-7 pb-6 border-b border-border/30 bg-gradient-to-b from-violet-500/[0.04] to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-3 min-w-0">
            <button
              type="button"
              onClick={() => navigate('/users')}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to Users
            </button>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-violet-400" />
                <span className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">
                  Team Forecast
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
                {ANALYTICS_LABELS.whatWillHappenNext}
              </h1>
              <p className="text-sm text-muted-foreground/70 mt-1.5 max-w-2xl leading-relaxed">
                {isStory
                  ? 'See which user-story deadlines are at risk, who has free time, and who we suggest for help. Suggestions only — you choose who takes each user story.'
                  : 'See which deadlines are at risk, who has free time, and who we suggest for help. Suggestions only — you choose who takes each task.'}
              </p>
            </div>

            <div className="flex items-center gap-1 bg-muted/30 rounded-xl p-1 w-fit border border-border/30">
              <button
                type="button"
                onClick={() => setLevel('task')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
                  level === 'task'
                    ? 'bg-card text-foreground shadow-sm border border-border/40'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {ANALYTICS_LABELS.forecastByTasks}
              </button>
              <button
                type="button"
                onClick={() => setLevel('user_story')}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all',
                  level === 'user_story'
                    ? 'bg-card text-foreground shadow-sm border border-border/40'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <BookOpen className="h-3.5 w-3.5" />
                {ANALYTICS_LABELS.forecastByUserStories}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2 text-sm">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Due from</span>
              <input
                type="date"
                value={range.startDate}
                onChange={e => setRange(r => ({ ...r, startDate: e.target.value }))}
                className="rounded-lg border border-border/40 bg-background px-3 py-1.5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Due to</span>
              <input
                type="date"
                value={range.endDate}
                onChange={e => setRange(r => ({ ...r, endDate: e.target.value }))}
                className="rounded-lg border border-border/40 bg-background px-3 py-1.5"
              />
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={!forecastRefresh || forecastRefresh.isRefreshing}
              className="inline-flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-border/40 bg-card/60 hover:bg-muted/40 transition-colors disabled:opacity-40"
            >
              {forecastRefresh?.isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Refresh
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 sm:px-8 py-6 max-w-6xl mx-auto w-full">
        <ForecastPanel
          key={level}
          variant="page"
          enabled
          level={level}
          dateRange={range}
          onRefreshControls={setForecastRefresh}
        />
      </div>
    </motion.div>
  );
}
