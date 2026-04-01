import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, ChevronLeft, ChevronRight, Clock, Layers, ListTodo, Mail } from 'lucide-react';
import { snappy, pageEnter } from '@/lib/motion';
import { isTaskAssignedTo } from '@/lib/task-utils';
import type { TimesheetWorkEntry } from '@/types';
import { api } from '@/lib/api';
import { toast } from 'sonner';

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function localISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getWeekDates(weekOffset: number): string[] {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
  return dayShort.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return localISODate(d);
  });
}

function formatDisplayDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${d}-${m}-${y}`;
}

function formatDuration(seconds: number): string {
  if (seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type Tab = 'overview' | 'timesheet';

const UserDetailPage = () => {
  const { userId } = useParams<{ userId: string }>();
  const { users, tasks, projects } = useAppStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [weekOffset, setWeekOffset] = useState(0);
  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const user = users.find(u => u.id === userId);
  const todayStr = localISODate(new Date());
  const weekDates = getWeekDates(weekOffset);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const visibleWeekDates = weekDates.filter(d => d <= todayStr);

  const userProjects = useMemo(
    () => (user ? projects.filter(p => p.members.includes(user.id)) : []),
    [projects, user],
  );

  const userTasks = useMemo(() => {
    if (!user) return [];
    return tasks.filter(t => isTaskAssignedTo(t, user.id) || t.createdBy === user.id);
  }, [tasks, user]);

  const activeTasks = userTasks.filter(t => t.status !== 'completed');
  const completedTasks = userTasks.filter(t => t.status === 'completed');

  const reloadEntries = useCallback(async () => {
    if (!userId) return;
    setLoadingEntries(true);
    try {
      const list = await api.getTimesheetWorkEntriesForUser(userId, weekStart, weekEnd);
      setEntries(list);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load timesheet');
    } finally {
      setLoadingEntries(false);
    }
  }, [userId, weekStart, weekEnd]);

  useEffect(() => {
    if (tab === 'timesheet' && userId) void reloadEntries();
  }, [tab, userId, reloadEntries]);

  const [weekHoursPreview, setWeekHoursPreview] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const cur = getWeekDates(0);
    void (async () => {
      try {
        const list = await api.getTimesheetWorkEntriesForUser(userId, cur[0], cur[6]);
        if (cancelled) return;
        const sum = list.filter(e => e.workDate <= todayStr).reduce((a, e) => a + e.seconds, 0);
        setWeekHoursPreview(sum);
      } catch {
        if (!cancelled) setWeekHoursPreview(0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, todayStr]);

  if (!userId) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Missing user.</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">User not found.</p>
        <Link to="/users" className="text-sm text-primary hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to users
        </Link>
      </div>
    );
  }

  const dayView = visibleWeekDates
    .map(date => {
      const idx = weekDates.indexOf(date);
      const entriesForDay = entries.filter(e => e.workDate === date);
      const totalSeconds = entriesForDay.reduce((a, e) => a + e.seconds, 0);
      return {
        date,
        dayName: dayNames[idx],
        dayShortName: dayShort[idx],
        entriesForDay,
        totalSeconds,
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const weekTotalSeconds = entries.filter(e => e.workDate <= todayStr).reduce((a, e) => a + e.seconds, 0);
  const weekLabel =
    visibleWeekDates.length > 0
      ? `${formatDisplayDate(visibleWeekDates[0])} — ${formatDisplayDate(visibleWeekDates[visibleWeekDates.length - 1])}`
      : `${formatDisplayDate(weekStart)} — ${formatDisplayDate(weekEnd)}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="p-6 w-full min-w-0 max-w-5xl overflow-x-hidden box-border"
    >
      <Link
        to="/users"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Users
      </Link>

      <div className="rounded-2xl border bg-card p-6 mb-6">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-lg font-bold text-primary">
                {user.name
                  .split(' ')
                  .map(n => n[0])
                  .join('')
                  .toUpperCase()
                  .slice(0, 2)}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold">{user.name}</h1>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium inline-block mt-1 ${
                  user.role === 'manager' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}
              >
                {user.role}
              </span>
              <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Mail className="h-3.5 w-3.5 shrink-0" /> {user.email}
                </div>
                <div className="flex items-center gap-2">
                  <Briefcase className="h-3.5 w-3.5 shrink-0" />
                  {userProjects.map(p => p.name).join(', ') || 'No projects'}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6 border-b border-border/60">
          {(['overview', 'timesheet'] as const).map(t => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === t ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'overview' ? 'Overview' : 'Timesheet'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && (
        <div className="space-y-8">
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">This week (logged)</h2>
            <div className="flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5 text-primary" />
              {formatDuration(weekHoursPreview)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Hours up to today for the current calendar week.</p>
          </section>

          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4" /> Projects
            </h2>
            {userProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">Not assigned to any project.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {userProjects.map(p => (
                  <span key={p.id} className="px-3 py-1.5 rounded-lg bg-muted/60 text-sm border border-border/50">
                    {p.name}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
              <ListTodo className="h-4 w-4" /> Active tasks
            </h2>
            {activeTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active tasks.</p>
            ) : (
              <ul className="space-y-2">
                {activeTasks.map(t => {
                  const p = projects.find(x => x.id === t.projectId);
                  return (
                    <li key={t.id} className="text-sm border border-border/50 rounded-lg px-3 py-2 flex justify-between gap-2">
                      <span className="font-medium truncate">{t.title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{p?.name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border bg-card p-5">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Completed</h2>
            {completedTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed tasks yet.</p>
            ) : (
              <ul className="space-y-2">
                {completedTasks.map(t => {
                  const p = projects.find(x => x.id === t.projectId);
                  return (
                    <li key={t.id} className="text-sm border border-border/50 rounded-lg px-3 py-2 flex justify-between gap-2 opacity-90">
                      <span className="font-medium truncate">{t.title}</span>
                      <span className="text-muted-foreground shrink-0 text-xs">{p?.name}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {tab === 'timesheet' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <motion.button
                type="button"
                transition={snappy}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setWeekOffset(w => w - 1)}
                className="p-2 rounded-xl border hover:bg-muted/50 transition-colors duration-100"
              >
                <ChevronLeft className="h-4 w-4" />
              </motion.button>
              <span className="text-sm font-medium min-w-[200px] text-center">{weekLabel}</span>
              {loadingEntries && <span className="text-xs text-muted-foreground">Loading…</span>}
              <motion.button
                type="button"
                transition={snappy}
                whileHover={{ scale: 1.04 }}
                whileTap={{ scale: 0.96 }}
                onClick={() => setWeekOffset(w => Math.min(0, w + 1))}
                disabled={weekOffset >= 0}
                className="p-2 rounded-xl border hover:bg-muted/50 transition-colors duration-100 disabled:opacity-40 disabled:pointer-events-none"
              >
                <ChevronRight className="h-4 w-4" />
              </motion.button>
              {weekOffset !== 0 && (
                <button type="button" onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline">
                  This week
                </button>
              )}
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/30 px-4 py-2 text-sm">
              <span className="text-muted-foreground">Week total (to today) </span>
              <span className="font-semibold tabular-nums text-foreground">{formatDuration(weekTotalSeconds)}</span>
            </div>
          </div>

          {visibleWeekDates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No days in this view (future weeks are hidden).</p>
          ) : (
            <div className="space-y-4">
              {dayView.map((day, idx) => (
                <motion.div
                  key={day.date}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...pageEnter, delay: idx * 0.02 }}
                  className="rounded-2xl border bg-card overflow-x-hidden min-w-0 max-w-full"
                >
                  <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b gap-3 min-w-0 max-w-full">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-sm font-bold">{day.dayName}</span>
                      <span className="text-xs text-muted-foreground font-mono">{formatDisplayDate(day.date)}</span>
                    </div>
                    <span
                      className={`text-sm font-semibold ${day.totalSeconds > 0 ? 'text-foreground' : 'text-muted-foreground/40'}`}
                    >
                      {day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : 'No entries'}
                    </span>
                  </div>
                  {day.entriesForDay.length > 0 ? (
                    <div className="divide-y divide-border/50">
                      {day.entriesForDay.map(entry => {
                        const project = projects.find(p => p.id === entry.projectId);
                        const section = project?.sections.find(s => s.id === entry.sectionId);
                        return (
                          <div key={entry.id} className="flex items-start justify-between gap-4 px-5 py-3 min-w-0 max-w-full">
                            <div className="min-w-0 flex-1 overflow-hidden">
                              <p className="text-sm font-medium text-foreground break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                                {entry.description?.trim() ? entry.description : <span className="italic text-muted-foreground">No description</span>}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground mt-1 min-w-0">
                                <span className="break-words">{project?.name ?? entry.projectId}</span>
                                {section && (
                                  <>
                                    <span>·</span>
                                    <span>{section.name}</span>
                                  </>
                                )}
                                <span>·</span>
                                <span className="font-mono">
                                  {entry.timeFrom} – {entry.timeTo}
                                </span>
                              </div>
                            </div>
                            <span className="text-sm font-semibold font-mono tabular-nums shrink-0">
                              {formatDuration(entry.seconds)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="px-5 py-4 text-sm text-muted-foreground/50">No entries</div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default UserDetailPage;
