import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronRight, Clock, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import type { TimesheetWorkEntry } from '@/types';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import DateRangePicker from '@/components/DateRangePicker';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { resolveRange, weekMonday, fromIso, type RangeSelection } from '@/lib/date-range';
import { cn } from '@/lib/utils';

type GroupBy = 'week' | 'project' | 'person';

interface Group {
  key: string;
  label: string;
  seconds: number;
  billableSeconds: number;
  entries: TimesheetWorkEntry[];
  /** Distinct people in this group — the headline an admin scans for. */
  peopleCount: number;
}

function hours(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Logged time across the team, grouped the way an admin actually asks about it:
 * by week ("what did the last fortnight cost?"), by project ("where did the
 * hours go?"), or by person ("what has each person been doing?").
 *
 * Every group expands to the individual entries behind it, so the summary and
 * the detail are the same view rather than two screens.
 */
export default function TeamTimeBreakdown({ groupBy }: { groupBy: GroupBy }) {
  const projects = useAppStore(s => s.projects);
  const users = useAppStore(s => s.users);

  const [range, setRange] = useState<RangeSelection>({ preset: 'month', offset: 0 });
  const [personFilter, setPersonFilter] = useState('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [openKey, setOpenKey] = useState<string | null>(null);

  const resolved = useMemo(() => resolveRange(range), [range]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await api.getTeamTimesheetEntries(resolved.start, resolved.end));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load logged time');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [resolved.start, resolved.end]);

  useEffect(() => { void load(); }, [load]);

  const projectName = useCallback(
    (id: string) => projects.find(p => p.id === id)?.name ?? 'Unknown project',
    [projects],
  );
  const personName = useCallback(
    (id: string) => users.find(u => u.id === id)?.name ?? 'Unknown person',
    [users],
  );

  const filtered = useMemo(() => entries.filter(e =>
    (personFilter === 'all' || e.userId === personFilter) &&
    (projectFilter === 'all' || e.projectId === projectFilter),
  ), [entries, personFilter, projectFilter]);

  const groups = useMemo<Group[]>(() => {
    const map = new Map<string, Group>();
    for (const e of filtered) {
      const key =
        groupBy === 'week' ? weekMonday(e.workDate)
          : groupBy === 'project' ? e.projectId
            : e.userId;
      let g = map.get(key);
      if (!g) {
        const label =
          groupBy === 'week'
            ? `Week of ${fromIso(key).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
            : groupBy === 'project' ? projectName(key) : personName(key);
        g = { key, label, seconds: 0, billableSeconds: 0, entries: [], peopleCount: 0 };
        map.set(key, g);
      }
      g.seconds += e.seconds;
      if (e.billable) g.billableSeconds += e.seconds;
      g.entries.push(e);
    }
    for (const g of map.values()) {
      g.peopleCount = new Set(g.entries.map(e => e.userId)).size;
      g.entries.sort((a, b) => b.workDate.localeCompare(a.workDate) || a.timeFrom.localeCompare(b.timeFrom));
    }
    // Weeks read best newest-first; the others by size, so the biggest cost leads.
    return [...map.values()].sort((a, b) =>
      groupBy === 'week' ? b.key.localeCompare(a.key) : b.seconds - a.seconds,
    );
  }, [filtered, groupBy, projectName, personName]);

  const totalSeconds = groups.reduce((sum, g) => sum + g.seconds, 0);
  const billableSeconds = groups.reduce((sum, g) => sum + g.billableSeconds, 0);

  return (
    <div className="space-y-4">
      {/* Filters, in one row, matching every other page. */}
      <div className="flex flex-wrap items-center gap-2">
        <DateRangePicker
          value={range}
          onChange={setRange}
          allowedPresets={['week', 'lastweek', 'month', 'last30', 'custom']}
        />

        <Select value={personFilter} onValueChange={setPersonFilter}>
          <SelectTrigger className="h-9 w-auto min-w-[140px] text-xs"><SelectValue placeholder="Person" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All people</SelectItem>
            {users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger className="h-9 w-auto min-w-[150px] text-xs"><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Totals for whatever is currently filtered. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-border/40 bg-muted/20 px-4 py-3">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-lg font-bold tabular-nums">{hours(totalSeconds)}</span>
          <span className="text-xs text-muted-foreground">total</span>
        </div>
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-sm font-semibold tabular-nums">{hours(billableSeconds)}</span>
          <span className="text-xs text-muted-foreground">
            billable{totalSeconds > 0 && ` · ${Math.round((billableSeconds / totalSeconds) * 100)}%`}
          </span>
        </div>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {groups.length} {groupBy === 'week' ? 'weeks' : groupBy === 'project' ? 'projects' : 'people'} · {filtered.length} entries
        </span>
      </div>

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading logged time…</p>
      ) : groups.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No time logged in this period.
        </p>
      ) : (
        <div className="rounded-xl border border-border/40 divide-y divide-border/20 overflow-hidden">
          {groups.map(g => {
            const open = openKey === g.key;
            const share = totalSeconds > 0 ? (g.seconds / totalSeconds) * 100 : 0;
            return (
              <div key={g.key}>
                <button
                  type="button"
                  onClick={() => setOpenKey(open ? null : g.key)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
                >
                  <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
                  <span className="font-medium text-foreground truncate flex-1 min-w-0">{g.label}</span>

                  {/* Share of the period, so the big consumers are obvious at a glance. */}
                  <div className="hidden sm:block w-24 h-1.5 rounded-full bg-muted/50 overflow-hidden shrink-0">
                    <div className="h-full rounded-full bg-primary/60" style={{ width: `${share}%` }} />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-10 text-right shrink-0">
                    {Math.round(share)}%
                  </span>

                  {groupBy !== 'person' && (
                    <span className="hidden md:inline text-xs text-muted-foreground tabular-nums w-16 text-right shrink-0">
                      {g.peopleCount} {g.peopleCount === 1 ? 'person' : 'people'}
                    </span>
                  )}
                  <span className="font-semibold tabular-nums w-20 text-right shrink-0">{hours(g.seconds)}</span>
                </button>

                {open && (
                  <div className="bg-muted/10 px-4 pb-3 overflow-x-auto">
                    <table className="w-full text-xs min-w-[36rem]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                          <th className="text-left font-semibold py-2 pr-3">Date</th>
                          {groupBy !== 'person' && <th className="text-left font-semibold py-2 px-3">Person</th>}
                          {groupBy !== 'project' && <th className="text-left font-semibold py-2 px-3">Project</th>}
                          <th className="text-left font-semibold py-2 px-3">Description</th>
                          <th className="text-right font-semibold py-2 px-3">Time</th>
                          <th className="text-right font-semibold py-2 pl-3">Hours</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/10">
                        {g.entries.map(e => (
                          <tr key={e.id} className="hover:bg-muted/20">
                            <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap text-muted-foreground">
                              {fromIso(e.workDate).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}
                            </td>
                            {groupBy !== 'person' && <td className="py-1.5 px-3 truncate">{personName(e.userId)}</td>}
                            {groupBy !== 'project' && <td className="py-1.5 px-3 truncate">{projectName(e.projectId)}</td>}
                            <td className="py-1.5 px-3 text-muted-foreground truncate max-w-[20rem]">
                              {e.description || <span className="opacity-50">No description</span>}
                            </td>
                            <td className="py-1.5 px-3 text-right tabular-nums text-muted-foreground whitespace-nowrap">
                              {e.timeFrom}–{e.timeTo}
                            </td>
                            <td className="py-1.5 pl-3 text-right tabular-nums font-medium whitespace-nowrap">
                              {hours(e.seconds)}
                              {e.billable && <span className="text-emerald-600 dark:text-emerald-400 ml-1">$</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
