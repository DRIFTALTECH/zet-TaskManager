/**
 * CalendarPage — a dedicated week/day calendar for time entries (Clockify-style).
 * Drag on the grid to create an entry; click a block to edit. Self-contained:
 * loads its own entries and owns the add/edit modal. No quick-add bar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarDays, DollarSign, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { pageEnter } from '@/lib/motion';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import { isTaskAssignedTo } from '@/lib/task-utils';
import type { TimesheetWorkEntry, Task } from '@/types';
import CalendarWeekView from '@/components/CalendarWeekView';
import TaskSuggest from '@/components/TaskSuggest';
import ProjectSectionPicker from '@/components/ProjectSectionPicker';

// ── date / time helpers ───────────────────────────────────────────────────────
const dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weekDatesOf(weekOffset: number): string[] {
  const now = new Date();
  const dow = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + weekOffset * 7);
  return dayShort.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return iso(d);
  });
}
function compactToApi(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) throw new Error('empty');
  const p = digits.padStart(4, '0');
  const h = parseInt(p.slice(0, 2), 10);
  const m = parseInt(p.slice(2), 10);
  if (h > 23 || m > 59) throw new Error('invalid');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function apiToCompact(s: string): string {
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}${m[2]}`;
}
function prettyDate(isoStr: string): string {
  const d = new Date(`${isoStr}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

type Modal =
  | { mode: 'new'; date: string; from: string; to: string }
  | { mode: 'edit'; entry: TimesheetWorkEntry };

export default function CalendarPage() {
  const { currentUser, projects, tasks, addSection } = useAppStore();
  const [kind, setKind] = useState<'week' | 'day'>('week');
  const [weekOffset, setWeekOffset] = useState(0);
  const [dayDate, setDayDate] = useState(() => iso(new Date()));
  const [entries, setEntries] = useState<TimesheetWorkEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const todayStr = iso(new Date());

  const userProjects = useMemo(
    () => (currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : []),
    [projects, currentUser],
  );
  const myTasks = useMemo(
    () => (currentUser ? tasks.filter(t => isTaskAssignedTo(t, currentUser.id)) : []),
    [tasks, currentUser],
  );

  const weekDates = useMemo(() => weekDatesOf(weekOffset), [weekOffset]);
  const range = useMemo(
    () => (kind === 'week' ? { start: weekDates[0], end: weekDates[6] } : { start: dayDate, end: dayDate }),
    [kind, weekDates, dayDate],
  );
  const gridDates = kind === 'week' ? weekDates : [dayDate];

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      setEntries(await api.getTimesheetWorkEntries(range.start, range.end));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load calendar');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser, range.start, range.end]);
  useEffect(() => { void load(); }, [load]);

  // ── modal / form ────────────────────────────────────────────────────────────
  const [modal, setModal] = useState<Modal | null>(null);
  const [fProject, setFProject] = useState('');
  const [fSection, setFSection] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fFrom, setFFrom] = useState('');
  const [fTo, setFTo] = useState('');
  const [fBillable, setFBillable] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<TimesheetWorkEntry | null>(null);
  const [deleting, setDeleting] = useState(false);

  const openNewAt = (date: string, from: string, to: string) => {
    setFProject(''); setFSection(''); setFDesc(''); setFBillable(true);
    setFFrom(from); setFTo(to);
    setModal({ mode: 'new', date, from, to });
  };
  const openEdit = (e: TimesheetWorkEntry) => {
    setFProject(e.projectId); setFSection(e.sectionId); setFDesc(e.description);
    setFFrom(apiToCompact(e.timeFrom)); setFTo(apiToCompact(e.timeTo)); setFBillable(e.billable);
    setModal({ mode: 'edit', entry: e });
  };
  const closeModal = () => setModal(null);

  const createSectionReturningId = async (projectId: string, name: string): Promise<string | null> => {
    try {
      await addSection(projectId, name);
      const proj = useAppStore.getState().projects.find(p => p.id === projectId);
      return proj?.sections.find(s => s.name.trim() === name.trim())?.id ?? null;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create section');
      return null;
    }
  };

  const pickTask = (t: Task) => {
    setFDesc(t.title);
    if (userProjects.some(p => p.id === t.projectId)) {
      setFProject(t.projectId);
      if (t.sectionId) setFSection(t.sectionId);
    }
  };

  const save = async () => {
    if (!modal) return;
    if (!fProject || !fSection) { toast.error('Select a project and section'); return; }
    let from: string; let to: string;
    try { from = compactToApi(fFrom); to = compactToApi(fTo); }
    catch { toast.error('Enter valid start and end times (24h, e.g. 0930).'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'new') {
        await api.createTimesheetWorkEntry({ workDate: modal.date, projectId: fProject, sectionId: fSection, description: fDesc, timeFrom: from, timeTo: to, billable: fBillable });
        toast.success('Entry added');
      } else {
        await api.patchTimesheetWorkEntry(modal.entry.id, { workDate: modal.entry.workDate, projectId: fProject, sectionId: fSection, description: fDesc, timeFrom: from, timeTo: to, billable: fBillable });
        toast.success('Entry updated');
      }
      closeModal();
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    finally { setSaving(false); }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteTimesheetWorkEntry(toDelete.id);
      toast.success('Entry removed');
      if (modal?.mode === 'edit' && modal.entry.id === toDelete.id) closeModal();
      setToDelete(null);
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete'); }
    finally { setDeleting(false); }
  };

  const resizeEntry = async (entry: TimesheetWorkEntry, from: string, to: string) => {
    const tf = compactToApi(from); const tt = compactToApi(to);
    // Optimistic resize, then persist (server recomputes seconds from the new span).
    setEntries(prev => prev.map(x => (x.id === entry.id ? { ...x, timeFrom: tf, timeTo: tt } : x)));
    try {
      await api.patchTimesheetWorkEntry(entry.id, {
        workDate: entry.workDate, projectId: entry.projectId, sectionId: entry.sectionId,
        description: entry.description, timeFrom: tf, timeTo: tt, billable: entry.billable,
      });
      await load(); // refresh seconds/duration
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not resize');
      await load();
    }
  };

  const moveEntry = async (entry: TimesheetWorkEntry, date: string, from: string, to: string) => {
    const tf = compactToApi(from); const tt = compactToApi(to);
    setEntries(prev => prev.map(x => (x.id === entry.id ? { ...x, workDate: date, timeFrom: tf, timeTo: tt } : x)));
    try {
      await api.patchTimesheetWorkEntry(entry.id, {
        workDate: date, projectId: entry.projectId, sectionId: entry.sectionId,
        description: entry.description, timeFrom: tf, timeTo: tt, billable: entry.billable,
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move');
      await load();
    }
  };

  const toggleBillable = async (entry: TimesheetWorkEntry) => {
    setEntries(prev => prev.map(x => (x.id === entry.id ? { ...x, billable: !x.billable } : x)));
    try {
      await api.patchTimesheetWorkEntry(entry.id, { billable: !entry.billable });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update billable');
      await load();
    }
  };

  const step = (dir: -1 | 1) => {
    if (kind === 'week') setWeekOffset(w => w + dir);
    else setDayDate(d => { const n = new Date(`${d}T12:00:00`); n.setDate(n.getDate() + dir); return iso(n); });
  };
  const goToday = () => { setWeekOffset(0); setDayDate(todayStr); };

  if (!currentUser) return null;

  const rangeLabel = kind === 'week'
    ? `${new Date(`${weekDates[0]}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(`${weekDates[6]}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : prettyDate(dayDate);

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="min-h-full">
      <div className="w-full px-3 sm:px-5 py-5 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary/70" /> Calendar
            </h1>
            <div className="flex items-center gap-0.5 rounded-lg border border-border/40 bg-muted/30 p-0.5">
              {(['week', 'day'] as const).map(k => (
                <button key={k} type="button" onClick={() => setKind(k)}
                  className={cn('px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-colors', kind === k ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card/60 p-1">
            <button type="button" onClick={() => step(-1)} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"><ChevronLeft className="h-4 w-4" /></button>
            <span className="text-sm font-semibold tabular-nums px-2 min-w-[190px] text-center">{rangeLabel}</span>
            <button type="button" onClick={() => step(1)} className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"><ChevronRight className="h-4 w-4" /></button>
            <button type="button" onClick={goToday} className="text-xs font-semibold text-primary px-2 py-1 rounded-lg hover:bg-primary/10 transition-colors">Today</button>
            {loading && <span className="ml-1 h-3.5 w-3.5 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />}
          </div>
        </div>

        {userProjects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 px-5 py-4 text-sm text-amber-400/80">
            You are not in any project yet. Ask a manager to add you, then you can log work here.
          </div>
        ) : (
          <CalendarWeekView
            weekDates={gridDates}
            entries={entries}
            projects={projects}
            todayStr={todayStr}
            onSelectEntry={openEdit}
            onAddAt={openNewAt}
            onResizeEntry={resizeEntry}
            onMoveEntry={moveEntry}
            onToggleBillable={toggleBillable}
          />
        )}
      </div>

      {/* Add / edit modal */}
      <Dialog open={!!modal} onOpenChange={o => { if (!o) closeModal(); }}>
        <DialogContent className="overflow-y-auto rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">{modal?.mode === 'edit' ? 'Edit entry' : 'Log time'}</DialogTitle>
            {modal?.mode === 'new' && <p className="text-xs text-muted-foreground/60 font-mono mt-0.5">{prettyDate(modal.date)}</p>}
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="cal-desc">Description</Label>
              <TaskSuggest
                value={fDesc} onChange={setFDesc} onPick={pickTask}
                tasks={myTasks} projects={projects} disabled={saving}
                inputId="cal-desc" placeholder="What did you work on?" multiline rows={3}
                containerClassName="w-full"
                inputClassName="w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y min-h-[72px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">Project / section</Label>
              <ProjectSectionPicker
                projects={userProjects}
                projectId={fProject}
                sectionId={fSection}
                onChange={(pid, sid) => { setFProject(pid); setFSection(sid); }}
                onCreateSection={createSectionReturningId}
                disabled={saving}
                placeholder="Choose project / section"
                triggerClassName="w-full"
              />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide">Billable</Label>
              <button type="button" onClick={() => setFBillable(v => !v)}
                className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors',
                  fBillable ? 'text-emerald-500 bg-emerald-500/10' : 'text-muted-foreground/60 bg-muted/40 hover:bg-muted/60')}>
                <DollarSign className="h-3.5 w-3.5" /> {fBillable ? 'Billable' : 'Non-billable'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="cal-from">Start</Label>
                <input id="cal-from" inputMode="numeric" maxLength={4} placeholder="0900" value={fFrom}
                  onChange={e => setFFrom(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={saving}
                  className="w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm font-mono tabular-nums tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="cal-to">End</Label>
                <input id="cal-to" inputMode="numeric" maxLength={4} placeholder="1730" value={fTo}
                  onChange={e => setFTo(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={saving}
                  className="w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm font-mono tabular-nums tracking-widest focus:outline-none focus:ring-2 focus:ring-primary/40" />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 mt-2 flex-col sm:flex-row sm:justify-between">
            {modal?.mode === 'edit' ? (
              <button type="button" onClick={() => setToDelete(modal.entry)} disabled={saving}
                className="flex items-center gap-1.5 text-sm px-3 py-2 rounded-xl border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors font-medium">
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            ) : <span />}
            <div className="flex gap-2">
              <button type="button" onClick={closeModal} disabled={saving}
                className="text-sm px-4 py-2 rounded-xl border border-border/50 hover:bg-muted/50 transition-all text-muted-foreground hover:text-foreground font-medium">Cancel</button>
              <button type="button" onClick={() => void save()} disabled={saving}
                className="text-sm px-5 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all font-semibold shadow-sm">
                {saving ? 'Saving…' : modal?.mode === 'edit' ? 'Update entry' : 'Save entry'}
              </button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!toDelete} onOpenChange={o => !o && setToDelete(null)}>
        <AlertDialogContent className="max-w-[min(100%,24rem)] rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" disabled={deleting}
              onClick={e => { e.preventDefault(); void confirmDelete(); }}>
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
