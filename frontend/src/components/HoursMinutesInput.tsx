import { cn } from '@/lib/utils';

/**
 * Duration as two boxes: hours and minutes.
 *
 * A single decimal-hours field is how "1 hour 45 minutes" turns into someone
 * typing 1.45 and meaning 1.75. The value stays a decimal-hours string on the
 * way in and out — that is what the task API takes — but nobody has to do the
 * arithmetic.
 *
 * `''` means unset, which is different from `0`.
 */
export function decimalToHM(value: string): { h: string; m: string } {
  const n = Number((value ?? '').trim());
  if (!(value ?? '').trim() || !Number.isFinite(n) || n < 0) return { h: '', m: '' };
  const total = Math.round(n * 60);
  if (total === 0) return { h: '0', m: '' };
  return { h: String(Math.floor(total / 60)), m: String(total % 60) };
}

/** Seconds → the decimal-hours string this control speaks. */
export function secondsToDecimalHours(seconds: number): string {
  const total = Math.max(0, Math.round((seconds || 0) / 60));
  if (total === 0) return '';
  return String(total / 60);
}

export function formatHM(value: string): string {
  const { h, m } = decimalToHM(value);
  if (!h && !m) return '—';
  const hours = Number(h || 0);
  const mins = Number(m || 0);
  if (hours && mins) return `${hours}h ${mins}m`;
  if (hours) return `${hours}h`;
  return `${mins}m`;
}

const BOX =
  'w-full rounded-lg border border-border/50 bg-muted/40 px-2 py-1 text-sm font-semibold transition-all focus:border-primary/20 focus:outline-none focus:ring-2 focus:ring-primary/40';

export function HoursMinutesInput({
  value,
  onChange,
  className,
  disabled,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (decimalHours: string) => void;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const { h, m } = decimalToHM(value);

  const emit = (nextH: string, nextM: string) => {
    const hours = nextH.trim() === '' ? 0 : Number(nextH);
    const mins = nextM.trim() === '' ? 0 : Number(nextM);
    if (!Number.isFinite(hours) || !Number.isFinite(mins)) return;
    if (nextH.trim() === '' && nextM.trim() === '') {
      onChange('');
      return;
    }
    onChange(String(Math.max(0, hours) + Math.min(59, Math.max(0, mins)) / 60));
  };

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <input
        type="number"
        min="0"
        step="1"
        inputMode="numeric"
        placeholder="0"
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — hours` : 'Hours'}
        value={h}
        onChange={e => emit(e.target.value, m)}
        className={BOX}
      />
      <span className="shrink-0 text-[11px] text-muted-foreground">h</span>
      <input
        type="number"
        min="0"
        max="59"
        step="1"
        inputMode="numeric"
        placeholder="0"
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — minutes` : 'Minutes'}
        value={m}
        onChange={e => emit(h, e.target.value)}
        className={BOX}
      />
      <span className="shrink-0 text-[11px] text-muted-foreground">m</span>
    </div>
  );
}

export default HoursMinutesInput;
