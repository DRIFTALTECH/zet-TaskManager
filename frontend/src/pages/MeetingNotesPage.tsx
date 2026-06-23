/**
 * MeetingNotesPage — a month calendar where each day can hold MULTIPLE scrums.
 * Saving a scrum's raw text runs an AI agent that structures it per person;
 * the parsed breakdown can also be hand-edited. Parsed people are matched to
 * real app users so their profile photos show.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PublicClientApplication } from '@azure/msal-browser';
import { getMicrosoftClientId, getMicrosoftTenantId, getApiUrl } from '@/lib/env';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval,
  addMonths, format, isSameMonth, isToday, parseISO,
} from 'date-fns';
import {
  CalendarDays, ChevronLeft, ChevronRight, Sparkles, Pencil, Plus, Trash2,
  Users, AlertCircle, Check, FileText, ListChecks, X, Mic, Loader2, Square, Video,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { pageEnter, snappy } from '@/lib/motion';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import UserAvatar from '@/components/UserAvatar';
import type { Scrum, ScrumDaySummary, MomMember, User } from '@/types';
import { toast } from 'sonner';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const iso = (d: Date) => format(d, 'yyyy-MM-dd');

/** Match a parsed member name to a real user (exact, then first-name). */
function matchUser(name: string, users: User[]): User | undefined {
  const n = name.trim().toLowerCase();
  if (!n) return undefined;
  return (
    users.find(u => u.name.toLowerCase() === n) ||
    users.find(u => u.name.toLowerCase().split(' ')[0] === n.split(' ')[0])
  );
}

