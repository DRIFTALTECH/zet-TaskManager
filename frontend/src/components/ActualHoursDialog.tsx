import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Task } from '@/types';

export type ActualHoursMode = 'done' | 'approve';

type Pending = {
  task: Task;
  mode: ActualHoursMode;
  resolve: (hours: number | null) => void;
};

let listener: ((p: Pending | null) => void) | null = null;

/** Hours from the dialog, or `null` if cancelled. `0` means Clear. */
export function promptActualHours(task: Task, mode: ActualHoursMode): Promise<number | null> {
  return new Promise(resolve => {
    if (!listener) {
      resolve(null);
      return;
    }
    listener({ task, mode, resolve });
  });
}

export function parseHoursInput(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/hours?|hrs?/g, '').trim();
  if (!s) return null;
  const hm = /^(\d+):([0-5]?\d)$/.exec(s);
  if (hm) return Number(hm[1]) + Number(hm[2]) / 60;
  const n = Number(s.replace(/h$/, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10_000) return null;
  return n;
}

function fmtHours(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const h = seconds / 3600;
  return Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

/** Tracked seconds → the two fields, rounded to the nearest minute. */
function splitHM(seconds: number): { h: string; m: string } {
  const total = Math.max(0, Math.round((seconds || 0) / 60));
  if (total === 0) return { h: '', m: '' };
  return { h: String(Math.floor(total / 60)), m: String(total % 60) };
}

export function ActualHoursDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listener = setPending;
    return () => { listener = null; };
  }, []);

  useEffect(() => {
    if (!pending) return;
    const seeded = splitHM(pending.task.timeTracked || 0);
    setHours(seeded.h);
    setMinutes(seeded.m);
    setError('');
    const t = window.setTimeout(() => inputRef.current?.select(), 50);
    return () => window.clearTimeout(t);
  }, [pending]);

  const close = (hours: number | null) => {
    pending?.resolve(hours);
    setPending(null);
  };

  const confirm = () => {
    const h = hours.trim() === '' ? 0 : Number(hours);
    const m = minutes.trim() === '' ? 0 : Number(minutes);
    if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) {
      setError('Enter how long it took, or Clear.');
      return;
    }
    if (m > 59) {
      setError('Minutes must be 0–59.');
      return;
    }
    const total = h + m / 60;
    if (total <= 0) {
      setError('Enter how long it took, or Clear.');
      return;
    }
    if (total > 10_000) {
      setError('That is more hours than a task can hold.');
      return;
    }
    close(total);
  };

  const task = pending?.task;
  const tracked = task?.timeTracked ? fmtHours(task.timeTracked) : '';
  const estimate = task?.estimatedHours != null && task.estimatedHours > 0 ? String(task.estimatedHours) : '';
  const approve = pending?.mode === 'approve';

  return (
    <Dialog open={!!pending} onOpenChange={o => { if (!o) close(null); }}>
      <DialogContent className="max-w-sm rounded-2xl" onOpenAutoFocus={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{approve ? 'Approve task' : 'Move to Done'}</DialogTitle>
          <DialogDescription>
            How long did this actually take?
            {task?.title ? <span className="mt-1 block font-medium text-foreground">{task.title}</span> : null}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {(tracked || estimate) && (
            <p className="text-xs text-muted-foreground">
              {estimate ? <>Estimate {estimate}h</> : null}
              {estimate && tracked ? ' · ' : null}
              {tracked ? <>Tracked {tracked}h</> : null}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="actual-hours">Time spent</Label>
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  id="actual-hours"
                  ref={inputRef}
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={hours}
                  onChange={e => { setHours(e.target.value); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
                />
                <span className="block text-[11px] text-muted-foreground">Hours</span>
              </div>
              <div className="flex-1 space-y-1">
                <Input
                  id="actual-minutes"
                  type="number"
                  min="0"
                  max="59"
                  step="1"
                  inputMode="numeric"
                  placeholder="0"
                  value={minutes}
                  onChange={e => { setMinutes(e.target.value); setError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
                />
                <span className="block text-[11px] text-muted-foreground">Minutes</span>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Saved to your timesheet for today under this task.
            </p>
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => { setHours(''); setMinutes(''); close(0); }}>
            Clear
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => close(null)}>Cancel</Button>
            <Button type="button" onClick={confirm}>{approve ? 'Approve' : 'Save'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
