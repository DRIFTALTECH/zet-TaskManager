import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Download, Plus, Bell, Send,
  Trash2, MoreVertical, EyeOff, RotateCcw, Clock, CalendarDays,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import type { TimesheetWorkEntry } from '@/types';
import { api } from '@/lib/api';

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];


// ── Stable color palette for project / section pills ─────────────────────────
const ID_PILL_PALETTES = [
  'bg-blue-500/15 text-blue-400 border-blue-500/25',
  'bg-violet-500/15 text-violet-400 border-violet-500/25',
  'bg-emerald-500/15 text-emerald-400 border-emerald-500/25',
  'bg-orange-500/15 text-orange-400 border-orange-500/25',
  'bg-pink-500/15 text-pink-400 border-pink-500/25',
  'bg-teal-500/15 text-teal-400 border-teal-500/25',
  'bg-amber-500/15 text-amber-400 border-amber-500/25',
  'bg-cyan-500/15 text-cyan-400 border-cyan-500/25',
  'bg-indigo-500/15 text-indigo-400 border-indigo-500/25',
  'bg-rose-500/15 text-rose-400 border-rose-500/25',
];
function idPillColor(id: string): string {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ID_PILL_PALETTES[h % ID_PILL_PALETTES.length];
}

// ── Helpers ───────────────────────────────────────────────────────────────────
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
function dayHideKey(weekOffset: number, iso: string): string { return `${weekOffset}|${iso}`; }
function compactTimeToApi(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 0) throw new Error('empty');
  const p = digits.padStart(4, '0');
  if (p.length > 4) throw new Error('invalid');
  const h = parseInt(p.slice(0, 2), 10);
  const mm = parseInt(p.slice(2), 10);
  if (h > 23 || mm > 59) throw new Error('invalid');
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function apiTimeToCompactDisplay(iso: string): string {
  const m = iso.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '0900';
  return `${m[1].padStart(2, '0')}${m[2]}`;
}
function formatDuration(seconds: number) {
  if (seconds <= 0) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type EntryModalState = null | { mode: 'new'; date: string } | { mode: 'edit'; entry: TimesheetWorkEntry };

const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';
const textareaCls = `${inputCls} resize-y min-h-[72px] break-words [overflow-wrap:anywhere] [word-break:break-word]`;

// ═══════════════════════════════════════════════════════════════════════════════
const TimesheetPage = () => {
  const { currentUser, projects, users } = useAppStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  const [entryModal, setEntryModal] = useState<EntryModalState>(null);
  const [formProjectId, setFormProjectId] = useState('');
  const [formSectionId, setFormSectionId] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formTimeFrom, setFormTimeFrom] = useState('');
  const [formTimeTo, setFormTimeTo] = useState('');
  const [saving, setSaving] = useState(false);

  const [hiddenDayKeys, setHiddenDayKeys] = useState<Set<string>>(() => new Set());
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyRecipient, setNotifyRecipient] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [entryToDelete, setEntryToDelete] = useState<TimesheetWorkEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);

  const todayStr = localISODate(new Date());
  const weekDates = getWeekDates(weekOffset);
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const visibleWeekDates = weekDates.filter(d => d <= todayStr);

  const userProjects = useMemo(
    () => (currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : []),
    [projects, currentUser],
  );

  const reloadEntries = useCallback(async () => {
    setLoadingEntries(true);
    try {
      const list = await api.getTimesheetWorkEntries(weekStart, weekEnd);
      setEntries(list);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not load timesheet'); }
    finally { setLoadingEntries(false); }
  }, [weekStart, weekEnd]);

  useEffect(() => { void reloadEntries(); }, [reloadEntries]);

  const weekTotalSeconds = useMemo(
    () => entries.filter(e => e.workDate <= todayStr).reduce((a, e) => a + e.seconds, 0),
    [entries, todayStr],
  );

  const dayView = useMemo(
    () => visibleWeekDates
      .map(date => {
        const idx = weekDates.indexOf(date);
        const entriesForDay = entries.filter(e => e.workDate === date);
        const totalSeconds = entriesForDay.reduce((a, e) => a + e.seconds, 0);
        return { date, dayName: dayNames[idx] ?? '', dayShortName: dayShort[idx] ?? '', entriesForDay, totalSeconds };
      })
      .sort((a, b) => b.date.localeCompare(a.date)),
    [visibleWeekDates, entries, weekDates],
  );

  const visibleDays = useMemo(
    () => dayView.filter(d => !hiddenDayKeys.has(dayHideKey(weekOffset, d.date))),
    [dayView, hiddenDayKeys, weekOffset],
  );

  const hiddenCountThisWeek = useMemo(
    () => dayView.filter(d => hiddenDayKeys.has(dayHideKey(weekOffset, d.date))).length,
    [dayView, hiddenDayKeys, weekOffset],
  );

  const resetForm = () => { setFormProjectId(''); setFormSectionId(''); setFormDescription(''); setFormTimeFrom(''); setFormTimeTo(''); };

  const openNewModal = (workDate: string) => { resetForm(); setEntryModal({ mode: 'new', date: workDate }); };
  const openEditModal = (entry: TimesheetWorkEntry) => {
    setFormProjectId(entry.projectId);
    setFormSectionId(entry.sectionId);
    setFormDescription(entry.description);
    setFormTimeFrom(apiTimeToCompactDisplay(entry.timeFrom));
    setFormTimeTo(apiTimeToCompactDisplay(entry.timeTo));
    setEntryModal({ mode: 'edit', entry });
  };
  const closeEntryModal = () => { setEntryModal(null); resetForm(); };

  const toggleHideDay = (date: string) => {
    const k = dayHideKey(weekOffset, date);
    setHiddenDayKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const showAllDaysThisWeek = () => {
    setHiddenDayKeys(prev => {
      const next = new Set(prev);
      for (const d of dayView) next.delete(dayHideKey(weekOffset, d.date));
      return next;
    });
  };

  const saveEntry = async () => {
    if (!entryModal) return;
    if (!formProjectId || !formSectionId) { toast.error('Select a project and section'); return; }
    let timeFromApi: string; let timeToApi: string;
    try { timeFromApi = compactTimeToApi(formTimeFrom); timeToApi = compactTimeToApi(formTimeTo); }
    catch { toast.error('Enter valid start and end times (four digits each, 24h).'); return; }
    setSaving(true);
    try {
      if (entryModal.mode === 'new') {
        await api.createTimesheetWorkEntry({ workDate: entryModal.date, projectId: formProjectId, sectionId: formSectionId, description: formDescription, timeFrom: timeFromApi, timeTo: timeToApi });
        toast.success('Entry saved');
      } else {
        await api.patchTimesheetWorkEntry(entryModal.entry.id, { workDate: entryModal.entry.workDate, projectId: formProjectId, sectionId: formSectionId, description: formDescription, timeFrom: timeFromApi, timeTo: timeToApi });
        toast.success('Entry updated');
      }
      await reloadEntries();
      closeEntryModal();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSaving(false); }
  };

  const confirmDeleteEntry = async () => {
    if (!entryToDelete) return;
    setDeletingEntry(true);
    try {
      await api.deleteTimesheetWorkEntry(entryToDelete.id);
      toast.success('Entry removed');
      if (entryModal?.mode === 'edit' && entryModal.entry.id === entryToDelete.id) closeEntryModal();
      setEntryToDelete(null);
      await reloadEntries();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete'); }
    finally { setDeletingEntry(false); }
  };

  if (!currentUser) return null;

  const defaultNewDate = visibleWeekDates.includes(todayStr) ? todayStr : (visibleWeekDates[visibleWeekDates.length - 1] ?? weekDates[0]);

  const exportCSV = () => {
    const header = ['Date', 'Description', 'Project', 'Section', 'From', 'To', 'Duration'].join(',');
    const rows = entries.map(e => {
      const project = projects.find(p => p.id === e.projectId);
      const section = project?.sections.find(s => s.id === e.sectionId);
      const desc = (e.description || '').replace(/"/g, '""');
      return [formatDisplayDate(e.workDate), `"${desc}"`, project?.name ?? '', section?.name ?? '', e.timeFrom, e.timeTo, formatDuration(e.seconds)].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `timesheet_${weekStart}_${weekEnd}.csv`; a.click();
    toast.success('Timesheet exported');
  };

  const toggleDay = (date: string) => setSelectedDays(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]);

  const handleNotify = () => {
    if (!notifyRecipient) return toast.error('Select a recipient');
    if (selectedDays.length === 0) return toast.error('Select at least one day');
    toast.success(`Schedule sent to ${users.find(u => u.id === notifyRecipient)?.name || 'recipient'}`);
    setNotifyOpen(false); setSelectedDays([]); setNotifyRecipient('');
  };

  const scheduleSummary = selectedDays.sort().map(date => dayView.find(d => d.date === date)).filter(Boolean);

  const weekLabel = visibleWeekDates.length > 0
    ? `${formatDisplayDate(visibleWeekDates[0])} — ${formatDisplayDate(visibleWeekDates[visibleWeekDates.length - 1])}`
    : `${formatDisplayDate(weekStart)} — ${formatDisplayDate(weekEnd)}`;

  const selectedProject = userProjects.find(p => p.id === formProjectId);
  const sectionOptions = selectedProject?.sections ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0"
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-8 pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Work Log</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Timesheet
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              Log work by day — entries ordered newest first
            </p>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2.5 mt-1 flex-wrap">
            <motion.button
              transition={snappy}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              disabled={userProjects.length === 0}
              onClick={() => openNewModal(defaultNewDate)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all font-semibold shadow-sm"
            >
              <Plus className="h-4 w-4" /> Log time
            </motion.button>
            <motion.button
              transition={snappy}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => {
                setSelectedDays(visibleWeekDates.filter(d => (dayView.find(dv => dv.date === d)?.totalSeconds ?? 0) > 0));
                setNotifyOpen(true);
              }}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/50 hover:border-border/80 transition-all text-muted-foreground hover:text-foreground font-medium"
            >
              <Bell className="h-4 w-4" /> Notify
            </motion.button>
            <motion.button
              transition={snappy}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={exportCSV}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/50 hover:border-border/80 transition-all text-muted-foreground hover:text-foreground font-medium"
            >
              <Download className="h-4 w-4" /> Export
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-8 space-y-6">

        {/* ── Week navigation bar ─────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 p-4 rounded-2xl border border-border/35 bg-card shadow-sm">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setWeekOffset(w => w - 1)}
              className="p-2 rounded-xl border border-border/40 hover:bg-muted/60 hover:border-border/70 hover:text-primary text-muted-foreground transition-all"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-2 min-w-0 px-1">
              <CalendarDays className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              <span className="text-sm font-semibold tabular-nums text-foreground">{weekLabel}</span>
              {loadingEntries && (
                <div className="w-3.5 h-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin shrink-0" />
              )}
            </div>

            <button
              type="button"
              onClick={() => setWeekOffset(w => Math.min(0, w + 1))}
              disabled={weekOffset >= 0}
              className="p-2 rounded-xl border border-border/40 hover:bg-muted/60 hover:border-border/70 hover:text-primary text-muted-foreground transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="h-4 w-4" />
            </button>

            {weekOffset !== 0 && (
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="text-xs font-semibold text-primary hover:text-primary/80 px-2.5 py-1 rounded-lg hover:bg-primary/10 transition-colors"
              >
                This week
              </button>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {hiddenCountThisWeek > 0 && (
              <button
                type="button"
                onClick={showAllDaysThisWeek}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border border-border/50 hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-all font-medium"
              >
                <RotateCcw className="h-3 w-3" />
                Show {hiddenCountThisWeek} hidden day{hiddenCountThisWeek !== 1 ? 's' : ''}
              </button>
            )}

            {/* Week total */}
            <div className="flex items-center gap-2.5 bg-primary/8 border border-primary/20 rounded-xl px-4 py-2">
              <span className="text-[11px] font-bold text-primary/70 uppercase tracking-wide">Week</span>
              <span className="text-lg font-bold tabular-nums text-foreground">{formatDuration(weekTotalSeconds)}</span>
            </div>
          </div>
        </div>

        {/* ── No project warning ───────────────────────────────────────────── */}
        {userProjects.length === 0 && (
          <div className="rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm text-amber-400/80">
            You are not in any project yet. Ask a manager to add you, then you can log work by project and section.
          </div>
        )}

        {/* ── Day cards ───────────────────────────────────────────────────── */}
        {visibleWeekDates.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/40 bg-muted/10 px-6 py-10 text-center text-sm text-muted-foreground/50">
            No days in this range — future days are hidden.
          </div>
        ) : visibleDays.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/40 bg-muted/10 px-6 py-12 text-center space-y-3">
            <EyeOff className="h-8 w-8 text-muted-foreground/25 mx-auto" />
            <p className="text-sm text-muted-foreground/50">Every day this week is hidden from view.</p>
            <button
              type="button"
              onClick={showAllDaysThisWeek}
              className="text-sm text-primary hover:text-primary/80 font-semibold transition-colors"
            >
              Show all days
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {visibleDays.map((day, idx) => {
                const isToday = day.date === todayStr;
                return (
                  <motion.section
                    key={day.date}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    transition={{ ...pageEnter, delay: idx * 0.04 }}
                    className="rounded-2xl border border-border/30 overflow-hidden bg-card shadow-sm hover:shadow-md transition-shadow duration-200"
                  >
                    {/* Day header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-border/20 bg-muted/10">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex items-baseline gap-2.5 min-w-0">
                          <h2 className="text-sm font-bold text-foreground">{day.dayName}</h2>
                          <span className="text-xs font-mono text-muted-foreground/60 tabular-nums">{formatDisplayDate(day.date)}</span>
                          {isToday && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20 font-bold">Today</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Day total */}
                        <span className={`text-sm font-bold tabular-nums px-3 py-1 rounded-xl border ${
                          day.totalSeconds > 0
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : 'text-muted-foreground/40 bg-muted/30 border-border/30'
                        }`}>
                          {day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : '0m'}
                        </span>

                        <button
                          type="button"
                          onClick={() => toggleHideDay(day.date)}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60 transition-all font-medium"
                        >
                          <EyeOff className="h-3.5 w-3.5" /> Hide
                        </button>

                        <button
                          type="button"
                          disabled={userProjects.length === 0}
                          onClick={() => openNewModal(day.date)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border border-border/40 bg-muted/30 hover:bg-primary/8 hover:border-primary/30 hover:text-primary text-muted-foreground transition-all disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" /> Add
                        </button>
                      </div>
                    </div>

                    {/* Entries */}
                    {day.entriesForDay.length === 0 ? (
                      <div className="px-5 py-7 text-center text-sm text-muted-foreground/40 italic">
                        Nothing logged yet —{' '}
                        <button
                          onClick={() => openNewModal(day.date)}
                          disabled={userProjects.length === 0}
                          className="font-semibold text-primary/60 hover:text-primary transition-colors disabled:opacity-40 hover:underline"
                        >
                          add an entry
                        </button>
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/20">
                        {day.entriesForDay.map(entry => {
                          const project = projects.find(p => p.id === entry.projectId);
                          const section = project?.sections.find(s => s.id === entry.sectionId);
                          return (
                            <li
                              key={entry.id}
                              className="flex flex-col sm:flex-row sm:items-start gap-3 px-5 py-4 hover:bg-muted/20 transition-colors group"
                            >
                              {/* Time block */}
                              <div className="flex items-center gap-2.5 shrink-0">
                                <div className="flex flex-col items-center gap-0.5">
                                  <span className="inline-flex items-center rounded-xl border border-border/40 bg-muted/30 px-3 py-1 font-mono text-xs tabular-nums font-semibold text-foreground/70">
                                    {entry.timeFrom} – {entry.timeTo}
                                  </span>
                                  <span className="text-xs font-bold tabular-nums text-foreground/70">
                                    {formatDuration(entry.seconds)}
                                  </span>
                                </div>
                              </div>

                              {/* Content */}
                              <div className="min-w-0 flex-1 space-y-1.5">
                                <p className="text-sm text-foreground leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                                  {entry.description?.trim()
                                    ? entry.description
                                    : <span className="text-muted-foreground/40 italic">No description</span>
                                  }
                                </p>
                                <div className="flex flex-wrap gap-1.5">
                                  <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-semibold max-w-full break-words [overflow-wrap:anywhere] ${idPillColor(entry.projectId)}`}>
                                    {project?.name ?? entry.projectId}
                                  </span>
                                  {section && (
                                    <span className={`text-[11px] px-2.5 py-0.5 rounded-full border font-medium max-w-full break-words [overflow-wrap:anywhere] opacity-80 ${idPillColor(entry.sectionId)}`}>
                                      {section.name}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Actions */}
                              <div className="shrink-0 self-start sm:self-center opacity-0 group-hover:opacity-100 transition-opacity">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      className="p-2 rounded-xl hover:bg-muted/60 text-muted-foreground/50 hover:text-foreground transition-all"
                                      aria-label="Entry actions"
                                    >
                                      <MoreVertical className="h-4 w-4" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-40 rounded-xl">
                                    <DropdownMenuItem
                                      onClick={() => openEditModal(entry)}
                                      className="rounded-lg cursor-pointer hover:text-primary transition-colors"
                                    >
                                      Edit
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive rounded-lg cursor-pointer"
                                      onClick={() => setEntryToDelete(entry)}
                                    >
                                      Delete
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </motion.section>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* ── Log / Edit Entry Modal ────────────────────────────────────────── */}
      <Dialog open={!!entryModal} onOpenChange={o => { if (!o) closeEntryModal(); }}>
        <DialogContent className="sm:max-w-lg max-h-[min(90vh,640px)] overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">
              {entryModal?.mode === 'edit' ? 'Edit entry' : 'Log time'}
            </DialogTitle>
            {entryModal?.mode === 'new' && (
              <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">{formatDisplayDate(entryModal.date)}</p>
            )}
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="ts-desc">Description</Label>
              <textarea
                id="ts-desc"
                rows={3}
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="What did you work on?"
                className={textareaCls}
                disabled={saving}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="ts-project">Project</Label>
                <select
                  id="ts-project"
                  value={formProjectId}
                  onChange={e => {
                    const pid = e.target.value;
                    setFormProjectId(pid);
                    const p = userProjects.find(x => x.id === pid);
                    setFormSectionId(prev => {
                      if (!p?.sections.length) return '';
                      if (!prev) return p.sections[0].id;
                      return p.sections.some(s => s.id === prev) ? prev : p.sections[0].id;
                    });
                  }}
                  className={inputCls}
                  disabled={saving}
                >
                  {entryModal?.mode === 'new' && <option value="">Choose project…</option>}
                  {userProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 min-w-0">
                <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="ts-section">Section</Label>
                <select
                  id="ts-section"
                  value={formSectionId}
                  onChange={e => setFormSectionId(e.target.value)}
                  className={inputCls}
                  disabled={saving || !formProjectId || sectionOptions.length === 0}
                >
                  <option value="">{formProjectId ? 'Choose section…' : 'Pick a project first'}</option>
                  {sectionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="ts-from">Start time</Label>
                <input
                  id="ts-from"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="0900"
                  value={formTimeFrom}
                  onChange={e => setFormTimeFrom(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${inputCls} font-mono tabular-nums tracking-widest`}
                  disabled={saving}
                />
                <p className="text-[10px] text-muted-foreground/40">24h format, e.g. 0930</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="ts-to">End time</Label>
                <input
                  id="ts-to"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder="1730"
                  value={formTimeTo}
                  onChange={e => setFormTimeTo(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${inputCls} font-mono tabular-nums tracking-widest`}
                  disabled={saving}
                />
                <p className="text-[10px] text-muted-foreground/40">24h format, e.g. 1730</p>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 mt-2 flex-col sm:flex-row">
            <button
              type="button"
              onClick={closeEntryModal}
              disabled={saving}
              className="text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/50 transition-all text-muted-foreground hover:text-foreground font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void saveEntry()}
              disabled={saving}
              className="text-sm px-5 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all font-semibold shadow-sm"
            >
              {saving ? 'Saving…' : entryModal?.mode === 'edit' ? 'Update entry' : 'Save entry'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Notify Modal ─────────────────────────────────────────────────── */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-lg rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Notify schedule</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 pt-1">
            <div>
              <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-2.5">Select days</p>
              <div className="flex flex-wrap gap-2">
                {[...visibleWeekDates].sort((a, b) => b.localeCompare(a)).map(date => {
                  const i = weekDates.indexOf(date);
                  const isSelected = selectedDays.includes(date);
                  return (
                    <motion.button
                      key={date}
                      type="button"
                      transition={snappy}
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => toggleDay(date)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                        isSelected
                          ? 'bg-primary/15 text-primary border-primary/30 shadow-sm'
                          : 'bg-muted/40 border-border/40 text-muted-foreground hover:bg-muted/70 hover:border-border/60'
                      }`}
                    >
                      {dayShort[i] ?? ''} {formatDisplayDate(date)}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-2.5">Send to</p>
              <select
                value={notifyRecipient}
                onChange={e => setNotifyRecipient(e.target.value)}
                className={inputCls}
              >
                <option value="">Select recipient…</option>
                {users.filter(u => u.id !== currentUser.id).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>

            {scheduleSummary.length > 0 && (
              <div className="rounded-xl border border-border/35 bg-muted/10 p-4 max-h-[260px] overflow-y-auto space-y-3">
                <h4 className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Preview</h4>
                {scheduleSummary.map(d => d && (
                  <div key={d.date} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 min-w-0">
                      <span className="text-sm font-bold">
                        {d.dayName}{' '}
                        <span className="text-xs font-normal text-muted-foreground/60">{formatDisplayDate(d.date)}</span>
                      </span>
                      <span className="text-xs font-bold shrink-0 text-primary">{formatDuration(d.totalSeconds)}</span>
                    </div>
                    {d.entriesForDay.length > 0 ? d.entriesForDay.map(en => {
                      const project = projects.find(p => p.id === en.projectId);
                      const section = project?.sections.find(s => s.id === en.sectionId);
                      return (
                        <div key={en.id} className="flex items-start justify-between pl-3 gap-2 text-xs text-muted-foreground/60">
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                            {en.description?.trim() || '(no description)'} · {project?.name}{section ? ` · ${section.name}` : ''} · {en.timeFrom}–{en.timeTo}
                          </span>
                          <span className="font-mono shrink-0 text-foreground/60">{formatDuration(en.seconds)}</span>
                        </div>
                      );
                    }) : (
                      <p className="pl-3 text-xs text-muted-foreground/40 italic">No activity logged</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 mt-2">
            <Button variant="ghost" onClick={() => setNotifyOpen(false)} className="rounded-xl">Cancel</Button>
            <button
              onClick={handleNotify}
              disabled={!notifyRecipient || selectedDays.length === 0}
              className="flex items-center gap-2 text-sm px-5 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all font-semibold"
            >
              <Send className="h-3.5 w-3.5" /> Send
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Entry Confirmation ─────────────────────────────────────── */}
      <AlertDialog open={!!entryToDelete} onOpenChange={o => !o && setEntryToDelete(null)}>
        <AlertDialogContent className="max-w-[min(100%,24rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
              {entryToDelete && (
                <>
                  Removes the entry for{' '}
                  <span className="font-mono text-foreground">{formatDisplayDate(entryToDelete.workDate)}</span>.
                  {entryToDelete.description?.trim() && (
                    <> &quot;{entryToDelete.description.slice(0, 100)}{entryToDelete.description.length > 100 ? '…' : ''}&quot;</>
                  )}
                  {' '}This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingEntry}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingEntry}
              onClick={e => { e.preventDefault(); void confirmDeleteEntry(); }}
            >
              {deletingEntry ? 'Deleting…' : 'Delete entry'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default TimesheetPage;
