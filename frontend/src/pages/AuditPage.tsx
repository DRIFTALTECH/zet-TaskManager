import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { pageEnter } from '@/lib/motion';
import { api } from '@/lib/api';
import { AuditLog } from '@/types';
import { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Search, X, RefreshCw, ChevronDown } from 'lucide-react';
import UserAvatar from '@/components/UserAvatar';

// ── Action label map ──────────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  'task.created':       { label: 'Created task',         color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  'task.updated':       { label: 'Updated task',         color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  'task.deleted':       { label: 'Deleted task',         color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  'task.status_changed':{ label: 'Changed status',       color: 'bg-violet-500/15 text-violet-400 border-violet-500/25' },
  'task.started':       { label: 'Started task',         color: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25' },
  'task.approved':      { label: 'Approved task',        color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  'task.reopened':      { label: 'Reopened task',        color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  'task.comment_added': { label: 'Added comment',        color: 'bg-slate-500/15 text-slate-400 border-slate-500/25' },
  'checklist.created':  { label: 'Added checklist item', color: 'bg-teal-500/15 text-teal-400 border-teal-500/25' },
  'checklist.done':     { label: 'Completed item',       color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  'checklist.undone':   { label: 'Unchecked item',       color: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  'checklist.updated':  { label: 'Updated item',         color: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  'checklist.deleted':  { label: 'Deleted item',         color: 'bg-red-500/15 text-red-400 border-red-500/25' },
  'attachment.uploaded':{ label: 'Uploaded file',        color: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/25' },
  'attachment.deleted': { label: 'Deleted file',         color: 'bg-red-500/15 text-red-400 border-red-500/25' },
};

function fmtDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function AuditPage() {
  const { currentUser, users } = useAppStore();
  const isManager = currentUser?.role === 'manager';

  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterUserId, setFilterUserId] = useState('');
  const [filterAction, setFilterAction] = useState('');
  const [limit, setLimit] = useState(200);

  const load = async (l = limit) => {
    setLoading(true);
    try { setLogs(await api.getAuditLogs(l)); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const actionTypes = useMemo(() => {
    const set = new Set(logs.map(l => l.action));
    return [...set].sort();
  }, [logs]);

  const filtered = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return logs.filter(log => {
      if (filterUserId && log.userId !== filterUserId) return false;
      if (filterAction && log.action !== filterAction) return false;
      if (q) {
        return (
          log.entityName.toLowerCase().includes(q) ||
          log.userName.toLowerCase().includes(q) ||
          log.action.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [logs, searchTerm, filterUserId, filterAction]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0"
    >
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">
                {isManager ? 'Team Audit' : 'My Activity'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Audit Log
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              {isManager
                ? 'All actions across your team — every create, update, and delete'
                : 'Your personal activity log'}
            </p>
          </div>

          <div className="flex items-center gap-2 mt-1">
            <div className="text-xs px-3 py-1.5 rounded-xl bg-muted/60 border border-border/40 text-muted-foreground font-medium">
              {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
            </div>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-border/40 bg-muted/30 hover:bg-muted/60 text-muted-foreground transition-all"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {/* Search */}
          <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3.5 py-2 flex-1 min-w-[180px] max-w-xs">
            <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search actions, names…"
              className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* User filter (manager only) */}
          {isManager && (
            <div className="relative">
              <select
                value={filterUserId}
                onChange={e => setFilterUserId(e.target.value)}
                className="appearance-none pl-4 pr-9 py-2 rounded-xl border border-border/40 bg-muted/40 text-sm focus:outline-none text-foreground/80 cursor-pointer hover:bg-muted/60"
              >
                <option value="">All People</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
            </div>
          )}

          {/* Action filter */}
          <div className="relative">
            <select
              value={filterAction}
              onChange={e => setFilterAction(e.target.value)}
              className="appearance-none pl-4 pr-9 py-2 rounded-xl border border-border/40 bg-muted/40 text-sm focus:outline-none text-foreground/80 cursor-pointer hover:bg-muted/60"
            >
              <option value="">All Actions</option>
              {actionTypes.map(a => (
                <option key={a} value={a}>{ACTION_LABELS[a]?.label ?? a}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-full gap-2 text-sm text-muted-foreground">
            <div className="w-5 h-5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <ShieldCheck className="h-10 w-10 text-muted-foreground/20 mb-3" />
            <p className="text-sm text-muted-foreground/50">{searchTerm || filterUserId || filterAction ? 'No matching entries' : 'No activity yet'}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/20">
            {filtered.map((log, i) => {
              const actor = isManager ? users.find(u => u.id === log.userId) : currentUser;
              const badge = ACTION_LABELS[log.action];
              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.12, delay: Math.min(i * 0.02, 0.3) }}
                  className="flex items-center gap-3 sm:gap-4 px-4 sm:px-8 py-3.5 hover:bg-muted/20 transition-colors group"
                >
                  {/* Avatar */}
                  <div className="shrink-0">
                    <UserAvatar
                      name={actor?.name ?? log.userName}
                      avatar={actor?.avatar}
                      size="sm"
                    />
                  </div>

                  {/* Name + action */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{log.userName}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${badge?.color ?? 'bg-muted/60 text-muted-foreground border-border/40'}`}>
                        {badge?.label ?? log.action}
                      </span>
                    </div>
                    {log.entityName && (
                      <p className="text-xs text-muted-foreground/60 truncate mt-0.5">
                        <span className="text-muted-foreground/40 capitalize">{log.entityType}</span>
                        {' · '}
                        <span className="text-foreground/60">{log.entityName}</span>
                        {log.details.status && (
                          <span className="ml-1 text-muted-foreground/40">→ {String(log.details.status)}</span>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Timestamp */}
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-muted-foreground/50 font-mono tabular-nums">{timeAgo(log.createdAt)}</p>
                    <p className="text-[10px] text-muted-foreground/30 mt-0.5 hidden group-hover:block">{fmtDate(log.createdAt)}</p>
                  </div>
                </motion.div>
              );
            })}

            {/* Load more */}
            {logs.length >= limit && (
              <div className="px-4 sm:px-8 py-5 text-center">
                <button
                  onClick={() => { const nl = limit + 200; setLimit(nl); void load(nl); }}
                  className="text-sm text-primary/60 hover:text-primary font-medium transition-colors"
                >
                  Load more…
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
