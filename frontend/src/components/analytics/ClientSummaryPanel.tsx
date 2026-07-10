/**
 * ClientSummaryPanel — simple client overview on the Reports page.
 * Uses project and task data until Clockify is connected.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis,
} from 'recharts';
import {
  ArrowUpRight, Building2, FolderKanban, Info, ListTodo, Search, Users, X,
} from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import {
  buildClientSummaries,
  sortClientSummaries,
  type ClientSortKey,
  type ClientSummary,
} from '@/lib/client-summary';
import { snappy } from '@/lib/motion';
import { ZET } from '@/lib/zet-charts';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';

const CHART_TOOLTIP = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 12,
  fontSize: 12,
};

const DONUT_COLORS = [ZET.indigo, ZET.slate];

function ClockifyNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-4 py-3">
      <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
      <p className="text-sm text-muted-foreground leading-relaxed">
        Clockify is not connected yet. Hours and time data will appear here after the Clockify sync is enabled.
      </p>
    </div>
  );
}

function ClientCard({ summary, index }: { summary: ClientSummary; index: number }) {
  const navigate = useNavigate();

  const donutData = [
    { name: 'Done', value: summary.completedTasks },
    { name: 'Left', value: summary.remainingTasks },
  ].filter(d => d.value > 0);

  const barData = summary.projects.map(p => ({
    name: p.name.length > 14 ? `${p.name.slice(0, 12)}…` : p.name,
    fullName: p.name,
    tasks: p.totalTasks,
  }));

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...snappy, delay: Math.min(index * 0.04, 0.2) }}
      whileHover={{ y: -2, boxShadow: '0 8px 24px -8px hsl(var(--foreground) / 0.12)' }}
      whileTap={{ scale: 0.995 }}
      onClick={() => navigate(`/reports/clients/${summary.id}`)}
      className="w-full text-left rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm hover:border-primary/30 transition-colors group"
    >
      {/* Header stats */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary/70 shrink-0" />
            <h3 className="text-base font-bold text-foreground truncate">{summary.name}</h3>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <FolderKanban className="h-3.5 w-3.5" />
              {summary.projectCount} {summary.projectCount === 1 ? 'project' : 'projects'}
            </span>
            <span className="inline-flex items-center gap-1">
              <ListTodo className="h-3.5 w-3.5" />
              {summary.totalTasks} tasks
            </span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {summary.teamMemberCount} people
            </span>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.2fr] gap-4">
        {/* Left — project list */}
        <div className="rounded-xl border border-border/40 bg-muted/20 p-3 min-h-[140px]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">Projects</p>
          {summary.projects.length === 0 ? (
            <p className="text-xs text-muted-foreground/60 italic">No projects yet</p>
          ) : (
            <ul className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
              {summary.projects.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-foreground/90">{p.name}</span>
                  <span className="text-muted-foreground tabular-nums shrink-0">{p.totalTasks} tasks</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Right — progress + charts */}
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-semibold tabular-nums text-foreground">{summary.progress}%</span>
            </div>
            <Progress value={summary.progress} className="h-2" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Donut */}
            <div className="rounded-xl border border-border/40 bg-muted/10 p-2 h-[88px]">
              <p className="text-[10px] font-medium text-muted-foreground mb-0.5 text-center">Tasks</p>
              {donutData.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/50 text-center pt-6">No tasks</p>
              ) : (
                <ResponsiveContainer width="100%" height={68}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      innerRadius={18}
                      outerRadius={30}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
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
            </div>

            {/* Bar by project */}
            <div className="rounded-xl border border-border/40 bg-muted/10 p-2 h-[88px]">
              <p className="text-[10px] font-medium text-muted-foreground mb-0.5 text-center">By project</p>
              {barData.length === 0 ? (
                <p className="text-[10px] text-muted-foreground/50 text-center pt-6">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={68}>
                  <BarChart data={barData} margin={{ top: 0, right: 0, left: -28, bottom: 0 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 8 }} interval={0} />
                    <YAxis hide allowDecimals={false} />
                    <RTooltip
                      contentStyle={CHART_TOOLTIP}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
                      formatter={(v: number) => [`${v} tasks`, 'Total']}
                    />
                    <Bar dataKey="tasks" fill={ZET.violet} radius={[3, 3, 0, 0]} maxBarSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.button>
  );
}

export function ClientSummaryPanel() {
  const { clients, projects, tasks, loadClients } = useAppStore();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ClientSortKey>('name');

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const summaries = useMemo(
    () => buildClientSummaries(clients, projects, tasks),
    [clients, projects, tasks],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = q
      ? summaries.filter(s => s.name.toLowerCase().includes(q))
      : summaries;
    return sortClientSummaries(rows, sort);
  }, [summaries, search, sort]);

  return (
    <div className="space-y-4">
      <ClockifyNotice />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground">Client summary</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            See how each client is doing across projects and tasks.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3 py-2 min-w-[180px] flex-1 sm:flex-none sm:max-w-xs">
            <Search className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by client…"
              className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <Select value={sort} onValueChange={v => setSort(v as ClientSortKey)}>
            <SelectTrigger className="w-[160px] h-9 text-xs rounded-xl">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="projects">Most projects</SelectItem>
              <SelectItem value="tasks">Most tasks</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/50 bg-muted/10 py-16 text-center">
          <Building2 className="h-10 w-10 text-muted-foreground/25 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground/70">
            {summaries.length === 0 ? 'No clients with projects yet' : 'No clients match your search'}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1 max-w-sm mx-auto">
            {summaries.length === 0
              ? 'Create a project and assign a client to see it here.'
              : 'Try a different search term.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.map((s, i) => (
            <ClientCard key={s.id} summary={s} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
