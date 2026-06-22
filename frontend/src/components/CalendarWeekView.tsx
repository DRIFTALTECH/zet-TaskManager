/**
 * CalendarWeekView — Clockify-style week/day grid.
 *  - Drag empty space → create (15-min snap).
 *  - Drag a block body → move it (vertically and across days).
 *  - Drag a block's top/bottom edge (the "=" grip) → resize start/end.
 *  - Click a block → edit. Overlapping entries lay out side-by-side in columns.
 */
import { useRef, useState } from 'react';
import { DollarSign } from 'lucide-react';
import { cn } from '@/lib/utils';
import { idHue } from '@/lib/pill-color';
import type { TimesheetWorkEntry, Project } from '@/types';

const CAL_HOUR_H = 56;

function calMinutes(s: string): number | null {
  const m = (s || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Math.min(1440, parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
}
function fmtDur(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtHMS(seconds: number): string {
  const t = Math.max(0, Math.floor(seconds));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
const toCompact = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Lane-pack overlapping entries → each gets {lane, cols} so they sit side-by-side. */
function layoutDay(items: { id: string; start: number; end: number }[]): Map<string, { lane: number; cols: number }> {
  const map = new Map<string, { lane: number; cols: number }>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);
  let columns: number[] = [];
  let cluster: { id: string; lane: number }[] = [];
  let lastEnd = -1;
  const flush = () => {
    const n = Math.max(1, columns.length);
    for (const c of cluster) map.set(c.id, { lane: c.lane, cols: n });
    columns = [];
    cluster = [];
  };
  for (const it of sorted) {
    if (it.start >= lastEnd) { flush(); lastEnd = -1; }
    let lane = columns.findIndex(end => end <= it.start);
    if (lane === -1) { lane = columns.length; columns.push(it.end); } else { columns[lane] = it.end; }
    cluster.push({ id: it.id, lane });
    lastEnd = Math.max(lastEnd, it.end);
  }
  flush();
  return map;
}

export default function CalendarWeekView({ weekDates, entries, projects, todayStr, onSelectEntry, onAddAt, onResizeEntry, onMoveEntry, onToggleBillable }: {
  weekDates: string[];
  entries: TimesheetWorkEntry[];
  projects: Project[];
  todayStr: string;
  onSelectEntry: (e: TimesheetWorkEntry) => void;
  onAddAt: (date: string, fromCompact: string, toCompact: string) => void;
  onResizeEntry: (entry: TimesheetWorkEntry, fromCompact: string, toCompact: string) => void;
  onMoveEntry: (entry: TimesheetWorkEntry, date: string, fromCompact: string, toCompact: string) => void;
  onToggleBillable: (entry: TimesheetWorkEntry) => void;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const cols = `52px repeat(${weekDates.length}, minmax(0, 1fr))`;
  const projName = (id: string) => projects.find(p => p.id === id)?.name ?? 'Project';
  const sectName = (id: string) => {
    for (const p of projects) { const s = p.sections.find(x => x.id === id); if (s) return s.name; }
    return '';
  };
  const dayLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
  const dayTotal = (iso: string) => entries.filter(e => e.workDate === iso).reduce((a, e) => a + e.seconds, 0);

  // ── Create-drag (empty space) ────────────────────────────────────────────────
  const [drag, setDrag] = useState<{ date: string; a: number; b: number } | null>(null);
  const minFromEvent = (clientY: number, el: HTMLElement): number => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1439, Math.round((((clientY - rect.top) / CAL_HOUR_H) * 60) / 15) * 15));
  };
  const finishDrag = () => {
    if (!drag) return;
    const lo = Math.min(drag.a, drag.b);
    let hi = Math.max(drag.a, drag.b);
    if (hi - lo < 15) hi = Math.min(1439, lo + 60);
    const d = drag.date;
    setDrag(null);
    onAddAt(d, toCompact(lo), toCompact(hi));
  };

  // ── Resize (top/bottom edge) ─────────────────────────────────────────────────
  const resizeRef = useRef<{ entry: TimesheetWorkEntry; edge: 'top' | 'bottom'; colTop: number; startMin: number; endMin: number; changed: boolean } | null>(null);
  const [resizePreview, setResizePreview] = useState<{ id: string; startMin: number; endMin: number } | null>(null);
  const beginResize = (ev: React.MouseEvent, entry: TimesheetWorkEntry, edge: 'top' | 'bottom') => {
    ev.stopPropagation();
    ev.preventDefault();
    const colEl = (ev.currentTarget as HTMLElement).closest('[data-col]') as HTMLElement | null;
    if (!colEl) return;
    const colTop = colEl.getBoundingClientRect().top;
    const s = calMinutes(entry.timeFrom);
    const en = calMinutes(entry.timeTo);
    if (s === null || en === null) return;
    resizeRef.current = { entry, edge, colTop, startMin: s, endMin: en, changed: false };
    setResizePreview({ id: entry.id, startMin: s, endMin: en });
    const onMove = (mv: MouseEvent) => {
      const d = resizeRef.current;
      if (!d) return;
      const pointer = Math.max(0, Math.min(1440, Math.round((((mv.clientY - d.colTop) / CAL_HOUR_H) * 60) / 15) * 15));
      if (d.edge === 'top') d.startMin = Math.min(d.endMin - 15, pointer);
      else d.endMin = Math.max(d.startMin + 15, pointer);
      d.changed = true;
      setResizePreview({ id: d.entry.id, startMin: d.startMin, endMin: d.endMin });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const d = resizeRef.current;
      resizeRef.current = null;
      setResizePreview(null);
      if (d && d.changed) onResizeEntry(d.entry, toCompact(d.startMin), toCompact(d.endMin));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Move (drag body, vertical + across days) ─────────────────────────────────
  const moveRef = useRef<{ entry: TimesheetWorkEntry; durMin: number; grabMin: number; date: string; startMin: number; moved: boolean } | null>(null);
  const [movePreview, setMovePreview] = useState<{ id: string; date: string; startMin: number } | null>(null);
  const beginMove = (ev: React.MouseEvent, entry: TimesheetWorkEntry) => {
    ev.stopPropagation();
    ev.preventDefault();
    const startX = ev.clientX, startY = ev.clientY;
    const colEl = (ev.currentTarget as HTMLElement).closest('[data-col]') as HTMLElement | null;
    if (!colEl) return;
    const colTop0 = colEl.getBoundingClientRect().top;
    const s = calMinutes(entry.timeFrom);
    const en = calMinutes(entry.timeTo);
    if (s === null || en === null) return;
    const dur = en - s;
    moveRef.current = { entry, durMin: dur, grabMin: ((ev.clientY - colTop0) / CAL_HOUR_H) * 60 - s, date: entry.workDate, startMin: s, moved: false };
    const onMove = (mv: MouseEvent) => {
      const d = moveRef.current;
      if (!d) return;
      if (!d.moved && Math.hypot(mv.clientX - startX, mv.clientY - startY) < 5) return;
      d.moved = true;
      // Which day column is the pointer over? → cross-day move.
      const under = document.elementFromPoint(mv.clientX, mv.clientY) as HTMLElement | null;
      const col = under?.closest('[data-col]') as HTMLElement | null;
      const date = col?.getAttribute('data-col') ?? d.date;
      const colTop = col ? col.getBoundingClientRect().top : colTop0;
      let ns = Math.round((((mv.clientY - colTop) / CAL_HOUR_H) * 60 - d.grabMin) / 15) * 15;
      ns = Math.max(0, Math.min(1440 - d.durMin, ns));
      d.date = date;
      d.startMin = ns;
      setMovePreview({ id: d.entry.id, date, startMin: ns });
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const d = moveRef.current;
      moveRef.current = null;
      setMovePreview(null);
      if (!d) return;
      if (d.moved) onMoveEntry(d.entry, d.date, toCompact(d.startMin), toCompact(d.startMin + d.durMin));
      else onSelectEntry(d.entry); // plain click → edit
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="rounded-2xl border border-border/40 bg-card shadow-sm overflow-x-auto">
      <div className="min-w-[760px]">
        {/* Day header */}
        <div className="grid sticky top-0 z-10 bg-card" style={{ gridTemplateColumns: cols }}>
          <div className="border-b border-foreground/20" />
          {weekDates.map(d => (
            <div key={d} className={cn('border-b border-l border-foreground/20 px-2 py-3 text-center', d === todayStr && 'bg-primary/5')}>
              <p className={cn('text-sm font-bold', d === todayStr ? 'text-primary' : 'text-foreground')}>{dayLabel(d)}</p>
              <p className="text-xs font-semibold tabular-nums text-muted-foreground/70">{fmtDur(dayTotal(d))}</p>
            </div>
          ))}
        </div>
        {/* Hour grid */}
        <div className="max-h-[calc(100vh-13rem)] overflow-y-auto">
          <div className="grid" style={{ gridTemplateColumns: cols }}>
            <div>
              {hours.map(h => (
                <div key={h} style={{ height: CAL_HOUR_H }} className="relative">
                  <span className="absolute -top-2 right-2 text-xs font-medium text-muted-foreground/60 tabular-nums">
                    {h === 0 ? '' : `${String(h).padStart(2, '0')}:00`}
                  </span>
                </div>
              ))}
            </div>
            {weekDates.map(date => {
              // Entries shown in this column: own day's, minus any being dragged away,
              // plus one being dragged INTO this day.
              const colEntries = entries.filter(e =>
                movePreview?.id === e.id ? movePreview.date === date : e.workDate === date,
              );
              const items = colEntries.map(e => {
                const s0 = calMinutes(e.timeFrom) ?? 0;
                const e0 = calMinutes(e.timeTo) ?? s0 + 15;
                const rz = resizePreview?.id === e.id ? resizePreview : null;
                const mv = movePreview?.id === e.id ? movePreview : null;
                let start = s0, end = e0;
                if (rz) { start = rz.startMin; end = rz.endMin; }
                if (mv) { start = mv.startMin; end = mv.startMin + (e0 - s0); }
                return { e, start, end, active: !!rz || !!mv };
              });
              const lay = layoutDay(items.map(it => ({ id: it.e.id, start: it.start, end: it.end })));
              return (
                <div
                  key={date}
                  data-col={date}
                  className={cn('relative border-l border-foreground/20 cursor-crosshair select-none', date === todayStr && 'bg-primary/[0.03]')}
                  style={{ height: CAL_HOUR_H * 24 }}
                  onMouseDown={ev => { const m = minFromEvent(ev.clientY, ev.currentTarget); setDrag({ date, a: m, b: m }); }}
                  onMouseMove={ev => {
                    if (!drag || drag.date !== date) return;
                    const m = minFromEvent(ev.clientY, ev.currentTarget);
                    setDrag(d => (d ? { ...d, b: m } : d));
                  }}
                  onMouseUp={finishDrag}
                  onMouseLeave={() => { if (drag && drag.date === date) setDrag(null); }}
                >
                  {hours.map(h => (
                    <div key={h} style={{ top: h * CAL_HOUR_H }} className="pointer-events-none absolute inset-x-0 border-b border-foreground/15" />
                  ))}

                  {drag && drag.date === date && (() => {
                    const lo = Math.min(drag.a, drag.b);
                    const hi = Math.max(drag.a, drag.b);
                    return (
                      <div className="pointer-events-none absolute inset-x-0 z-20 border-2 border-primary bg-primary/15"
                        style={{ top: (lo / 60) * CAL_HOUR_H, height: Math.max(4, ((hi - lo) / 60) * CAL_HOUR_H) }}>
                        <span className="absolute left-1.5 top-0.5 text-[11px] font-bold text-primary tabular-nums">{hhmm(lo)}–{hhmm(hi)}</span>
                      </div>
                    );
                  })()}

                  {items.map(({ e, start, end, active }) => {
                    const { lane, cols: nCols } = lay.get(e.id) ?? { lane: 0, cols: 1 };
                    const widthPct = 100 / nCols;
                    const leftPct = lane * widthPct;
                    const top = (start / 60) * CAL_HOUR_H;
                    const height = Math.max(22, ((Math.max(end, start + 15) - start) / 60) * CAL_HOUR_H);
                    const hue = idHue(e.projectId);
                    const sec = e.sectionId ? sectName(e.sectionId) : '';
                    return (
                      <div
                        key={e.id}
                        style={{
                          top: top + 1,
                          height: height - 2,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          borderLeftColor: `hsl(${hue} 70% 45%)`,
                          backgroundColor: 'hsl(var(--card))',
                        }}
                        className={cn(
                          'group/entry absolute z-10 rounded-sm border border-border/50 border-l-[3px] overflow-hidden transition-shadow',
                          active && 'z-30 shadow-lg ring-2 ring-primary/60',
                        )}
                      >
                        {/* top resize grip (=) — hover only */}
                        <div onMouseDown={ev => beginResize(ev, e, 'top')}
                          title="Drag to resize"
                          className="absolute inset-x-0 top-0 z-20 flex flex-col items-center justify-center gap-[3px] pt-1 pb-1.5 cursor-ns-resize opacity-0 group-hover/entry:opacity-100 transition-opacity">
                          <span className="block h-[2px] w-5 rounded-full bg-foreground/40" />
                          <span className="block h-[2px] w-5 rounded-full bg-foreground/40" />
                        </div>

                        {/* body — drag to move, click to edit */}
                        <div onMouseDown={ev => beginMove(ev, e)}
                          className="flex h-full flex-col cursor-grab active:cursor-grabbing">
                          <div className="flex-1 px-2.5 pt-1.5 overflow-hidden">
                            <p className="text-[13px] font-semibold text-foreground leading-snug break-words">
                              {e.description?.trim() || projName(e.projectId)}
                            </p>
                            {e.description?.trim() && (
                              <p className="text-[11px] font-medium leading-tight mt-1 break-words" style={{ color: `hsl(${hue} 45% 45%)` }}>
                                {projName(e.projectId)}{sec ? ` : ${sec}` : ''}
                              </p>
                            )}
                          </div>

                          {/* footer: $ · grip(=) · duration */}
                          <div className="flex items-center justify-between gap-1 px-2 pb-1.5">
                            <button type="button"
                              onMouseDown={ev => ev.stopPropagation()}
                              onClick={ev => { ev.stopPropagation(); onToggleBillable(e); }}
                              title={e.billable ? 'Billable — click to mark non-billable' : 'Non-billable — click to mark billable'}
                              className={cn('shrink-0', e.billable ? 'text-emerald-500' : 'text-muted-foreground/30 hover:text-muted-foreground/60')}>
                              <DollarSign className="h-4 w-4" />
                            </button>

                            {/* grip = bottom resize handle — hover only */}
                            <div onMouseDown={ev => beginResize(ev, e, 'bottom')}
                              title="Drag to resize"
                              className="flex flex-col items-center justify-center gap-[3px] px-3 py-1 cursor-ns-resize opacity-0 group-hover/entry:opacity-100 transition-opacity">
                              <span className="block h-[2px] w-4 rounded-full bg-foreground/35" />
                              <span className="block h-[2px] w-4 rounded-full bg-foreground/35" />
                            </div>

                            <span className="shrink-0 font-mono text-xs font-bold tabular-nums text-foreground/80">
                              {fmtHMS((Math.max(end, start + 15) - start) * 60)}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
