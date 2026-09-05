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
import DateRangeField from '@/components/DateRangeField';
import PageHeader from '@/components/PageHeader';
import { PAGE_SHELL_SCROLL, SEGMENT_BAR, SEGMENT_BTN, SEGMENT_ICON } from '@/lib/page-styles';

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
      className={PAGE_SHELL_SCROLL}
    >
      <PageHeader
        icon={TrendingUp}
        eyebrow="Team Forecast"
        title={ANALYTICS_LABELS.whatWillHappenNext}
        actions={
          <>
            <DateRangeField
              from={range.startDate}
              to={range.endDate}
              onChange={(startDate, endDate) => setRange(r => ({ ...r, startDate, endDate }))}
              placeholder="Any due date"
            />
            <button
              type="button"
              onClick={handleRefresh}
              disabled={!forecastRefresh || forecastRefresh.isRefreshing}
              className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border/70 bg-card/70 px-2.5 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-40"
            >
              {forecastRefresh?.isRefreshing ? (
                <Loader2 className={`${SEGMENT_ICON} animate-spin`} />
              ) : (
                <RefreshCw className={SEGMENT_ICON} />
              )}
              Refresh
            </button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/users')}
            className="inline-flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <ArrowLeft className={SEGMENT_ICON} />
            Back to Users
          </button>
          <div className={SEGMENT_BAR}>
            <button type="button" onClick={() => setLevel('task')} className={SEGMENT_BTN(level === 'task')}>
              <CheckSquare className={SEGMENT_ICON} />
              {ANALYTICS_LABELS.forecastByTasks}
            </button>
            <button type="button" onClick={() => setLevel('user_story')} className={SEGMENT_BTN(isStory)}>
              <BookOpen className={SEGMENT_ICON} />
              {ANALYTICS_LABELS.forecastByUserStories}
            </button>
          </div>
        </div>
      </PageHeader>

      <div className="max-w-6xl mx-auto w-full">
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