export default function MeetingNotesPage() {
  const users = useAppStore(s => s.users);
  const currentUser = useAppStore(s => s.currentUser);
  const isManagerial = currentUser?.role === 'manager' || currentUser?.role === 'admin';
  const [teamsOpen, setTeamsOpen] = useState(false);
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [summaries, setSummaries] = useState<Record<string, ScrumDaySummary>>({});
  const [loadingMonth, setLoadingMonth] = useState(false);

  const [openDate, setOpenDate] = useState<string | null>(null);
  const [scrums, setScrums] = useState<Scrum[]>([]);
  const [loadingDay, setLoadingDay] = useState(false);
  const [adding, setAdding] = useState(false);

  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [cursor]);

  const loadMonth = useCallback(async () => {
    setLoadingMonth(true);
    try {
      const list = await api.getScrumDays(iso(days[0]), iso(days[days.length - 1]));
      const map: Record<string, ScrumDaySummary> = {};
      for (const s of list) map[s.date] = s;
      setSummaries(map);
    } catch {
      setSummaries({});
    } finally {
      setLoadingMonth(false);
    }
  }, [days]);

  useEffect(() => { void loadMonth(); }, [loadMonth]);

  const loadDay = useCallback(async (date: string) => {
    setLoadingDay(true);
    try {
      setScrums(await api.getScrumsForDay(date));
    } catch {
      toast.error('Could not load scrums');
      setScrums([]);
    } finally {
      setLoadingDay(false);
    }
  }, []);

  const openDay = async (date: string) => {
    setOpenDate(date);
    setScrums([]);
    setAdding(false);
    await loadDay(date);
  };

  const closeDay = () => { setOpenDate(null); setScrums([]); setAdding(false); };

  // Refresh the calendar dot for the open day after a change.
  const refreshSummary = (date: string, list: Scrum[]) => {
    setSummaries(prev => ({
      ...prev,
      [date]: {
        date,
        scrumCount: list.length,
        memberCount: list.reduce((a, s) => a + s.members.length, 0),
        summary: list.find(s => s.summary)?.summary ?? '',
        parseStatus: list.some(s => s.parseStatus === 'ok') ? 'ok' : (list[0]?.parseStatus ?? 'empty'),
        updatedByName: list[list.length - 1]?.updatedByName ?? '',
      },
    }));
  };

  const afterChange = async () => {
    if (!openDate) return;
    const list = await api.getScrumsForDay(openDate);
    setScrums(list);
    refreshSummary(openDate, list);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}
      className="min-h-full"
    >
      {/* Header */}
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CalendarDays className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Daily MOM</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Meeting Notes
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              Add one or more scrums per day — the AI agent structures each one per person automatically.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isManagerial && (
              <button onClick={() => setTeamsOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-primary/40 bg-primary/5 text-primary text-xs font-semibold hover:bg-primary/10 transition-colors">
                <Video className="h-3.5 w-3.5" /> Import from Teams
              </button>
            )}
            <button onClick={() => setCursor(c => addMonths(c, -1))} className="p-2 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/60 transition-colors">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold w-36 text-center tabular-nums">{format(cursor, 'MMMM yyyy')}</span>
            <button onClick={() => setCursor(c => addMonths(c, 1))} className="p-2 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/60 transition-colors">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setCursor(startOfMonth(new Date()))} className="ml-1 px-3 py-2 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/60 text-xs font-semibold transition-colors">
              Today
            </button>
          </div>
        </div>
      </div>

      {/* Calendar */}
      <div className="p-4 sm:p-6">
        <div className="grid grid-cols-7 gap-1.5 mb-1.5">
          {WEEKDAYS.map(d => (
            <div key={d} className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/40 text-center py-1">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-2 sm:gap-2.5">
          {days.map(d => {
            const key = iso(d);
            const s = summaries[key];
            const inMonth = isSameMonth(d, cursor);
            const today = isToday(d);
            const has = s && s.scrumCount > 0;
            return (
              <button
                key={key}
                onClick={() => void openDay(key)}
                className={[
                  'group relative text-left rounded-xl border p-1.5 sm:p-2 min-h-[52px] sm:min-h-[116px] flex flex-col transition-all duration-200',
                  inMonth ? 'bg-card border-border/50' : 'bg-muted/20 border-border/30 opacity-50 hover:opacity-90',
                  // bottom glow to make the cards pop
                  has
                    ? 'border-primary/30 shadow-[0_10px_22px_-10px_hsl(var(--primary)/0.55)] hover:shadow-[0_14px_28px_-10px_hsl(var(--primary)/0.7)] hover:-translate-y-0.5'
                    : 'shadow-[0_6px_14px_-10px_hsl(var(--foreground)/0.5)] hover:border-primary/40 hover:shadow-[0_10px_20px_-10px_hsl(var(--primary)/0.45)] hover:-translate-y-0.5',
                  today ? 'ring-2 ring-primary/40' : '',
                ].join(' ')}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold tabular-nums ${today ? 'text-primary' : 'text-foreground/70'}`}>{format(d, 'd')}</span>
                  {has ? (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-primary bg-primary/10 border border-primary/20 rounded-full px-1.5 py-0.5">
                      <ListChecks className="h-2.5 w-2.5" />{s.scrumCount}
                    </span>
                  ) : (
                    <Sparkles className="h-3 w-3 text-muted-foreground/20 group-hover:text-primary/50 transition-colors" />
                  )}
                </div>
                {has && (
                  <>
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground/70 line-clamp-2 hidden sm:block">
                      {s.summary || `${s.scrumCount} scrum${s.scrumCount > 1 ? 's' : ''}`}
                    </p>
                    <span className="mt-auto hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground/55">
                      <Users className="h-2.5 w-2.5" />{s.memberCount}
                    </span>
                    {/* Mobile: tiny dot marker only (cells are too narrow for text) */}
                    <span className="mt-auto sm:hidden h-1.5 w-1.5 rounded-full bg-primary/70" />
                  </>
                )}
                {/* explicit bottom accent glow bar */}
                {has && <span className="pointer-events-none absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-gradient-to-r from-transparent via-primary/70 to-transparent blur-[1px]" />}
              </button>
            );
          })}
        </div>
        {loadingMonth && <p className="text-center text-xs text-muted-foreground/40 mt-4">Loading…</p>}
      </div>

      {/* Import-from-Teams dialog */}
      <TeamsImportDialog
        open={teamsOpen}
        defaultDate={openDate}
        onClose={() => setTeamsOpen(false)}
        onImported={async () => { await loadMonth(); if (openDate) await loadDay(openDate); }}
      />

      {/* Day dialog */}
      <Dialog open={!!openDate} onOpenChange={o => !o && closeDay()}>
        <DialogContent className="rounded-2xl w-[94vw] max-w-[94vw] sm:w-[75vw] sm:max-w-[75vw]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold">
              <CalendarDays className="h-4 w-4 text-primary/70" />
              {openDate ? format(parseISO(openDate), 'EEEE, d MMMM yyyy') : ''}
            </DialogTitle>
          </DialogHeader>

          {loadingDay ? (
            <div className="py-16 text-center text-sm text-muted-foreground/40">Loading…</div>
          ) : (
            <div className="space-y-4 pt-1">
              {scrums.length === 0 && !adding && (
                <div className="py-8 text-center">
                  <FileText className="h-9 w-9 text-muted-foreground/20 mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground/45">No scrums yet for this day.</p>
                </div>
              )}

              {scrums.map(s => (
                <ScrumCard key={s.id} scrum={s} users={users} onChanged={afterChange} onDeleted={afterChange} />
              ))}

              {adding ? (
                <NewScrumForm
                  date={openDate!}
                  onCancel={() => setAdding(false)}
                  onCreated={async () => { setAdding(false); await afterChange(); }}
                />
              ) : (
                <button
                  onClick={() => setAdding(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add a scrum
                </button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

// ── A single scrum: view (with avatars) / edit raw / edit parsed ──────────────

function ScrumCard({ scrum, users, onChanged, onDeleted }: {
  scrum: Scrum;
  users: User[];
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [mode, setMode] = useState<'view' | 'raw' | 'parsed'>('view');
  const [busy, setBusy] = useState(false);
  const [rawDraft, setRawDraft] = useState(scrum.rawText);
  const [title, setTitle] = useState(scrum.title);
  const [members, setMembers] = useState<MomMember[]>(scrum.members);
  const [summary, setSummary] = useState(scrum.summary);

  const saveRaw = async () => {
    setBusy(true);
    try {
      await api.updateScrum(scrum.id, { title, rawText: rawDraft });
      toast.success('Saved & re-parsed');
      setMode('view');
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setBusy(false); }
  };

  const saveParsed = async () => {
    setBusy(true);
    try {
      const cleaned = members
        .map(m => ({ name: m.name.trim(), items: m.items.map(i => i.trim()).filter(Boolean) }))
        .filter(m => m.name);
      await api.updateScrum(scrum.id, { title, members: cleaned, summary });
      toast.success('Updated');
      setMode('view');
      await onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally { setBusy(false); }
  };

  const reparse = async () => {
    setBusy(true);
    try { await api.reparseScrum(scrum.id); toast.success('Re-parsed'); await onChanged(); }
    catch { toast.error('Could not re-parse'); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await api.deleteScrum(scrum.id); toast.success('Scrum deleted'); await onDeleted(); }
    catch { toast.error('Could not delete'); }
    finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-border/55 bg-card shadow-[0_8px_20px_-14px_hsl(var(--primary)/0.6)]">
      {/* Card header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/35">
        {mode === 'view' ? (
          <h3 className="text-sm font-bold text-foreground truncate">{scrum.title}</h3>
        ) : (
          <input value={title} onChange={e => setTitle(e.target.value)}
            className="flex-1 text-sm font-bold bg-transparent border-b border-border/50 focus:outline-none focus:border-primary/60 pb-0.5" />
        )}
        <div className="flex items-center gap-1 shrink-0">
          {mode === 'view' && (
            <>
              <button onClick={() => { setRawDraft(scrum.rawText); setTitle(scrum.title); setMode('raw'); }}
                title="Edit raw text" className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => { setMembers(scrum.members); setSummary(scrum.summary); setTitle(scrum.title); setMode('parsed'); }}
                title="Edit parsed breakdown" className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-primary transition-colors">
                <ListChecks className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => void remove()} disabled={busy}
                title="Delete scrum" className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {mode !== 'view' && (
            <button onClick={() => setMode('view')} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        <AnimatePresence mode="wait">
          {mode === 'view' && (
            <motion.div key="view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              {scrum.summary && <p className="text-xs text-muted-foreground/75">{scrum.summary}</p>}
              {scrum.parseStatus === 'failed' && (
                <div className="flex items-center justify-between gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <span className="flex items-center gap-1.5"><AlertCircle className="h-3.5 w-3.5" /> Parsing failed.</span>
                  <button onClick={() => void reparse()} disabled={busy} className="shrink-0 px-2 py-1 rounded-md bg-amber-500/20 font-bold hover:bg-amber-500/30 transition-colors disabled:opacity-50">
                    {busy ? '…' : 'Re-parse'}
                  </button>
                </div>
              )}
              {scrum.members.length === 0 ? (
                <p className="text-sm text-muted-foreground/40 italic py-2">No structured updates.</p>
              ) : (
                scrum.members.map((m, i) => {
                  const u = matchUser(m.name, users);
                  return (
                    <div key={`${m.name}-${i}`} className="rounded-xl border border-border/45 bg-muted/15 p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <UserAvatar name={u?.name ?? m.name} avatar={u?.avatar} size="sm" />
                        <h4 className="text-sm font-bold text-foreground">{u?.name ?? m.name}</h4>
                      </div>
                      <ul className="space-y-1.5 pl-0.5">
                        {m.items.map((it, j) => (
                          <li key={j} className="flex items-start gap-2 text-sm text-muted-foreground/85 leading-snug">
                            <Check className="h-3.5 w-3.5 text-primary/60 shrink-0 mt-0.5" /><span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })
              )}
              {scrum.updatedByName && (
                <p className="text-[11px] text-muted-foreground/40">Updated by {scrum.updatedByName}</p>
              )}
            </motion.div>
          )}

          {mode === 'raw' && (
            <motion.div key="raw" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <p className="text-xs text-muted-foreground/55">Edit the raw notes — saving re-runs the AI agent.</p>
              <textarea value={rawDraft} onChange={e => setRawDraft(e.target.value)} rows={12}
                placeholder="Paste meeting notes…"
                className="w-full px-3.5 py-3 text-sm rounded-xl border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50 resize-y leading-relaxed font-mono" />
              <div className="flex justify-end gap-2">
                <button onClick={() => setMode('view')} className="px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-sm hover:bg-muted/60 transition-colors">Cancel</button>
                <button onClick={() => void saveRaw()} disabled={busy}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                  <Sparkles className="h-3.5 w-3.5" />{busy ? 'Parsing…' : 'Save & parse'}
                </button>
              </div>
            </motion.div>
          )}

          {mode === 'parsed' && (
            <motion.div key="parsed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
              <p className="text-xs text-muted-foreground/55">Hand-edit the parsed breakdown. One bullet per line.</p>
              <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="Summary"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50" />
              {members.map((m, mi) => (
                <div key={mi} className="rounded-xl border border-border/45 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input value={m.name}
                      onChange={e => setMembers(ms => ms.map((x, i) => i === mi ? { ...x, name: e.target.value } : x))}
                      placeholder="Person name"
                      className="flex-1 px-2.5 py-1.5 text-sm font-semibold rounded-lg border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50" />
                    <button onClick={() => setMembers(ms => ms.filter((_, i) => i !== mi))}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea value={m.items.join('\n')}
                    onChange={e => setMembers(ms => ms.map((x, i) => i === mi ? { ...x, items: e.target.value.split('\n') } : x))}
                    rows={Math.max(2, m.items.length)} placeholder="One update per line"
                    className="w-full px-2.5 py-2 text-sm rounded-lg border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50 resize-y leading-relaxed" />
                </div>
              ))}
              <button onClick={() => setMembers(ms => [...ms, { name: '', items: [] }])}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-dashed border-border/60 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                <Plus className="h-3 w-3" /> Add person
              </button>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setMode('view')} className="px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-sm hover:bg-muted/60 transition-colors">Cancel</button>
                <button onClick={() => void saveParsed()} disabled={busy}
                  className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Import from Teams dialog ──────────────────────────────────────────────────

function TeamsImportDialog({ open, defaultDate, onClose, onImported }: {
  open: boolean;
  defaultDate: string | null;
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [joinUrl, setJoinUrl] = useState('');
  const [busy, setBusy] = useState<'import' | 'sync' | null>(null);

  useEffect(() => {
    if (!open) return;
    setJoinUrl('');
  }, [open]);

  const doImport = async () => {
    if (!joinUrl.trim()) {
      toast.error('Teams meeting link is required');
      return;
    }
    setBusy('import');
    try {
      // 1. Initialize MSAL client
      const pca = new PublicClientApplication({
        auth: {
          clientId: getMicrosoftClientId(),
          authority: `https://login.microsoftonline.com/${getMicrosoftTenantId()}`,
          redirectUri: window.location.origin + '/',
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        }
      });
      await pca.initialize();

      // 2. Fetch the cached Microsoft account
      const accounts = pca.getAllAccounts();
      const account = accounts[0] || null;

      // 3. Request delegated Graph token with meeting scopes
      const tokenRequest = {
        scopes: [
          'https://graph.microsoft.com/OnlineMeetings.Read',
          'https://graph.microsoft.com/OnlineMeetingTranscript.Read.All'
        ],
        account: account,
      };
      
      let authResult;
      try {
        if (!account) {
          throw new Error('No active Microsoft session found. Falling back to interactive login.');
        }
        authResult = await pca.acquireTokenSilent(tokenRequest);
      } catch (err) {
        console.log("DEBUG: acquireTokenSilent failed or no active session. Triggering acquireTokenPopup...", err);
        authResult = await pca.acquireTokenPopup({
          scopes: tokenRequest.scopes
        });
      }
      const token = authResult.accessToken;

      // 4. Resolve Meeting ID from join URL
      const urlFilter = encodeURIComponent(joinUrl.trim());
      const meetingReqUrl = `https://graph.microsoft.com/v1.0/me/onlineMeetings?$filter=joinWebUrl eq '${urlFilter}'`;
      
      console.log("DEBUG: Requesting URL:", meetingReqUrl);

      // Try the raw /me/onlineMeetings to log the exact 400 Bad Request payload
      try {
        const rawRes = await fetch("https://graph.microsoft.com/v1.0/me/onlineMeetings", {
          headers: { Authorization: `Bearer ${token}` }
        });
        const rawBody = await rawRes.text();
        console.log("DEBUG: Raw /me/onlineMeetings response status:", rawRes.status);
        console.log("DEBUG: Raw /me/onlineMeetings response body:", rawBody);
      } catch (err) {
        console.error("DEBUG: Failed to query raw /me/onlineMeetings:", err);
      }

      const meetingRes = await fetch(meetingReqUrl, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!meetingRes.ok) {
        const errBody = await meetingRes.text();
        console.error(`DEBUG: meetingRes failed with status ${meetingRes.status}. Body:`, errBody);
        throw new Error(`Could not find meeting on Microsoft Graph (Status ${meetingRes.status}).`);
      }
      
      const meetingData = await meetingRes.json();
      const meetingId = meetingData.value?.[0]?.id;
      if (!meetingId) {
        console.warn("DEBUG: Resolved meeting list is empty for join URL. Response payload:", meetingData);
        throw new Error('Teams meeting could not be resolved from this URL.');
      }

      // 5. Get transcript ID
      const transcriptsRes = await fetch(
        `https://graph.microsoft.com/me/onlineMeetings/${meetingId}/transcripts`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!transcriptsRes.ok) throw new Error('Could not retrieve transcripts list.');
      const transcriptsData = await transcriptsRes.json();
      const transcriptId = transcriptsData.value?.[0]?.id;
      if (!transcriptId) throw new Error('No transcripts found. Ensure transcription was turned on.');

      // 6. Download WebVTT content
      const contentRes = await fetch(
        `https://graph.microsoft.com/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!contentRes.ok) throw new Error('Could not download transcript content.');
      const vttContent = await contentRes.text();

      // 7. Post raw WebVTT content to existing backend parser
      const backendRes = await fetch(`${getApiUrl()}/meeting-notes/process-transcript`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('tm_token')}`
        },
        body: JSON.stringify({ transcript: vttContent })
      });

      if (!backendRes.ok) {
        const errJson = await backendRes.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to process transcript on the backend.');
      }

      toast.success('Transcript imported and parsed successfully!');
      await onImported();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Import failed');
    } finally {
      setBusy(null);
    }
  };

  const doSync = async () => {
    setBusy('sync');
    try {
      // 1. Initialize MSAL client
      const pca = new PublicClientApplication({
        auth: {
          clientId: getMicrosoftClientId(),
          authority: `https://login.microsoftonline.com/${getMicrosoftTenantId()}`,
          redirectUri: window.location.origin + '/',
        },
        cache: {
          cacheLocation: 'sessionStorage',
          storeAuthStateInCookie: false,
        }
      });
      await pca.initialize();

      // 2. Fetch the cached Microsoft account
      const accounts = pca.getAllAccounts();
      const account = accounts[0] || null;

      // 3. Request delegated Graph token with meeting scopes
      const tokenRequest = {
        scopes: [
          'https://graph.microsoft.com/OnlineMeetings.Read',
          'https://graph.microsoft.com/OnlineMeetingTranscript.Read.All'
        ],
        account: account,
      };
      
      let authResult;
      try {
        if (!account) {
          throw new Error('No active Microsoft session found. Falling back to interactive login.');
        }
        authResult = await pca.acquireTokenSilent(tokenRequest);
      } catch (err) {
        console.log("DEBUG: acquireTokenSilent failed or no active session for sync. Triggering acquireTokenPopup...", err);
        authResult = await pca.acquireTokenPopup({
          scopes: tokenRequest.scopes
        });
      }
      const token = authResult.accessToken;

      // 4. Get current user's object ID to call getAllTranscripts
      const meRes = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!meRes.ok) throw new Error('Could not retrieve Microsoft user profile.');
      const meData = await meRes.json();
      const myId = meData.id;

      // 5. Fetch all transcripts across user's meetings
      const allTranscriptsRes = await fetch(
        `https://graph.microsoft.com/beta/me/onlineMeetings/getAllTranscripts(meetingOrganizerUserId='${myId}')`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!allTranscriptsRes.ok) throw new Error('Could not retrieve all transcripts.');
      const allTranscriptsData = await allTranscriptsRes.json();
      const transcriptsList = allTranscriptsData.value || [];

      if (transcriptsList.length === 0) {
        toast.info('No transcripts found across your meetings.');
        return;
      }

      // 6. Process each transcript and post to backend
      let importedCount = 0;
      for (const t of transcriptsList) {
        const meetingId = t.meetingId;
        const transcriptId = t.id;
        if (!meetingId || !transcriptId) continue;

        try {
          const contentRes = await fetch(
            `https://graph.microsoft.com/me/onlineMeetings/${meetingId}/transcripts/${transcriptId}/content`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!contentRes.ok) continue;
          const vtt = await contentRes.text();
          if (!vtt.trim()) continue;

          const backendRes = await fetch(`${getApiUrl()}/meeting-notes/process-transcript`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${localStorage.getItem('tm_token')}`
            },
            body: JSON.stringify({ transcript: vtt })
          });
          if (backendRes.ok) {
            importedCount++;
          }
        } catch (itemErr) {
          console.warn(`Failed to sync individual transcript ${transcriptId}:`, itemErr);
        }
      }

      toast.success(`Successfully synced all new transcripts! Imported ${importedCount} scrums.`);
      await onImported();
      onClose();
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || 'Sync failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="rounded-2xl w-[94vw] max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Video className="h-4 w-4 text-primary/70" /> Import from Teams
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/60">Teams meeting link</label>
            <input value={joinUrl} onChange={e => setJoinUrl(e.target.value)} placeholder="https://teams.microsoft.com/l/meetup-join/…"
              className="mt-1 w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50 font-mono text-xs" />
          </div>
          <p className="text-[11px] text-muted-foreground/55 leading-relaxed">
            Pulls the meeting's Teams transcript via your logged-in Microsoft account, then structures it per person automatically.
            <strong className="text-foreground/70"> Transcription must have been on</strong> for the meeting.
          </p>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button onClick={() => void doSync()} disabled={!!busy}
              title="Pull every new transcript for this organizer"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-xs font-semibold hover:bg-muted/60 transition-colors disabled:opacity-50">
              {busy === 'sync' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListChecks className="h-3.5 w-3.5" />}
              Sync all new
            </button>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-sm hover:bg-muted/60 transition-colors">Cancel</button>
              <button onClick={() => void doImport()} disabled={!!busy}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
                {busy === 'import' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
                {busy === 'import' ? 'Importing…' : 'Import meeting'}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── New scrum form ────────────────────────────────────────────────────────────

function NewScrumForm({ date, onCancel, onCreated }: {
  date: string;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState('Daily Scrum');
  const [raw, setRaw] = useState('');
  const [busy, setBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { toast.error('Recording not supported in this browser'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        const ext = (rec.mimeType || 'audio/webm').includes('mp4') ? 'mp4' : 'webm';
        void transcribe(new File([blob], `scrum-recording.${ext}`, { type: blob.type }));
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch {
      toast.error('Microphone permission denied');
    }
  };

  const stopRecording = () => {
    stopTimer();
    setRecording(false);
    recorderRef.current?.stop();
  };

  useEffect(() => () => { stopTimer(); recorderRef.current?.stop(); }, []);

  const transcribe = async (file: File) => {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|m4a|webm|ogg|oga|flac|mp4|mpeg|mpga|aac)$/i.test(file.name)) {
      toast.error('Drop an audio file');
      return;
    }
    setTranscribing(true);
    try {
      const { text } = await api.transcribeScrumAudio(file);
      // Append to whatever's already typed so a recording adds to notes, not clobbers.
      setRaw(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      toast.success('Audio transcribed — review, then add & parse');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not transcribe audio');
    } finally { setTranscribing(false); }
  };

  const create = async () => {
    if (!raw.trim()) { toast.error('Paste notes or drop an audio file first'); return; }
    setBusy(true);
    try {
      await api.createScrum(date, title.trim() || 'Scrum', raw);
      toast.success('Scrum added & parsed');
      await onCreated();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add scrum');
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/[0.03] p-4 space-y-3">
      <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Scrum title (e.g. Daily Standup)"
        className="w-full px-3 py-2 text-sm font-semibold rounded-lg border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50" />

      {/* Audio: record in-browser OR drop/upload a file — both go through Whisper */}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => (recording ? stopRecording() : void startRecording())}
          disabled={transcribing}
          className={[
            'flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-xs font-semibold transition-colors shrink-0 disabled:opacity-50',
            recording
              ? 'border-red-500/60 bg-red-500/15 text-red-400 hover:bg-red-500/25'
              : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary',
          ].join(' ')}
        >
          {recording
            ? <><Square className="h-3.5 w-3.5 fill-current" /> Stop · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</>
            : <><Mic className="h-3.5 w-3.5" /> Record</>}
        </button>
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) void transcribe(f); }}
          onClick={() => !transcribing && !recording && fileInput.current?.click()}
          className={[
            'flex-1 flex items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs font-semibold cursor-pointer transition-colors',
            dragOver ? 'border-primary bg-primary/10 text-primary' : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:text-primary',
            (transcribing || recording) ? 'opacity-60 pointer-events-none' : '',
          ].join(' ')}
        >
          {transcribing
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Transcribing audio…</>
            : <><FileText className="h-3.5 w-3.5" /> Drop or click to upload an audio file</>}
        </div>
      </div>
      <input ref={fileInput} type="file" accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.oga,.flac,.mp4,.aac"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) void transcribe(f); e.target.value = ''; }} />

      <textarea autoFocus value={raw} onChange={e => setRaw(e.target.value)} rows={10}
        placeholder="Paste the raw scrum / meeting notes here — or drop an audio file above to transcribe…"
        className="w-full px-3.5 py-3 text-sm rounded-xl border border-border/60 bg-background/60 focus:outline-none focus:border-primary/50 resize-y leading-relaxed font-mono" />
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-2 rounded-xl border border-border/60 bg-muted/30 text-sm hover:bg-muted/60 transition-colors">Cancel</button>
        <button onClick={() => void create()} disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
          <Sparkles className="h-3.5 w-3.5" />{busy ? 'Parsing…' : 'Add & parse'}
        </button>
      </div>
    </div>
  );
}
