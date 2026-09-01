/**
 * ClientDetailPage — full view for one client at /reports/clients/:clientId.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowLeft, Building2, CheckCircle2, FolderKanban, ListTodo, Users,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import {
  getClientSummaryById,
  tasksForClient,
  teamMembersForClient,
} from '@/lib/client-summary';
import { isCompleted } from '@/lib/manage-utils';
import { formatDurationHms } from '@/lib/timesheetSubmission';
import { AnalyticsKpiCard } from '@/components/analytics/analyticsUi';
import { pageEnter } from '@/lib/motion';
import { ZET } from '@/lib/zet-charts';
import { Progress } from '@/components/ui/progress';
import UserAvatar from '@/components/UserAvatar';
import type { TimesheetWorkEntry } from '@/types';

const CHART_TOOLTIP = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
};

const DONUT_COLORS = [ZET.indigo, ZET.slate];

export default function ClientDetailPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const {
    clients, projects, tasks, users, currentUser,
    loadClients, syncTasks, syncProjectsAndUsers,
  } = useAppStore();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);

  useEffect(() => {
    void loadClients();
    void syncTasks();
    void syncProjectsAndUsers();
  }, [loadClients, syncTasks, syncProjectsAndUsers]);

  const clientProjectKey = useMemo(
    () => projects.filter(p => p.clientId === clientId).map(p => p.id).sort().join(','),
    [projects, clientId],
  );

  useEffect(() => {
    if (!clientProjectKey) {
      setEntries([]);
      return;
    }
    const ids = clientProjectKey.split(',');
    let cancelled = false;
    Promise.all(ids.map(id => api.getProjectTimesheetEntries(id).catch(() => [] as TimesheetWorkEntry[])))
      .then(lists => { if (!cancelled) setEntries(lists.flat()); });
    return () => { cancelled = true; };
  }, [clientProjectKey]);

  const summary = useMemo(
    () => (clientId ? getClientSummaryById(clients, projects, tasks, clientId, entries) : null),
    [clientId, clients, projects, tasks, entries],
  );

  const clientTasks = useMemo(
    () => (clientId ? tasksForClient(projects, tasks, clientId) : []),
    [clientId, projects, tasks],
  );

  const memberIds = useMemo(
    () => (clientId ? teamMembersForClient(projects, clientId, entries) : []),
    [clientId, projects, entries],
  );

  const memberUsers = useMemo(
    () => memberIds.map(id => users.find(u => u.id === id)).filter(Boolean) as typeof users,
    [memberIds, users],
  );

  const donutData = useMemo(() => {
    if (!summary) return [];
    return [
      { name: 'Done', value: summary.completedTasks },
      { name: 'Left', value: summary.remainingTasks },
    ].filter(d => d.value > 0);
  }, [summary]);

  const barData = useMemo(
    () => summary?.projects.map(p => ({
      name: p.name.length > 16 ? `${p.name.slice(0, 14)}…` : p.name,
      fullName: p.name,
      tasks: p.totalTasks,
      hours: Math.round((p.seconds / 3600) * 10) / 10,
    })) ?? [],
    [summary],
  );
  const barByHours = !!summary && summary.totalTasks === 0 && summary.seconds > 0;

  const activeTasks = clientTasks.filter(t => !isCompleted(t)).length;

  if (!isManager) return <Navigate to="/" replace />;

  if (!clientId || !summary) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-sm text-muted-foreground">Client not found.</p>
        <Link to="/reports" className="text-sm text-primary hover:underline mt-2 inline-block">
          Back to reports
        </Link>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full"
    >
      <div className="max-w-[1200px] mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Link
          to="/reports?tab=clients"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to reports
        </Link>

        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">{summary.name}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              All projects and tasks for this client.
            </p>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <AnalyticsKpiCard icon={FolderKanban} label="Projects" value={summary.projectCount} variant="blue" />
          <AnalyticsKpiCard
            icon={ListTodo}
            label="Total tasks"
            value={summary.totalTasks}
            sub={formatDurationHms(summary.seconds)}
            variant="violet"
          />
          <AnalyticsKpiCard icon={Users} label="Team members" value={summary.teamMemberCount} variant="emerald" />
          <AnalyticsKpiCard
            icon={CheckCircle2}
            label="Progress"
            value={`${summary.progress}%`}
            sub={`${summary.completedTasks} done · ${activeTasks} still open`}
            variant="amber"
          />
        </div>

        {/* Progress bar */}
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-foreground">Overall progress</span>
            <span className="font-bold tabular-nums">{summary.progress}%</span>
          </div>
          <Progress value={summary.progress} className="h-2.5" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
          {/* Projects list */}
          <div className="rounded-2xl border border-border/60 bg-card p-5 h-full">
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <FolderKanban className="h-4 w-4 text-primary/70" /> Projects
            </h2>
            <ul className="space-y-2">
              {summary.projects.map(p => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2.5 text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.memberCount} people · {p.progress}% done
                    </p>
                  </div>
                  <span className="text-xs font-semibold tabular-nums text-muted-foreground shrink-0 text-right">
                    {p.totalTasks} tasks
                    {p.seconds > 0 && (
                      <span className="block font-medium">{formatDurationHms(p.seconds)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Team — scroll only when the list is taller than this stretched card */}
          <div className="rounded-2xl border border-border/60 bg-card p-5 flex flex-col min-h-0 h-full">
            <h2 className="text-sm font-semibold mb-4 flex items-center gap-2 shrink-0">
              <Users className="h-4 w-4 text-primary/70" /> Team members
            </h2>
            {memberUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">No team members yet.</p>
            ) : (
              <ul className="space-y-2 overflow-y-auto pr-1 min-h-0 flex-1">
                {memberUsers.map(u => (
                  <li key={u.id} className="flex items-center gap-3 rounded-xl border border-border/40 bg-muted/20 px-3 py-2">
                    <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{u.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.jobTitle || u.role}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <h2 className="text-sm font-semibold mb-3">Done vs left</h2>
            {donutData.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-8 text-center">No tasks yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} dataKey="value" innerRadius={50} outerRadius={80} paddingAngle={3} strokeWidth={0}>
                    {donutData.map((_, i) => (
                      <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                    ))}
                  </Pie>
                  <RTooltip
                    contentStyle={CHART_TOOLTIP}
                    formatter={(v: number, name: string) => [`${v} tasks`, name === 'Done' ? 'Done' : 'Left']}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
            <div className="flex justify-center gap-4 text-xs text-muted-foreground mt-2">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: ZET.indigo }} /> Done</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: ZET.slate }} /> Left</span>
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-5">
            <h2 className="text-sm font-semibold mb-3">{barByHours ? 'Hours per project' : 'Tasks per project'}</h2>
            {barData.length === 0 ? (
              <p className="text-sm text-muted-foreground italic py-8 text-center">No projects yet.</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <RTooltip
                    contentStyle={CHART_TOOLTIP}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                    formatter={(v: number) => barByHours ? [`${v}h`, 'Hours'] : [`${v} tasks`, 'Total']}
                  />
                  <Bar dataKey={barByHours ? 'hours' : 'tasks'} fill={ZET.violet} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Task list (simple) */}
        <div className="rounded-2xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary/70" /> Tasks ({clientTasks.length})
          </h2>
          {clientTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No tasks for this client yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border/50">
                    <th className="py-2 pr-3 font-medium">Task</th>
                    <th className="py-2 pr-3 font-medium">Project</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clientTasks.slice(0, 30).map(t => {
                    const proj = projects.find(p => p.id === t.projectId);
                    return (
                      <tr key={t.id} className="border-b border-border/30 last:border-0">
                        <td className="py-2.5 pr-3 font-medium max-w-[240px] truncate">{t.title}</td>
                        <td className="py-2.5 pr-3 text-muted-foreground max-w-[160px] truncate">{proj?.name ?? '—'}</td>
                        <td className="py-2.5 pr-3 text-muted-foreground capitalize">{(t.status || '').replace(/_/g, ' ')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {clientTasks.length > 30 && (
                <p className="text-xs text-muted-foreground mt-3">Showing 30 of {clientTasks.length} tasks.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
