/**
 * Collapsible minimum-duration control for the task detail drawer.
 * Manager/admin only — parent decides visibility.
 */

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Timer } from 'lucide-react';
import { useAppStore } from '@/stores/appStore';
import type { Task } from '@/types';

const MAX_MINUTES = 180;

function clampMinutes(raw: number) {
  return Math.min(MAX_MINUTES, Math.max(0, Math.round(raw)));
}

/** Slider + numeric input — same behavior as the former card control. */
export function MinDurationControls({
  taskId,
  savedMinutes,
}: {
  taskId: string;
  savedMinutes: number;
}) {
  const { updateTask } = useAppStore();
  const [minLog, setMinLog] = useState(savedMinutes);
  useEffect(() => { setMinLog(savedMinutes); }, [savedMinutes, taskId]);

  const commitMinLog = async (raw: number) => {
    const m = clampMinutes(raw);
    setMinLog(m);
    if (m === savedMinutes) return;
    try {
      await updateTask(taskId, { minLogMinutes: m });
    } catch {
      setMinLog(savedMinutes);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground/70">
        Timer sessions shorter than this are not written to the timesheet.
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">Current</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">{minLog} min</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={MAX_MINUTES}
          step={1}
          value={minLog}
          onChange={e => setMinLog(Number(e.target.value))}
          onPointerUp={e => void commitMinLog(Number((e.target as HTMLInputElement).value))}
          onKeyUp={e => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
              void commitMinLog(minLog);
            }
          }}
          className="flex-1 min-w-0 h-2 accent-primary cursor-pointer"
        />
        <input
          type="number"
          min={0}
          max={MAX_MINUTES}
          value={minLog}
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isNaN(n)) return;
            setMinLog(clampMinutes(n));
          }}
          onBlur={() => void commitMinLog(minLog)}
          className="w-14 shrink-0 rounded-lg border border-border/50 bg-muted/30 px-2 py-1.5 text-sm text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
        <span className="text-xs text-muted-foreground/60 shrink-0">min</span>
      </div>
    </div>
  );
}

export function AdjustMinDurationSection({ task }: { task: Task }) {
  const [open, setOpen] = useState(false);
  const savedMinutes = clampMinutes(task.minLogMinutes ?? 1);

  useEffect(() => {
    setOpen(false);
  }, [task.id]);

  return (
    <section className="rounded-xl border border-border/40 bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Timer className="h-4 w-4 shrink-0 text-muted-foreground/70" />
          <span className="text-sm font-semibold text-foreground">Adjust Minimum Duration</span>
        </div>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="min-duration-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border/30">
              <MinDurationControls taskId={task.id} savedMinutes={savedMinutes} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
