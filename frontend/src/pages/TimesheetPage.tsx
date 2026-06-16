import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Download, Plus, Bell, Send,
  Trash2, MoreVertical, CalendarX2, Clock, CalendarDays,
  Tag, DollarSign, List, X, Mail, Sparkles, Check, Pencil,
  AlertCircle, CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import type { TimesheetWorkEntry, AITimesheetRow } from '@/types';
import { api } from '@/lib/api';
import { acquireGraphToken, hasMicrosoftSession, isMicrosoftAuthConfigured } from '@/lib/microsoftAuth';
import UserAvatar from '@/components/UserAvatar';

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
const ID_DOT_COLORS = [
  'bg-blue-400', 'bg-violet-400', 'bg-emerald-400', 'bg-orange-400', 'bg-pink-400',
  'bg-teal-400', 'bg-amber-400', 'bg-cyan-400', 'bg-indigo-400', 'bg-rose-400',
];
function idPillColor(id: string): string {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ID_PILL_PALETTES[h % ID_PILL_PALETTES.length];
}
function idDotColor(id: string): string {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return ID_DOT_COLORS[h % ID_DOT_COLORS.length];
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

/** Mirror backend span_seconds for duration preview between two HH:MM compact inputs. */
function spanSecondsFromCompact(fromCompact: string, toCompact: string): number | null {
  try {
    const tf = compactTimeToApi(fromCompact);
    const tt = compactTimeToApi(toCompact);
    const [h1, m1] = tf.split(':').map(Number);
    const [h2, m2] = tt.split(':').map(Number);
    const sf = h1 * 3600 + m1 * 60;
    const st = h2 * 3600 + m2 * 60;
    if (st > sf) return st - sf;
    if (st === sf) return 0;
    return 86400 - sf + st;
  } catch {
    return null;
  }
}

function formatDurationHMS(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '00:00:00';
  const h = Math.floor(seconds / 3600) % 100;
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function mondayOf(d: Date): Date {
  const m = new Date(d);
  const day = m.getDay();
  m.setDate(m.getDate() - (day === 0 ? 6 : day - 1));
  m.setHours(0, 0, 0, 0);
  return m;
}

/** Week offset (same as getWeekDates) so calendar picks jump to the right week. */
function weekOffsetForIsoDate(iso: string): number {
  const target = new Date(`${iso}T12:00:00`);
  const now = new Date();
  const w0 = mondayOf(now).getTime();
  const w1 = mondayOf(target).getTime();
  return Math.round((w1 - w0) / (7 * 24 * 60 * 60 * 1000));
}

function formatQuickDateLabel(iso: string, today: string): string {
  if (iso === today) return 'Today';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

type EntryModalState = null | { mode: 'new'; date: string } | { mode: 'edit'; entry: TimesheetWorkEntry };

const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';
const textareaCls = `${inputCls} resize-y min-h-[72px] break-words [overflow-wrap:anywhere] [word-break:break-word]`;

// ── Timesheet AI Panel ────────────────────────────────────────────────────────

function confidenceColor(c: number): string {
  if (c >= 0.9) return 'border-green-500/20 bg-green-500/5';
  if (c >= 0.7) return 'border-amber-500/20 bg-amber-500/5';
  return 'border-red-500/20 bg-red-500/5';
}

function RowPreviewCard({
  row,
  idx,
  projects,
  onSave,
  onRemove,
  onCreateSection,
}: {
  row: AITimesheetRow;
  idx: number;
  projects: ReturnType<typeof useAppStore.getState>['projects'];
  onSave: (updated: AITimesheetRow) => void;
  onRemove: () => void;
  /** Creates a section in the given project and resolves to its new id (or null on failure). */
  onCreateSection: (projectId: string, name: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(row.description);
  const [timeFrom, setTimeFrom] = useState(row.time_from);
  const [timeTo, setTimeTo]     = useState(row.time_to);
  const [projectId, setProjectId]   = useState(row.project_id ?? '');
  const [sectionId, setSectionId]   = useState(row.section_id ?? '');
  const [showNewSec, setShowNewSec] = useState(false);
  const [newSecName, setNewSecName] = useState(row.suggested_section_name ?? '');
  const [busy, setBusy] = useState(false);

  const selProject = projects.find(p => p.id === projectId);
  const sectionOpts = selProject?.sections ?? [];

  const handleSave = () => {
    const proj = projects.find(p => p.id === projectId);
    const sec  = proj?.sections?.find(s => s.id === sectionId);
    onSave({
      ...row,
      description: desc,
      time_from: timeFrom,
      time_to: timeTo,
      project_id: projectId || null,
      project_name: proj?.name ?? null,
      section_id: sectionId || null,
      section_name: sec?.name ?? null,
      confidence: 1.0,
      needs_clarification: false,
      clarification_note: null,
      suggest_create_section: !sectionId,
    });
    setEditing(false);
  };

  // Create a brand-new section (in the editor) and select it immediately.
  const handleCreateInEditor = async () => {
    if (!projectId || !newSecName.trim()) return;
    setBusy(true);
    const newId = await onCreateSection(projectId, newSecName.trim());
    setBusy(false);
    if (newId) { setSectionId(newId); setShowNewSec(false); }
  };

  // One-click accept of the AI's suggested section (from the non-editing card).
  const acceptSuggestedSection = async () => {
    if (!row.project_id || !row.suggested_section_name) return;
    setBusy(true);
    const newId = await onCreateSection(row.project_id, row.suggested_section_name);
    setBusy(false);
    if (newId) {
      onSave({
        ...row,
        section_id: newId,
        section_name: row.suggested_section_name,
        suggest_create_section: false,
        needs_clarification: false,
      });
    }
  };

  const borderCls = confidenceColor(row.confidence);

  if (editing) {
    return (
      <div className={`rounded-xl border p-3 space-y-2.5 ${borderCls}`}>
        <input
          autoFocus
          value={desc}
          onChange={e => setDesc(e.target.value)}
          placeholder="Description"
          className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:border-violet-500/60"
        />
        <div className="flex gap-2">
          <input value={timeFrom} onChange={e => setTimeFrom(e.target.value)} placeholder="09:00"
            className="w-24 px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:border-violet-500/60 font-mono" />
          <span className="self-center text-muted-foreground text-xs">→</span>
          <input value={timeTo} onChange={e => setTimeTo(e.target.value)} placeholder="10:00"
            className="w-24 px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:border-violet-500/60 font-mono" />
        </div>
        <select value={projectId} onChange={e => { setProjectId(e.target.value); setSectionId(''); setShowNewSec(false); }}
          className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none">
          <option value="">— No project —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {projectId && !showNewSec && (
          <div className="flex gap-2">
            <select value={sectionId} onChange={e => setSectionId(e.target.value)}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none">
              <option value="">{sectionOpts.length ? '— Select a section —' : '— No sections yet —'}</option>
              {sectionOpts.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => { setShowNewSec(true); setNewSecName(row.suggested_section_name ?? ''); }}
              className="shrink-0 flex items-center gap-1 px-2.5 py-2 rounded-lg border border-violet-500/40 text-violet-400 text-xs font-semibold hover:bg-violet-500/10 transition-colors">
              <Plus className="h-3 w-3" /> New
            </button>
          </div>
        )}
        {projectId && showNewSec && (
          <div className="flex gap-2">
            <input autoFocus value={newSecName} onChange={e => setNewSecName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void handleCreateInEditor(); }}
              placeholder="New section name"
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-violet-500/40 bg-background focus:outline-none focus:border-violet-500/60" />
            <button onClick={() => void handleCreateInEditor()} disabled={!newSecName.trim() || busy}
              className="shrink-0 px-3 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50">
              {busy ? '…' : 'Create'}
            </button>
            <button onClick={() => setShowNewSec(false)}
              className="shrink-0 px-2.5 py-2 rounded-lg border border-border/60 bg-muted/30 text-xs hover:bg-muted/60 transition-colors">
              Cancel
            </button>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={handleSave}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors">
            <Check className="h-3 w-3" /> Save
          </button>
          <button onClick={() => setEditing(false)}
            className="px-3 py-1.5 rounded-lg border border-border/60 bg-muted/30 text-xs hover:bg-muted/60 transition-colors">
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className={`rounded-xl border p-3 space-y-1.5 ${borderCls}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-snug flex-1">{row.description}</p>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEditing(true)}
            className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={onRemove}
            className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground/80">{row.time_from} – {row.time_to}</span>
        {row.project_name
          ? <span className="flex items-center gap-1"><Tag className="h-3 w-3" />{row.project_name}</span>
          : <span className="flex items-center gap-1 text-red-400"><AlertCircle className="h-3 w-3" />No project — edit to pick one</span>}
        {row.section_name && <span className="opacity-60">/ {row.section_name}</span>}
      </div>

      {/* Missing section → require a section before this row can be saved */}
      {row.project_id && !row.section_id && (
        <div className="flex items-center gap-2 text-[11px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {row.suggested_section_name ? (
            <>
              <span className="flex-1">No matching section. Suggested: <span className="font-semibold">“{row.suggested_section_name}”</span></span>
              <button onClick={() => void acceptSuggestedSection()} disabled={busy}
                className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md bg-violet-600 text-white text-[10px] font-bold hover:bg-violet-500 transition-colors disabled:opacity-50">
                <Plus className="h-2.5 w-2.5" /> {busy ? 'Creating…' : 'Create section'}
              </button>
            </>
          ) : (
            <span className="flex-1">No section selected — edit this row to pick or create one.</span>
          )}
        </div>
      )}

      {row.needs_clarification && row.clarification_note && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-400">
          <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>{row.clarification_note}</span>
        </div>
      )}

      {row.confidence < 0.9 && (
        <div className="flex items-center gap-1.5 mt-0.5">
          <div className="h-1 flex-1 rounded-full bg-muted/40 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${row.confidence >= 0.7 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${Math.round(row.confidence * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground/60 tabular-nums">{Math.round(row.confidence * 100)}% confidence</span>
        </div>
      )}
    </motion.div>
  );
}

function TimesheetAIPanel({
  date,
  onClose,
  onEntriesAdded,
}: {
  date: string;
  onClose: () => void;
  onEntriesAdded: () => Promise<void>;
}) {
  const { projects, addSection } = useAppStore();
  const [summary, setSummary] = useState('');
  const [parsing, setParsing]   = useState(false);
  const [rows, setRows]         = useState<AITimesheetRow[] | null>(null);
  const [message, setMessage]   = useState('');
  const [gaps, setGaps]         = useState<string[]>([]);
  const [totalHours, setTotalHours] = useState(0);
  const [saving, setSaving]     = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textareaRef.current?.focus(); }, []);

  const userProjects = projects.filter(p =>
    p.members?.includes(useAppStore.getState().currentUser?.id ?? '')
  );
  const projectRefs = userProjects.map(p => ({
    id: p.id, name: p.name,
    sections: (p.sections ?? []).map(s => ({ id: s.id, name: s.name })),
  }));

  const handleParse = async () => {
    if (!summary.trim()) return;
    setParsing(true);
    try {
      const res = await api.aiParseTimesheet(summary, date, projectRefs);
      setRows(res.rows);
      setMessage(res.message);
      setGaps(res.gaps);
      setTotalHours(res.total_hours);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to parse timesheet');
    } finally {
      setParsing(false);
    }
  };

  const updateRow = (idx: number, updated: AITimesheetRow) => {
    setRows(prev => prev ? prev.map((r, i) => i === idx ? updated : r) : prev);
  };

  const removeRow = (idx: number) => {
    setRows(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
  };

  // Create a section inside a project and return its new id (used by the row cards).
  const handleCreateSection = async (projectId: string, name: string): Promise<string | null> => {
    if (!projectId || !name.trim()) { toast.error('A project and a section name are required'); return null; }
    try {
      await addSection(projectId, name.trim());
      const proj = useAppStore.getState().projects.find(p => p.id === projectId);
      const sec = proj?.sections.find(s => s.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (!sec) { toast.error('Section created but could not be located — reload and try again'); return null; }
      toast.success(`Section “${name.trim()}” created`);
      return sec.id;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create section');
      return null;
    }
  };

  const handleAcceptAll = async () => {
    if (!rows || rows.length === 0) return;

    // ── Validation harness: every row MUST have a project AND a section ──────
    // Nothing is saved while any row is incomplete — the user is told exactly
    // what to fix (and, for sections, to create one).
    const needProject = rows.filter(r => !r.project_id).length;
    const needSection = rows.filter(r => r.project_id && !r.section_id).length;
    if (needProject || needSection) {
      const parts: string[] = [];
      if (needProject) parts.push(`${needProject} row${needProject > 1 ? 's' : ''} need a project`);
      if (needSection) parts.push(`${needSection} row${needSection > 1 ? 's' : ''} need a section — create the section first`);
      toast.error(`Can't save yet: ${parts.join(' and ')}.`);
      return;
    }
    const valid = rows;

    setSaving(true);
    let saved = 0;
    const errors: string[] = [];
    for (const row of valid) {
      try {
        await api.createTimesheetWorkEntry({
          workDate: date,
          projectId: row.project_id!,
          sectionId: row.section_id!,
          description: row.description,
          timeFrom: row.time_from,
          timeTo: row.time_to,
        });
        saved++;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : 'Unknown error');
      }
    }
    await onEntriesAdded();
    setSaving(false);
    if (saved > 0) toast.success(`${saved} entr${saved === 1 ? 'y' : 'ies'} added!`);
    if (errors.length) toast.error(`${errors.length} entr${errors.length > 1 ? 'ies' : 'y'} failed.`);
    if (saved > 0) onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      transition={snappy}
      className="border-b border-violet-500/20 bg-violet-500/5 overflow-hidden"
    >
      <div className="px-5 py-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-400">
            <Sparkles className="h-4 w-4" />
            Fill with AI — describe your day
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Input area */}
        {rows === null && (
          <>
            <textarea
              ref={textareaRef}
              value={summary}
              onChange={e => setSummary(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleParse(); }}
              placeholder={`e.g. "Spent the morning fixing the auth bug in Driffy backend, quick standup at 10, then worked on the CI/CD pipeline until 4pm, finished with code review for the frontend section"`}
              rows={3}
              className="w-full px-3.5 py-3 text-sm rounded-xl border border-violet-500/20 bg-background/60 focus:outline-none focus:border-violet-500/50 placeholder:text-muted-foreground/40 resize-none leading-relaxed"
            />
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground/40">⌘ Enter to parse</span>
              <button
                onClick={() => void handleParse()}
                disabled={!summary.trim() || parsing}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {parsing ? 'Parsing…' : 'Parse my day'}
              </button>
            </div>
          </>
        )}

        {/* Preview */}
        {rows !== null && (
          <div className="space-y-3">
            {/* AI message */}
            {message && (
              <div className="flex items-start gap-2 text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded-lg px-3 py-2">
                <Sparkles className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>{message}</span>
              </div>
            )}

            {/* Gaps */}
            {gaps.length > 0 && (
              <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>Unaccounted: {gaps.join(' · ')}</span>
              </div>
            )}

            {/* Row cards */}
            <div className="space-y-2">
              {rows.map((row, i) => (
                <RowPreviewCard
                  key={i}
                  row={row}
                  idx={i}
                  projects={userProjects}
                  onSave={updated => updateRow(i, updated)}
                  onRemove={() => removeRow(i)}
                  onCreateSection={handleCreateSection}
                />
              ))}
            </div>

            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground/50 text-center py-2">All rows removed.</p>
            )}

            {/* Footer */}
            <div className="flex items-center justify-between pt-1 border-t border-violet-500/10">
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
                {totalHours > 0 && <span>{totalHours.toFixed(1)}h total</span>}
                <button
                  onClick={() => { setRows(null); setSummary(''); setGaps([]); setMessage(''); }}
                  className="text-violet-400 hover:underline"
                >
                  ← Edit summary
                </button>
              </div>
              <button
                onClick={() => void handleAcceptAll()}
                disabled={saving || rows.length === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : `Accept all (${rows.length})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
const TimesheetPage = () => {
  const { currentUser, projects, users, addSection } = useAppStore();
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

  const [onLeaveDays, setOnLeaveDays] = useState<Set<string>>(() => new Set());
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyToTags, setNotifyToTags] = useState<string[]>([]);
  const [notifyToInput, setNotifyToInput] = useState('');
  const [notifyCcTags, setNotifyCcTags] = useState<string[]>([]);
  const [notifyCcInput, setNotifyCcInput] = useState('');
  const [notifySubject, setNotifySubject] = useState('');
  const [sendingEmail, setSendingEmail] = useState(false);
  const [showToSuggestions, setShowToSuggestions] = useState(false);
  const [showCcSuggestions, setShowCcSuggestions] = useState(false);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [entryToDelete, setEntryToDelete] = useState<TimesheetWorkEntry | null>(null);
  const [deletingEntry, setDeletingEntry] = useState(false);
  const [aiOpenDay, setAiOpenDay] = useState<string | null>(null);

  // ── Inline section creation ────────────────────────────────────────────────
  const [showQuickNewSection, setShowQuickNewSection] = useState(false);
  const [quickNewSectionName, setQuickNewSectionName] = useState('');
  const [showFormNewSection, setShowFormNewSection] = useState(false);
  const [formNewSectionName, setFormNewSectionName] = useState('');
  const [creatingSec, setCreatingSec] = useState(false);

  /** Clockify-style quick bar */
  const [quickDesc, setQuickDesc] = useState('');
  const [quickProjectId, setQuickProjectId] = useState('');
  const [quickSectionId, setQuickSectionId] = useState('');
  const [quickFrom, setQuickFrom] = useState('0900');
  const [quickTo, setQuickTo] = useState('1700');
  const [quickWorkDate, setQuickWorkDate] = useState<string | null>(null);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

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


  const resetForm = () => {
    setFormProjectId(''); setFormSectionId(''); setFormDescription(''); setFormTimeFrom(''); setFormTimeTo('');
    setShowFormNewSection(false); setFormNewSectionName('');
  };

  const handleCreateQuickSection = async () => {
    if (!quickNewSectionName.trim() || !quickProjectId) return;
    setCreatingSec(true);
    try {
      await addSection(quickProjectId, quickNewSectionName.trim());
      const updatedProj = useAppStore.getState().projects.find(p => p.id === quickProjectId);
      const newSec = updatedProj?.sections.find(s => s.name.trim() === quickNewSectionName.trim());
      if (newSec) setQuickSectionId(newSec.id);
      setQuickNewSectionName(''); setShowQuickNewSection(false);
      toast.success('Section created');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create section'); }
    finally { setCreatingSec(false); }
  };

  const handleCreateFormSection = async () => {
    if (!formNewSectionName.trim() || !formProjectId) return;
    setCreatingSec(true);
    try {
      await addSection(formProjectId, formNewSectionName.trim());
      const updatedProj = useAppStore.getState().projects.find(p => p.id === formProjectId);
      const newSec = updatedProj?.sections.find(s => s.name.trim() === formNewSectionName.trim());
      if (newSec) setFormSectionId(newSec.id);
      setFormNewSectionName(''); setShowFormNewSection(false);
      toast.success('Section created');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create section'); }
    finally { setCreatingSec(false); }
  };

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

  const toggleOnLeave = (date: string) => {
    setOnLeaveDays(prev => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date); else next.add(date);
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

  useEffect(() => {
    setQuickWorkDate(prev => {
      if (prev === null) return defaultNewDate;
      if (visibleWeekDates.includes(prev)) return prev;
      return defaultNewDate;
    });
  }, [weekOffset, defaultNewDate, visibleWeekDates]);

  const quickSelectedProject = userProjects.find(p => p.id === quickProjectId);
  const quickSectionOptions = quickSelectedProject?.sections ?? [];
  const quickDurationPreview = spanSecondsFromCompact(quickFrom, quickTo);

  const saveQuickEntry = async () => {
    const workDate = quickWorkDate ?? defaultNewDate;
    if (!quickProjectId || !quickSectionId) {
      toast.error('Select a project and section');
      return;
    }
    let timeFromApi: string;
    let timeToApi: string;
    try {
      timeFromApi = compactTimeToApi(quickFrom);
      timeToApi = compactTimeToApi(quickTo);
    } catch {
      toast.error('Enter valid start and end times (24h, e.g. 0930).');
      return;
    }
    setSaving(true);
    try {
      await api.createTimesheetWorkEntry({
        workDate,
        projectId: quickProjectId,
        sectionId: quickSectionId,
        description: quickDesc,
        timeFrom: timeFromApi,
        timeTo: timeToApi,
      });
      toast.success('Entry added');
      setQuickDesc('');
      await reloadEntries();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

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

  // ── Email helpers ──────────────────────────────────────────────────────────
  const EMAIL_PROJ_COLORS = ['#3b82f6','#8b5cf6','#10b981','#f97316','#ec4899','#14b8a6','#f59e0b','#06b6d4','#6366f1','#f43f5e'];
  const projEmailColor = (id: string) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff; return EMAIL_PROJ_COLORS[h % EMAIL_PROJ_COLORS.length]; };

  const addToTag = (email: string) => {
    const e = email.trim().replace(/,+$/, '');
    if (e && !notifyToTags.includes(e)) setNotifyToTags(prev => [...prev, e]);
    setNotifyToInput('');
  };
  const addCcTag = (email: string) => {
    const e = email.trim().replace(/,+$/, '');
    if (e && !notifyCcTags.includes(e)) setNotifyCcTags(prev => [...prev, e]);
    setNotifyCcInput('');
  };
  const toggleUserToTag = (userEmail: string) => {
    if (notifyToTags.includes(userEmail)) setNotifyToTags(prev => prev.filter(t => t !== userEmail));
    else setNotifyToTags(prev => [...prev, userEmail]);
  };

  const buildEmailHtml = (summary: typeof scheduleSummary): string => {
    const senderName = currentUser?.name ?? 'Team member';
    const sorted = [...summary].filter(Boolean);
    const dateRange = sorted.length === 0 ? ''
      : sorted.length === 1
        ? `${sorted[0]!.dayName}, ${formatDisplayDate(sorted[0]!.date)}`
        : `${sorted[0]!.dayName} ${formatDisplayDate(sorted[0]!.date)} – ${sorted[sorted.length - 1]!.dayName} ${formatDisplayDate(sorted[sorted.length - 1]!.date)}`;
    const totalAllSecs = sorted.reduce((acc, d) => acc + (d?.totalSeconds ?? 0), 0);

    const colHeaders = `
      <tr bgcolor="#f8fafc">
        <td width="26%" style="padding:8px 10px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #e2e8f0;">PROJECT &middot; SECTION</td>
        <td width="42%" style="padding:8px 10px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #e2e8f0;">DESCRIPTION</td>
        <td width="16%" style="padding:8px 10px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #e2e8f0;">TIME</td>
        <td width="16%" style="padding:8px 10px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.08em;border-bottom:1px solid #e2e8f0;text-align:right;">DURATION</td>
      </tr>`;

    const dayRows = sorted.map(d => {
      if (!d) return '';
      const dayTotal = d.totalSeconds > 0 ? formatDuration(d.totalSeconds) : '&mdash;';

      const isOnLeave = onLeaveDays.has(d.date);

      const entryRows = isOnLeave
        ? `<tr><td colspan="4" style="padding:14px 10px;background:#fffbeb;border-left:3px solid #f59e0b;">
            <span style="font-size:13px;font-weight:600;color:#b45309;">On Leave</span>
            <span style="font-size:12px;color:#92400e;margin-left:6px;">— no work logged this day</span>
           </td></tr>`
        : d.entriesForDay.length > 0 ? d.entriesForDay.map(en => {
          const proj = projects.find(p => p.id === en.projectId);
          const sec = proj?.sections.find(s => s.id === en.sectionId);
          const pc = proj ? projEmailColor(proj.id) : '#6b7280';
          const desc = en.description?.trim() || '<em style="color:#94a3b8;">No description</em>';
          const projSecHtml = proj
            ? `<span style="font-size:12px;font-weight:700;color:${pc};">${proj.name}</span>${sec ? `<br><span style="font-size:11px;color:#94a3b8;">${sec.name}</span>` : ''}`
            : '<span style="color:#94a3b8;">—</span>';
          return `<tr>
            <td style="padding:11px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;">${projSecHtml}</td>
            <td style="padding:11px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;color:#1e293b;line-height:1.5;">${desc}</td>
            <td style="padding:11px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:12px;color:#64748b;white-space:nowrap;">${en.timeFrom}&nbsp;&ndash;&nbsp;${en.timeTo}</td>
            <td style="padding:11px 10px;border-bottom:1px solid #f1f5f9;vertical-align:top;font-size:13px;font-weight:800;color:#1e293b;text-align:right;white-space:nowrap;">${formatDuration(en.seconds)}</td>
          </tr>`;
        }).join('')
        : `<tr><td colspan="4" style="padding:14px 10px;color:#94a3b8;font-size:13px;font-style:italic;">No entries logged</td></tr>`;

      return `
        <tr>
          <td colspan="4" style="padding:20px 10px 10px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="font-size:18px;font-weight:800;color:#1e293b;">${d.dayName}&nbsp;<span style="font-size:14px;font-weight:400;color:#94a3b8;">${formatDisplayDate(d.date)}</span>${isOnLeave ? '&nbsp;<span style="font-size:11px;font-weight:700;color:#b45309;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:1px 6px;">On Leave</span>' : ''}</td>
              <td style="text-align:right;font-size:14px;font-weight:700;color:#6366f1;">${isOnLeave ? '' : dayTotal}</td>
            </tr></table>
          </td>
        </tr>
        ${isOnLeave ? '' : colHeaders}
        ${entryRows}`;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
  <tr><td align="center">
    <table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(15,23,42,.08);">

      <!-- Header -->
      <tr><td bgcolor="#0f172a" style="padding:28px 20px 24px;">
        <h1 style="margin:0 0 6px;font-size:24px;color:#ffffff;font-weight:800;letter-spacing:-.01em;">Timesheet Report</h1>
        <p style="margin:0;font-size:13px;color:#ffffff;">${senderName} &middot; ${dateRange}</p>
      </td></tr>

      <!-- Day rows -->
      <tr><td style="padding:0 10px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          ${dayRows}
        </table>
      </td></tr>

      <!-- Total -->
      <tr><td style="padding:16px 20px;border-top:1px solid #e2e8f0;">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="color:#7c3aed;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;">Total Hours Logged</td>
          <td style="text-align:right;color:#0f172a;font-size:26px;font-weight:800;letter-spacing:-.02em;">${formatDuration(totalAllSecs)}</td>
        </tr></table>
      </td></tr>

      <!-- Footer -->
      <tr><td style="padding:12px 20px;border-top:1px solid #f1f5f9;text-align:center;">
        <p style="margin:0;font-size:11px;color:#94a3b8;">Sent via Zet</p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body></html>`;
  };

  const handleNotify = async () => {
    const toList = [...notifyToTags, ...(notifyToInput.trim() ? [notifyToInput.trim()] : [])].filter(Boolean);
    if (toList.length === 0) return toast.error('Add at least one recipient email address');
    if (selectedDays.length === 0) return toast.error('Select at least one day');
    if (!isMicrosoftAuthConfigured()) return toast.error('Microsoft sign-in is not configured. Set VITE_MICROSOFT_CLIENT_ID in .env.');
    if (!hasMicrosoftSession()) return toast.error('Sign in with Microsoft to send emails from your account.');
    setSendingEmail(true);
    try {
      const token = await acquireGraphToken();
      const html = buildEmailHtml(scheduleSummary);
      const ccList = [...notifyCcTags, ...(notifyCcInput.trim() ? [notifyCcInput.trim()] : [])].filter(Boolean);
      const message: Record<string, unknown> = {
        subject: notifySubject.trim() || `Timesheet report – ${currentUser?.name}`,
        body: { contentType: 'HTML', content: html },
        toRecipients: toList.map(e => ({ emailAddress: { address: e } })),
      };
      if (ccList.length > 0) message.ccRecipients = ccList.map(e => ({ emailAddress: { address: e } }));
      const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, saveToSentItems: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
        throw new Error(err?.error?.message ?? `Graph API error ${res.status}`);
      }
      toast.success(`Email sent to ${toList.length} recipient${toList.length > 1 ? 's' : ''}!`);
      setNotifyOpen(false);
      setSelectedDays([]);
      setNotifyToTags([]); setNotifyToInput('');
      setNotifyCcTags([]); setNotifyCcInput('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
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
      <div className="shrink-0 px-4 sm:px-8 pt-6 sm:pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Work Log</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
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
              onClick={() => {
                const activeDays = visibleWeekDates.filter(d => (dayView.find(dv => dv.date === d)?.totalSeconds ?? 0) > 0);
                setSelectedDays(activeDays);
                const sorted = [...activeDays].sort();
                const range = sorted.length === 0 ? weekLabel
                  : sorted.length === 1 ? formatDisplayDate(sorted[0])
                  : `${formatDisplayDate(sorted[0])} – ${formatDisplayDate(sorted[sorted.length - 1])}`;
                setNotifySubject(sorted.length <= 1
                  ? `${currentUser.name}'s timesheet – ${range}`
                  : `${currentUser.name}'s timesheet from ${formatDisplayDate(sorted[0])} to ${formatDisplayDate(sorted[sorted.length - 1])}`);
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

        {/* ── Quick entry bar (Clockify-style) ─────────────────────────────── */}
        <div
          className={cn(
            'mt-5 rounded-2xl border border-border/40 bg-card shadow-sm',
            'flex flex-wrap items-stretch gap-0 divide-y md:divide-y-0 md:divide-x divide-border/30',
            userProjects.length === 0 && 'opacity-60 pointer-events-none',
          )}
        >
          <div className="flex-1 min-w-[200px] flex items-center px-3 py-2.5 md:border-0">
            <input
              id="timesheet-quick-desc"
              type="text"
              placeholder="What have you worked on?"
              value={quickDesc}
              onChange={e => setQuickDesc(e.target.value)}
              disabled={saving || userProjects.length === 0}
              className="w-full bg-transparent text-sm placeholder:text-muted-foreground/45 focus:outline-none focus:ring-0 border-0 px-1 py-1"
            />
          </div>

          <div className="flex flex-wrap items-center gap-0 sm:gap-1 px-2 py-2 md:py-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={saving || userProjects.length === 0}
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 max-w-[160px]',
                    quickProjectId
                      ? 'text-foreground hover:bg-muted/60'
                      : 'text-primary hover:bg-primary/10',
                  )}
                >
                  {quickProjectId && quickSelectedProject ? (
                    <>
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${idDotColor(quickProjectId)}`} />
                      <span className="truncate">{quickSelectedProject.name}</span>
                    </>
                  ) : (
                    <>
                      <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 bg-primary/10 text-primary shrink-0">
                        <Plus className="h-3.5 w-3.5" />
                      </span>
                      Project
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 rounded-xl max-h-64 overflow-y-auto">
                {userProjects.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">No projects</div>
                ) : (
                  userProjects.map(p => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => {
                        setQuickProjectId(p.id);
                        const first = p.sections[0]?.id ?? '';
                        setQuickSectionId(prev => {
                          if (p.sections.some(s => s.id === prev)) return prev;
                          return first;
                        });
                        setShowQuickNewSection(false);
                        setQuickNewSectionName('');
                      }}
                      className="rounded-lg cursor-pointer flex items-center gap-2"
                    >
                      <span className={`w-2 h-2 rounded-full shrink-0 ${idDotColor(p.id)}`} />
                      {p.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={saving || !quickProjectId}
                  className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-xs font-semibold text-foreground/80 hover:bg-muted/60 transition-colors disabled:opacity-40 max-w-[140px]"
                >
                  {quickSectionId ? (
                    <>
                      <span className={`w-2 h-2 rounded-full shrink-0 ${idDotColor(quickSectionId)}`} />
                      <span className="truncate">{quickSectionOptions.find(s => s.id === quickSectionId)?.name ?? 'Section'}</span>
                    </>
                  ) : (
                    <span className="truncate text-muted-foreground">Section</span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-52 rounded-xl max-h-56 overflow-y-auto">
                {!quickProjectId ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">Pick a project first</div>
                ) : quickSectionOptions.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">No sections — create one below</div>
                ) : (
                  quickSectionOptions.map(s => (
                    <DropdownMenuItem
                      key={s.id}
                      onClick={() => setQuickSectionId(s.id)}
                      className="rounded-lg cursor-pointer"
                    >
                      {s.name}
                    </DropdownMenuItem>
                  ))
                )}
                {quickProjectId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowQuickNewSection(true)}
                      className="rounded-lg cursor-pointer text-primary font-semibold"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> Create section
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="hidden sm:flex h-8 w-px bg-border/40 mx-0.5" aria-hidden />
            <button type="button" className="p-2 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors" title="Tags (coming soon)">
              <Tag className="h-4 w-4" />
            </button>
            <button type="button" className="p-2 rounded-lg text-muted-foreground/40 hover:text-muted-foreground hover:bg-muted/50 transition-colors" title="Billable (coming soon)">
              <DollarSign className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-1.5 px-2 font-mono text-xs tabular-nums text-foreground/80">
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="0900"
                value={quickFrom}
                onChange={e => setQuickFrom(e.target.value.replace(/\D/g, '').slice(0, 4))}
                disabled={saving || userProjects.length === 0}
                className="w-12 bg-muted/30 rounded-md border border-border/40 px-1.5 py-1 text-center text-xs"
              />
              <span className="text-muted-foreground/50">–</span>
              <input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="1700"
                value={quickTo}
                onChange={e => setQuickTo(e.target.value.replace(/\D/g, '').slice(0, 4))}
                disabled={saving || userProjects.length === 0}
                className="w-12 bg-muted/30 rounded-md border border-border/40 px-1.5 py-1 text-center text-xs"
              />
            </div>

            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={saving || userProjects.length === 0}
                  className="inline-flex items-center gap-1.5 px-2 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors disabled:opacity-50"
                >
                  <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <span className="whitespace-nowrap">
                    {formatQuickDateLabel(quickWorkDate ?? defaultNewDate, todayStr)}
                  </span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 rounded-xl border-border/60" align="start">
                <Calendar
                  mode="single"
                  selected={new Date(`${(quickWorkDate ?? defaultNewDate)}T12:00:00`)}
                  onSelect={date => {
                    if (!date) return;
                    const iso = localISODate(date);
                    if (iso > todayStr) return;
                    setQuickWorkDate(iso);
                    setWeekOffset(weekOffsetForIsoDate(iso));
                    setDatePickerOpen(false);
                  }}
                  disabled={date => localISODate(date) > todayStr}
                />
              </PopoverContent>
            </Popover>

            <div className="px-2 font-mono text-sm font-bold tabular-nums text-foreground min-w-[5.5rem] text-center">
              {formatDurationHMS(quickDurationPreview)}
            </div>

            <button
              type="button"
              disabled={saving || userProjects.length === 0}
              onClick={() => void saveQuickEntry()}
              className="m-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-bold uppercase tracking-wide hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
            >
              {saving ? '…' : 'Add'}
            </button>

            <div className="hidden md:flex flex-col border-l border-border/30 py-1 pl-1">
              <button type="button" className="p-1.5 rounded-md text-primary bg-primary/10" title="Timer mode">
                <Clock className="h-4 w-4" />
              </button>
              <button type="button" className="p-1.5 rounded-md text-muted-foreground/50 hover:text-muted-foreground" title="List view">
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Quick bar inline section creation ────────────────────────────── */}
        {showQuickNewSection && quickProjectId && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/5 px-4 py-2.5">
            <span className="text-xs font-semibold text-primary/70 shrink-0">New section:</span>
            <input
              autoFocus
              value={quickNewSectionName}
              onChange={e => setQuickNewSectionName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') void handleCreateQuickSection();
                if (e.key === 'Escape') { setShowQuickNewSection(false); setQuickNewSectionName(''); }
              }}
              placeholder="Section name…"
              disabled={creatingSec}
              className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/40"
            />
            <button
              type="button"
              onClick={() => void handleCreateQuickSection()}
              disabled={!quickNewSectionName.trim() || creatingSec}
              className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold disabled:opacity-40 transition-opacity shrink-0"
            >
              {creatingSec ? '…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => { setShowQuickNewSection(false); setQuickNewSectionName(''); }}
              className="p-1.5 rounded-lg text-muted-foreground hover:bg-muted/50 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* ── Scrollable body ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 sm:p-8 space-y-6">

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
        ) : (
          <div className="space-y-4">
            <AnimatePresence initial={false}>
              {dayView.map((day, idx) => {
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
                          onClick={() => toggleOnLeave(day.date)}
                          className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-all font-medium ${
                            onLeaveDays.has(day.date)
                              ? 'bg-amber-500/15 text-amber-600 border border-amber-500/30 hover:bg-amber-500/25'
                              : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/60'
                          }`}
                        >
                          <CalendarX2 className="h-3.5 w-3.5" />
                          {onLeaveDays.has(day.date) ? 'On Leave ✓' : 'On Leave'}
                        </button>

                        {!onLeaveDays.has(day.date) && (
                          <>
                            <button
                              type="button"
                              disabled={userProjects.length === 0}
                              onClick={() => setAiOpenDay(prev => prev === day.date ? null : day.date)}
                              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border transition-all disabled:opacity-40 ${
                                aiOpenDay === day.date
                                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-400'
                                  : 'border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/15 text-violet-400'
                              }`}
                            >
                              <Sparkles className="h-3.5 w-3.5" /> AI
                            </button>
                            <button
                              type="button"
                              disabled={userProjects.length === 0}
                              onClick={() => openNewModal(day.date)}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl font-semibold border border-border/40 bg-muted/30 hover:bg-primary/8 hover:border-primary/30 hover:text-primary text-muted-foreground transition-all disabled:opacity-40"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* AI Panel */}
                    <AnimatePresence>
                      {aiOpenDay === day.date && !onLeaveDays.has(day.date) && (
                        <TimesheetAIPanel
                          date={day.date}
                          onClose={() => setAiOpenDay(null)}
                          onEntriesAdded={reloadEntries}
                        />
                      )}
                    </AnimatePresence>

                    {/* Entries */}
                    {onLeaveDays.has(day.date) ? (
                      <div className="px-5 py-6 flex items-center justify-center gap-2.5 text-amber-500/70">
                        <CalendarX2 className="h-4 w-4 shrink-0" />
                        <span className="text-sm font-medium">On leave — no entries for this day</span>
                      </div>
                    ) : day.entriesForDay.length === 0 ? (
                      <div className="px-5 py-7 text-center text-sm text-muted-foreground/40 italic">
                        Nothing logged yet —{' '}
                        <button
                          type="button"
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
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-bold text-muted-foreground/60 uppercase tracking-wide" htmlFor="ts-section">Section</Label>
                  {formProjectId && !showFormNewSection && (
                    <button
                      type="button"
                      onClick={() => setShowFormNewSection(true)}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
                    >
                      <Plus className="h-3 w-3" /> New
                    </button>
                  )}
                </div>
                {showFormNewSection ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={formNewSectionName}
                      onChange={e => setFormNewSectionName(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') void handleCreateFormSection();
                        if (e.key === 'Escape') { setShowFormNewSection(false); setFormNewSectionName(''); }
                      }}
                      placeholder="Section name…"
                      className={inputCls}
                      disabled={creatingSec}
                    />
                    <button
                      type="button"
                      onClick={() => void handleCreateFormSection()}
                      disabled={!formNewSectionName.trim() || creatingSec}
                      className="shrink-0 px-3 py-2 text-xs rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-40"
                    >
                      {creatingSec ? '…' : 'Create'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowFormNewSection(false); setFormNewSectionName(''); }}
                      className="shrink-0 p-2 rounded-xl border border-border/50 text-muted-foreground hover:bg-muted/50"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <select
                    id="ts-section"
                    value={formSectionId}
                    onChange={e => setFormSectionId(e.target.value)}
                    className={inputCls}
                    disabled={saving || !formProjectId}
                  >
                    <option value="">
                      {!formProjectId ? 'Pick a project first' : sectionOptions.length === 0 ? 'No sections — create one →' : 'Choose section…'}
                    </option>
                    {sectionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                )}
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
      <Dialog open={notifyOpen} onOpenChange={v => {
        setNotifyOpen(v);
        if (!v) { setNotifyToTags([]); setNotifyToInput(''); setNotifyCcTags([]); setNotifyCcInput(''); }
      }}>
        <DialogContent className="sm:max-w-lg flex max-h-[min(90dvh,92vh)] min-h-0 flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pb-4 pt-2 text-left border-b border-border/60">
            <DialogTitle className="text-xl font-bold">Send timesheet email</DialogTitle>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-5">

            {/* From */}
            <div className="rounded-xl border border-border/50 bg-muted/20 px-4 py-3 flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">From (your Microsoft account)</p>
                <p className="text-sm font-medium truncate">{currentUser.name} <span className="text-muted-foreground font-normal">&lt;{currentUser.email}&gt;</span></p>
              </div>
            </div>

            {/* MS warnings */}
            {!isMicrosoftAuthConfigured() && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
                <strong>Microsoft sign-in not configured.</strong> Set <code>VITE_MICROSOFT_CLIENT_ID</code> in <code>frontend/.env</code> and restart to enable email sending.
              </div>
            )}
            {isMicrosoftAuthConfigured() && !hasMicrosoftSession() && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-600 dark:text-amber-400">
                <strong>Not signed in with Microsoft.</strong> Sign out and use <em>Sign in with Microsoft</em> to send emails from your account.
              </div>
            )}

            {/* Day picker */}
            <div>
              <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-2.5">Days to include</p>
              <div className="flex flex-wrap gap-2">
                {[...visibleWeekDates].sort((a, b) => b.localeCompare(a)).map(date => {
                  const i = weekDates.indexOf(date);
                  const isSelected = selectedDays.includes(date);
                  return (
                    <motion.button key={date} type="button" transition={snappy} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                      onClick={() => toggleDay(date)}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${isSelected ? 'bg-primary/15 text-primary border-primary/30 shadow-sm' : 'bg-muted/40 border-border/40 text-muted-foreground hover:bg-muted/70 hover:border-border/60'}`}>
                      {dayShort[i] ?? ''} {formatDisplayDate(date)}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* To field */}
            <div className="space-y-1.5">
              <Label>To <span className="text-destructive">*</span></Label>
              <div className="relative">
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div className="w-full min-h-[42px] rounded-xl border border-border/80 bg-background px-3 py-2 flex flex-wrap gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-primary/40"
                     onClick={() => document.getElementById('notify-to-input')?.focus()}>
                  {notifyToTags.map(email => (
                    <span key={email} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-primary/10 text-primary text-xs font-medium border border-primary/20 shrink-0">
                      {email}
                      <button type="button" onClick={e => { e.stopPropagation(); setNotifyToTags(prev => prev.filter(t => t !== email)); }}
                              className="p-0.5 rounded hover:bg-primary/20 transition-colors">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <input id="notify-to-input" type="text" value={notifyToInput}
                    onChange={e => { setNotifyToInput(e.target.value); setShowToSuggestions(true); }}
                    onFocus={() => setShowToSuggestions(true)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',') && notifyToInput.trim()) {
                        e.preventDefault(); addToTag(notifyToInput); setShowToSuggestions(false);
                      } else if (e.key === 'Backspace' && !notifyToInput && notifyToTags.length > 0) {
                        setNotifyToTags(prev => prev.slice(0, -1));
                      } else if (e.key === 'Escape') {
                        setShowToSuggestions(false);
                      }
                    }}
                    onBlur={() => { setTimeout(() => setShowToSuggestions(false), 150); if (notifyToInput.trim()) addToTag(notifyToInput); }}
                    placeholder={notifyToTags.length === 0 ? 'Type name or email…' : ''}
                    className="flex-1 min-w-[150px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/50" />
                </div>
                {showToSuggestions && (() => {
                  const q = notifyToInput.toLowerCase();
                  const suggestions = q.length > 0
                    ? users.filter(u => !notifyToTags.includes(u.email) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
                    : [];
                  return suggestions.length > 0 ? (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border/60 bg-popover shadow-lg overflow-hidden">
                      {suggestions.slice(0, 6).map(u => (
                        <button key={u.id} type="button"
                          onMouseDown={e => { e.preventDefault(); addToTag(u.email); setShowToSuggestions(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors text-left">
                          <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium truncate">{u.name}{u.id === currentUser.id ? ' (you)' : ''}</span>
                            <span className="block text-xs text-muted-foreground truncate">{u.email}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            {/* CC field */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>CC <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                <button type="button" onClick={() => { if (!notifyCcTags.includes(currentUser.email)) addCcTag(currentUser.email); }}
                        className="text-xs text-primary hover:text-primary/80 font-semibold transition-colors">
                  + CC myself
                </button>
              </div>
              <div className="relative">
                {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                <div className="w-full min-h-[42px] rounded-xl border border-border/80 bg-background px-3 py-2 flex flex-wrap gap-1.5 cursor-text focus-within:ring-2 focus-within:ring-primary/40"
                     onClick={() => document.getElementById('notify-cc-input')?.focus()}>
                  {notifyCcTags.map(email => (
                    <span key={email} className="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-muted/60 text-foreground text-xs font-medium border border-border/50 shrink-0">
                      {email}
                      <button type="button" onClick={e => { e.stopPropagation(); setNotifyCcTags(prev => prev.filter(t => t !== email)); }}
                              className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground hover:text-foreground">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <input id="notify-cc-input" type="text" value={notifyCcInput}
                    onChange={e => { setNotifyCcInput(e.target.value); setShowCcSuggestions(true); }}
                    onFocus={() => setShowCcSuggestions(true)}
                    onKeyDown={e => {
                      if ((e.key === 'Enter' || e.key === ',') && notifyCcInput.trim()) {
                        e.preventDefault(); addCcTag(notifyCcInput); setShowCcSuggestions(false);
                      } else if (e.key === 'Backspace' && !notifyCcInput && notifyCcTags.length > 0) {
                        setNotifyCcTags(prev => prev.slice(0, -1));
                      } else if (e.key === 'Escape') {
                        setShowCcSuggestions(false);
                      }
                    }}
                    onBlur={() => { setTimeout(() => setShowCcSuggestions(false), 150); if (notifyCcInput.trim()) addCcTag(notifyCcInput); }}
                    placeholder={notifyCcTags.length === 0 ? 'Type name or email…' : ''}
                    className="flex-1 min-w-[150px] bg-transparent outline-none text-sm placeholder:text-muted-foreground/50" />
                </div>
                {showCcSuggestions && (() => {
                  const q = notifyCcInput.toLowerCase();
                  const suggestions = q.length > 0
                    ? users.filter(u => !notifyCcTags.includes(u.email) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
                    : [];
                  return suggestions.length > 0 ? (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-xl border border-border/60 bg-popover shadow-lg overflow-hidden">
                      {suggestions.slice(0, 6).map(u => (
                        <button key={u.id} type="button"
                          onMouseDown={e => { e.preventDefault(); addCcTag(u.email); setShowCcSuggestions(false); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors text-left">
                          <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium truncate">{u.name}{u.id === currentUser.id ? ' (you)' : ''}</span>
                            <span className="block text-xs text-muted-foreground truncate">{u.email}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <Label htmlFor="notify-subject">Subject</Label>
              <input id="notify-subject" value={notifySubject} onChange={e => setNotifySubject(e.target.value)}
                placeholder={`Timesheet report – ${currentUser.name}`} className={inputCls} />
            </div>

            {/* Preview */}
            {scheduleSummary.length > 0 && (
              <div className="rounded-xl border border-border/35 bg-muted/10 p-4 max-h-[200px] overflow-y-auto space-y-3">
                <h4 className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest">Content preview</h4>
                {scheduleSummary.map(d => d && (
                  <div key={d.date} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold">{d.dayName} <span className="text-xs font-normal text-muted-foreground/60">{formatDisplayDate(d.date)}</span></span>
                      <span className="text-xs font-bold text-primary shrink-0">{formatDuration(d.totalSeconds)}</span>
                    </div>
                    {d.entriesForDay.length > 0 ? d.entriesForDay.map(en => {
                      const proj = projects.find(p => p.id === en.projectId);
                      const sec = proj?.sections.find(s => s.id === en.sectionId);
                      return (
                        <div key={en.id} className="pl-3 border-l-2 border-border/40 space-y-0.5">
                          <p className="text-xs text-foreground leading-snug break-words [overflow-wrap:anywhere]">{en.description?.trim() || <em className="text-muted-foreground/50">No description</em>}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-semibold" style={{ color: projEmailColor(en.projectId) }}>{proj?.name}</span>
                            {sec && <><span className="text-muted-foreground/40 text-[10px]">›</span><span className="text-[10px] text-muted-foreground">{sec.name}</span></>}
                            <span className="text-[10px] text-muted-foreground/60 ml-auto">{en.timeFrom}–{en.timeTo} · {formatDuration(en.seconds)}</span>
                          </div>
                        </div>
                      );
                    }) : <p className="pl-3 text-xs text-muted-foreground/40 italic">No entries</p>}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="shrink-0 px-6 py-4 border-t border-border/60 flex gap-2 justify-end bg-muted/10">
            <Button variant="ghost" onClick={() => setNotifyOpen(false)} className="rounded-xl">Cancel</Button>
            <button
              onClick={() => void handleNotify()}
              disabled={(notifyToTags.length === 0 && !notifyToInput.trim()) || selectedDays.length === 0 || sendingEmail || !isMicrosoftAuthConfigured() || !hasMicrosoftSession()}
              className="flex items-center gap-2 text-sm px-5 py-2.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all font-semibold"
            >
              {sendingEmail
                ? <><span className="h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" /> Sending…</>
                : <><Send className="h-3.5 w-3.5" /> Send to {notifyToTags.length + (notifyToInput.trim() ? 1 : 0) || ''}{notifyToTags.length + (notifyToInput.trim() ? 1 : 0) > 0 ? ` recipient${notifyToTags.length + (notifyToInput.trim() ? 1 : 0) > 1 ? 's' : ''}` : 'email'}</>
              }
            </button>
          </div>
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
