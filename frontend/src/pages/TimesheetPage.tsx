import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Plus,
  Bell,
  Send,
  Trash2,
  MoreVertical,
  EyeOff,
  RotateCcw,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import type { TimesheetWorkEntry } from '@/types';
import { api } from '@/lib/api';

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

function dayHideKey(weekOffset: number, iso: string): string {
  return `${weekOffset}|${iso}`;
}

/** 4-digit or shorter numeric → HH:MM for API */
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

const fieldBase =
  'box-border min-w-0 w-full rounded-lg border border-border/60 bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/35';

const textareaCls =
  `${fieldBase} resize-y min-h-[72px] break-words [overflow-wrap:anywhere] [word-break:break-word]`;

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load timesheet');
    } finally {
      setLoadingEntries(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    void reloadEntries();
  }, [reloadEntries]);

  const weekTotalSeconds = useMemo(
    () => entries.filter(e => e.workDate <= todayStr).reduce((a, e) => a + e.seconds, 0),
    [entries, todayStr],
  );

  const dayView = useMemo(
    () =>
      visibleWeekDates
        .map(date => {
          const idx = weekDates.indexOf(date);
          const entriesForDay = entries.filter(e => e.workDate === date);
          const totalSeconds = entriesForDay.reduce((a, e) => a + e.seconds, 0);
          return {
            date,
            dayName: dayNames[idx] ?? '',
            dayShortName: dayShort[idx] ?? '',
            entriesForDay,
            totalSeconds,
          };
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

  const resetForm = () => {
    setFormProjectId('');
    setFormSectionId('');
    setFormDescription('');
    setFormTimeFrom('');
    setFormTimeTo('');
  };

  const openNewModal = (workDate: string) => {
    resetForm();
    setEntryModal({ mode: 'new', date: workDate });
  };

  const openEditModal = (entry: TimesheetWorkEntry) => {
    setFormProjectId(entry.projectId);
    setFormSectionId(entry.sectionId);
    setFormDescription(entry.description);
    setFormTimeFrom(apiTimeToCompactDisplay(entry.timeFrom));
    setFormTimeTo(apiTimeToCompactDisplay(entry.timeTo));
    setEntryModal({ mode: 'edit', entry });
  };

  const closeEntryModal = () => {
    setEntryModal(null);
    resetForm();
  };

  const toggleHideDay = (date: string) => {
    const k = dayHideKey(weekOffset, date);
    setHiddenDayKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const showAllDaysThisWeek = () => {
    setHiddenDayKeys(prev => {
      const next = new Set(prev);
      for (const d of dayView) {
        next.delete(dayHideKey(weekOffset, d.date));
      }
      return next;
    });
  };

  const saveEntry = async () => {
    if (!entryModal) return;
    if (!formProjectId || !formSectionId) {
      toast.error('Select a project and section');
      return;
    }
    let timeFromApi: string;
    let timeToApi: string;
    try {
      timeFromApi = compactTimeToApi(formTimeFrom);
      timeToApi = compactTimeToApi(formTimeTo);
    } catch {
      toast.error('Enter valid start and end times (four digits each, 24h).');
      return;
    }
    setSaving(true);
    try {
      if (entryModal.mode === 'new') {
        await api.createTimesheetWorkEntry({
          workDate: entryModal.date,
          projectId: formProjectId,
          sectionId: formSectionId,
          description: formDescription,
          timeFrom: timeFromApi,
          timeTo: timeToApi,
        });
        toast.success('Entry saved');
      } else {
        await api.patchTimesheetWorkEntry(entryModal.entry.id, {
          workDate: entryModal.entry.workDate,
          projectId: formProjectId,
          sectionId: formSectionId,
          description: formDescription,
          timeFrom: timeFromApi,
          timeTo: timeToApi,
        });
        toast.success('Entry updated');
      }
      await reloadEntries();
      closeEntryModal();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete');
    } finally {
      setDeletingEntry(false);
    }
  };

  if (!currentUser) return null;

  const defaultNewDate =
    visibleWeekDates.includes(todayStr) ? todayStr : (visibleWeekDates[visibleWeekDates.length - 1] ?? weekDates[0]);

  const exportCSV = () => {
    const header = ['Date', 'Description', 'Project', 'Section', 'From', 'To', 'Duration'].join(',');
    const rows = entries.map(e => {
      const project = projects.find(p => p.id === e.projectId);
      const section = project?.sections.find(s => s.id === e.sectionId);
      const desc = (e.description || '').replace(/"/g, '""');
      return [
        formatDisplayDate(e.workDate),
        `"${desc}"`,
        project?.name ?? '',
        section?.name ?? '',
        e.timeFrom,
        e.timeTo,
        formatDuration(e.seconds),
      ].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet_${weekStart}_${weekEnd}.csv`;
    a.click();
    toast.success('Timesheet exported');
  };

  const toggleDay = (date: string) => {
    setSelectedDays(prev => (prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]));
  };

  const handleNotify = () => {
    if (!notifyRecipient) return toast.error('Select a recipient');
    if (selectedDays.length === 0) return toast.error('Select at least one day');
    toast.success(`Schedule sent to ${users.find(u => u.id === notifyRecipient)?.name || 'recipient'}`);
    setNotifyOpen(false);
    setSelectedDays([]);
    setNotifyRecipient('');
  };

  const scheduleSummary = selectedDays.sort().map(date => dayView.find(d => d.date === date)).filter(Boolean);

  const weekLabel =
    visibleWeekDates.length > 0
      ? `${formatDisplayDate(visibleWeekDates[0])} — ${formatDisplayDate(visibleWeekDates[visibleWeekDates.length - 1])}`
      : `${formatDisplayDate(weekStart)} — ${formatDisplayDate(weekEnd)}`;

  const selectedProject = userProjects.find(p => p.id === formProjectId);
  const sectionOptions = selectedProject?.sections ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="p-6 min-w-0 max-w-full w-full overflow-x-hidden box-border"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between mb-8">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Timesheet</h1>
          <p className="text-sm text-muted-foreground max-w-xl leading-relaxed break-words [overflow-wrap:anywhere]">
            Log work by day (<span className="text-foreground/90 font-medium">dd-mm-yyyy</span>, newest first). Hiding a
            day only hides it here; entries stay saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button
            type="button"
            variant="secondary"
            className="rounded-xl gap-2"
            disabled={userProjects.length === 0}
            onClick={() => openNewModal(defaultNewDate)}
          >
            <Plus className="h-4 w-4" /> Log time
          </Button>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl gap-2"
            onClick={() => {
              setSelectedDays(visibleWeekDates.filter(d => (dayView.find(dv => dv.date === d)?.totalSeconds ?? 0) > 0));
              setNotifyOpen(true);
            }}
          >
            <Bell className="h-4 w-4" /> Notify
          </Button>
          <Button type="button" className="rounded-xl gap-2" onClick={exportCSV}>
            <Download className="h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-8 p-4 rounded-2xl border border-border/60 bg-card/40 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-xl shrink-0"
            onClick={() => setWeekOffset(w => w - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-semibold tabular-nums min-w-[10rem] text-center">{weekLabel}</span>
          {loadingEntries && <span className="text-xs text-muted-foreground">Loading…</span>}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="rounded-xl shrink-0"
            onClick={() => setWeekOffset(w => Math.min(0, w + 1))}
            disabled={weekOffset >= 0}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          {weekOffset !== 0 && (
            <button type="button" onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline ml-1">
              This week
            </button>
          )}
        </div>
        <div className="h-8 w-px bg-border/70 hidden sm:block" />
        <div className="flex items-baseline gap-2 rounded-xl bg-muted/50 px-4 py-2 border border-border/50">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Week to date</span>
          <span className="text-lg font-bold tabular-nums">{formatDuration(weekTotalSeconds)}</span>
        </div>
        {hiddenCountThisWeek > 0 && (
          <Button type="button" variant="outline" size="sm" className="rounded-xl gap-1.5 ml-auto" onClick={showAllDaysThisWeek}>
            <RotateCcw className="h-3.5 w-3.5" /> Show {hiddenCountThisWeek} hidden day{hiddenCountThisWeek !== 1 ? 's' : ''}
          </Button>
        )}
      </div>

      {userProjects.length === 0 && (
        <p className="text-sm text-muted-foreground mb-6 rounded-2xl border border-dashed border-border/70 px-4 py-4 bg-muted/15">
          You are not in any project yet. Ask a manager to add you, then you can log work by project and section.
        </p>
      )}

      {visibleWeekDates.length === 0 ? (
        <p className="text-sm text-muted-foreground rounded-2xl border border-dashed px-4 py-6 bg-muted/15 text-center">
          No days in this range — future days are hidden.
        </p>
      ) : visibleDays.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 px-6 py-12 text-center space-y-3">
          <p className="text-muted-foreground">Every day this week is hidden from view.</p>
          <Button type="button" variant="secondary" className="rounded-xl gap-2" onClick={showAllDaysThisWeek}>
            <EyeOff className="h-4 w-4" /> Show all days
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {visibleDays.map((day, idx) => (
            <motion.section
              key={day.date}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...pageEnter, delay: idx * 0.03 }}
              className="rounded-2xl border border-border/60 bg-gradient-to-b from-card/90 to-card/60 overflow-hidden min-w-0 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-border/50 bg-muted/25">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
                  <h2 className="text-base font-semibold">{day.dayName}</h2>
                  <span className="text-xs font-mono text-muted-foreground tabular-nums">{formatDisplayDate(day.date)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end">
                  <span
                    className={`text-sm font-semibold tabular-nums px-2 py-0.5 rounded-lg ${
                      day.totalSeconds > 0 ? 'text-foreground bg-muted/60' : 'text-muted-foreground/50'
                    }`}
                  >
                    {day.totalSeconds > 0 ? formatDuration(day.totalSeconds) : '0m'}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 rounded-lg text-muted-foreground hover:text-foreground gap-1.5"
                    onClick={() => toggleHideDay(day.date)}
                  >
                    <EyeOff className="h-3.5 w-3.5" /> Hide day
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-8 rounded-lg gap-1.5"
                    disabled={userProjects.length === 0}
                    onClick={() => openNewModal(day.date)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              </div>

              {day.entriesForDay.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Nothing logged — use <span className="text-foreground font-medium">Add</span> or{' '}
                  <span className="text-foreground font-medium">Log time</span> above.
                </div>
              ) : (
                <ul className="divide-y divide-border/40">
                  {day.entriesForDay.map(entry => {
                    const project = projects.find(p => p.id === entry.projectId);
                    const section = project?.sections.find(s => s.id === entry.sectionId);
                    return (
                      <li
                        key={entry.id}
                        className="flex flex-col sm:flex-row sm:items-start gap-3 px-4 py-3.5 hover:bg-muted/15 transition-colors min-w-0"
                      >
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="inline-flex items-center rounded-lg bg-muted/70 border border-border/50 px-2.5 py-1 font-mono text-xs tabular-nums">
                            {entry.timeFrom} – {entry.timeTo}
                          </span>
                          <span className="text-sm font-bold tabular-nums w-14 text-right">{formatDuration(entry.seconds)}</span>
                        </div>
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <p className="text-sm text-foreground leading-snug break-words whitespace-pre-wrap [overflow-wrap:anywhere]">
                            {entry.description?.trim() ? (
                              entry.description
                            ) : (
                              <span className="text-muted-foreground italic">No description</span>
                            )}
                          </p>
                          <div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                            <span className="rounded-md bg-background/80 border border-border/50 px-2 py-0.5 max-w-full break-words [overflow-wrap:anywhere]">
                              {project?.name ?? entry.projectId}
                            </span>
                            {section && (
                              <span className="rounded-md bg-background/80 border border-border/50 px-2 py-0.5 max-w-full break-words [overflow-wrap:anywhere]">
                                {section.name}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 self-start sm:self-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label="Entry actions">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onClick={() => openEditModal(entry)}>Edit</DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
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
          ))}
        </div>
      )}

      <Dialog
        open={!!entryModal}
        onOpenChange={o => {
          if (!o) closeEntryModal();
        }}
      >
        <DialogContent className="sm:max-w-lg max-h-[min(90vh,640px)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{entryModal?.mode === 'edit' ? 'Edit entry' : 'New entry'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            {entryModal?.mode === 'new' && (
              <p className="text-xs text-muted-foreground font-mono tabular-nums">
                {formatDisplayDate(entryModal.date)}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="ts-desc">Description</Label>
              <textarea
                id="ts-desc"
                rows={3}
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder="What you worked on…"
                className={textareaCls}
                disabled={saving}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 min-w-0">
                <Label htmlFor="ts-project">Project</Label>
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
                  className={fieldBase}
                  disabled={saving}
                >
                  {entryModal?.mode === 'new' && <option value="">Choose project…</option>}
                  {userProjects.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2 min-w-0">
                <Label htmlFor="ts-section">Section</Label>
                <select
                  id="ts-section"
                  value={formSectionId}
                  onChange={e => setFormSectionId(e.target.value)}
                  className={fieldBase}
                  disabled={saving || !formProjectId || sectionOptions.length === 0}
                >
                  <option value="">{formProjectId ? 'Choose section…' : 'Pick a project first'}</option>
                  {sectionOptions.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="ts-from">Start</Label>
                <input
                  id="ts-from"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder=""
                  value={formTimeFrom}
                  onChange={e => setFormTimeFrom(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${fieldBase} font-mono tabular-nums`}
                  disabled={saving}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts-to">End</Label>
                <input
                  id="ts-to"
                  type="text"
                  inputMode="numeric"
                  maxLength={4}
                  placeholder=""
                  value={formTimeTo}
                  onChange={e => setFormTimeTo(e.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${fieldBase} font-mono tabular-nums`}
                  disabled={saving}
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
            <Button type="button" variant="outline" className="rounded-xl" onClick={closeEntryModal} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" className="rounded-xl" onClick={() => void saveEntry()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notify schedule</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-2 block">Days</label>
              <div className="flex flex-wrap gap-2">
                {[...visibleWeekDates].sort((a, b) => b.localeCompare(a)).map(date => {
                  const i = weekDates.indexOf(date);
                  return (
                    <motion.button
                      key={date}
                      type="button"
                      transition={snappy}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => toggleDay(date)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors duration-100 ${
                        selectedDays.includes(date)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-muted/50 hover:bg-muted border-border'
                      }`}
                    >
                      {dayShort[i] ?? ''} {formatDisplayDate(date)}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-2 block">Send to</label>
              <select
                value={notifyRecipient}
                onChange={e => setNotifyRecipient(e.target.value)}
                className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">Select recipient…</option>
                {users.filter(u => u.id !== currentUser.id).map(u => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </select>
            </div>

            {scheduleSummary.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-4 max-h-[280px] overflow-y-auto space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Preview</h4>
                {scheduleSummary.map(
                  d =>
                    d && (
                      <div key={d.date} className="space-y-1">
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="text-sm font-semibold break-words">
                            {d.dayName}{' '}
                            <span className="text-xs font-normal text-muted-foreground">{formatDisplayDate(d.date)}</span>
                          </span>
                          <span className="text-xs font-semibold shrink-0">{formatDuration(d.totalSeconds)}</span>
                        </div>
                        {d.entriesForDay.length > 0 ? (
                          d.entriesForDay.map(en => {
                            const project = projects.find(p => p.id === en.projectId);
                            const section = project?.sections.find(s => s.id === en.sectionId);
                            return (
                              <div key={en.id} className="flex items-start justify-between pl-3 gap-2 text-xs text-muted-foreground min-w-0">
                                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                                  {en.description?.trim() || '(no description)'} · {project?.name}
                                  {section ? ` · ${section.name}` : ''} · {en.timeFrom}–{en.timeTo}
                                </span>
                                <span className="font-mono shrink-0">{formatDuration(en.seconds)}</span>
                              </div>
                            );
                          })
                        ) : (
                          <p className="pl-3 text-xs text-muted-foreground/50">No activity</p>
                        )}
                      </div>
                    ),
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotifyOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleNotify} disabled={!notifyRecipient || selectedDays.length === 0} className="gap-2 rounded-xl">
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!entryToDelete} onOpenChange={o => !o && setEntryToDelete(null)}>
        <AlertDialogContent className="max-w-[min(100%,24rem)]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
              {entryToDelete && (
                <>
                  This removes one row for{' '}
                  <span className="font-mono text-foreground">{formatDisplayDate(entryToDelete.workDate)}</span>.
                  {entryToDelete.description?.trim() ? (
                    <>
                      {' '}
                      <span className="break-all">&quot;{entryToDelete.description.slice(0, 120)}</span>
                      {entryToDelete.description.length > 120 ? '…' : ''}&quot;
                    </>
                  ) : null}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingEntry}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingEntry}
              onClick={e => {
                e.preventDefault();
                void confirmDeleteEntry();
              }}
            >
              {deletingEntry ? 'Deleting…' : (
                <>
                  <Trash2 className="h-3.5 w-3.5 inline mr-1.5 align-text-bottom" /> Delete
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default TimesheetPage;
