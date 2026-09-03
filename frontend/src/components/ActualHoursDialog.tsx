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

export function ActualHoursDialogHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listener = setPending;
    return () => { listener = null; };
  }, []);

  useEffect(() => {
    if (!pending) return;
    setValue(fmtHours(pending.task.timeTracked || 0));
    setError('');
    const t = window.setTimeout(() => inputRef.current?.select(), 50);
    return () => window.clearTimeout(t);
  }, [pending]);

  const close = (hours: number | null) => {
    pending?.resolve(hours);
    setPending(null);
  };

  const confirm = () => {
    const hours = parseHoursInput(value);
    if (hours == null) {
      setError('Enter how long it took, or Clear.');
      return;
    }
    close(hours);
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
            <Label htmlFor="actual-hours">Actual hours</Label>
            <Input
              id="actual-hours"
              ref={inputRef}
              inputMode="decimal"
              placeholder="e.g. 2.5 or 2:30"
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
            />
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => { setValue('0'); close(0); }}>
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
