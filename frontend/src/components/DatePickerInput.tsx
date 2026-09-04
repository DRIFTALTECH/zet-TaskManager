import { useState } from 'react';
import { CalendarDays, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { localISODateFromDate, parseLocalISODate } from '@/lib/due-date-utils';
import { cn } from '@/lib/utils';

/**
 * The one date control.
 *
 * Every date in the app is picked here, from the dashboard's cells to the detail
 * modals to the report filters. Native `<input type="date">` was the old answer
 * and it cannot be made consistent: each browser paints its own field and popup,
 * the placeholder is a locale-shaped `dd/mm/yyyy` nobody can restyle, and dark
 * mode needs a `color-scheme` hack per input.
 *
 * Values are ISO `YYYY-MM-DD` in local time — never `Date`, never UTC-shifted.
 */
type DatePickerInputProps = {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
  placeholder?: string;
  /** Offer a Clear entry. Off for a field that must always hold a date. */
  clearable?: boolean;
  disabled?: boolean;
  /** ISO bounds, for the two halves of a range. */
  min?: string;
  max?: string;
  /**
   * `field` sits inside a FIELD_GRID row and stays quiet until hovered;
   * `boxed` is the standalone control used in dialogs and filter bars.
   */
  variant?: 'field' | 'boxed';
};

const TRIGGER = {
  field:
    'h-8 rounded-md border border-transparent bg-transparent px-2 text-xs hover:bg-muted/60 focus:bg-muted/60 focus:border-border/60',
  boxed:
    'rounded-xl border border-border/50 bg-muted/40 px-3 py-2 text-sm focus:border-primary/20 focus:ring-2 focus:ring-primary/40',
} as const;

function formatPickedDate(iso: string): string {
  const d = parseLocalISODate(iso);
  if (!d) return '';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function DatePickerInput({
  value,
  onChange,
  className,
  id,
  'aria-label': ariaLabel,
  placeholder = 'Select date',
  clearable = true,
  disabled,
  min,
  max,
  variant = 'field',
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false);
  const iso = (value ?? '').trim();
  const selected = iso ? parseLocalISODate(iso) : undefined;
  const before = min ? parseLocalISODate(min) : undefined;
  const after = max ? parseLocalISODate(max) : undefined;
  // Two open-ended matchers rather than one interval: react-day-picker's
  // DateInterval needs both ends, and a range often has only one.
  const outOfRange = [
    ...(before ? [{ before }] : []),
    ...(after ? [{ after }] : []),
  ];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-label={ariaLabel ?? placeholder}
          className={cn(
            'flex w-full items-center gap-2 text-left font-medium outline-none transition-colors disabled:opacity-50',
            TRIGGER[variant],
            !iso && 'text-muted-foreground/50 font-normal',
            className,
          )}
        >
          <CalendarDays className="h-3.5 w-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate">{iso ? formatPickedDate(iso) : placeholder}</span>
          {iso && clearable && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear date"
              className="shrink-0 rounded p-0.5 text-muted-foreground/50 hover:bg-muted hover:text-foreground"
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                onChange('');
              }}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto rounded-xl border-border/60 p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          disabled={outOfRange.length ? outOfRange : undefined}
          defaultMonth={selected}
          onSelect={date => {
            if (!date) return;
            onChange(localISODateFromDate(date));
            setOpen(false);
          }}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export default DatePickerInput;
