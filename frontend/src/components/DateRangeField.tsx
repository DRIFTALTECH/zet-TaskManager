import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, ChevronDown, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { Hint } from '@/components/ui/hint';
import { fromIso, toIso } from '@/lib/date-range';
import { CONTROL_H } from '@/lib/field-styles';
import { cn } from '@/lib/utils';

/**
 * A single from–to date field.
 *
 * Replaces the pattern of two separate date inputs sitting side by side, which
 * cost two controls, two labels and a third "Clear" button to express one idea.
 * Both dates are picked in one popover showing two months, so the start and the
 * end are visible together rather than typed blind.
 *
 * This is deliberately NOT DateRangePicker: that one selects a *period* and
 * carries presets and prev/next stepping. This is a plain filter field where an
 * empty value means "no limit".
 */
export default function DateRangeField({
  from,
  to,
  onChange,
  placeholder = 'Any date',
  className,
  disableFuture = false,
  iconOnly = false,
}: {
  /** ISO yyyy-mm-dd, or '' for no lower bound. */
  from: string;
  /** ISO yyyy-mm-dd, or '' for no upper bound. */
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
  disableFuture?: boolean;
  /** Shrink to a square icon — for a toolbar where every control is one. */
  iconOnly?: boolean;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  const selected: DateRange | undefined = from
    ? { from: fromIso(from), to: to ? fromIso(to) : undefined }
    : undefined;

  const fmt = (iso: string) =>
    fromIso(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });

  const label = from
    ? to && to !== from
      ? `${fmt(from)} – ${fmt(to)}`
      : `From ${fmt(from)}`
    : to
      ? `Until ${fmt(to)}`
      : placeholder;

  const hasValue = Boolean(from || to);

  // One calendar, rendered by whichever trigger is in use.
  const calendar = (
    <Calendar
      mode="range"
      selected={selected}
      defaultMonth={from ? fromIso(from) : new Date()}
      disabled={disableFuture ? { after: new Date() } : undefined}
      onSelect={r => {
        onChange(r?.from ? toIso(r.from) : '', r?.to ? toIso(r.to) : '');
        if (r?.from && r?.to) setOpen(false);
      }}
      numberOfMonths={isMobile ? 1 : 2}
      className="p-4"
      classNames={{
        months: 'flex flex-col sm:flex-row gap-6 sm:gap-8 space-y-0 sm:space-x-0',
        month: 'space-y-3',
        caption: 'flex justify-center items-center relative h-8',
        caption_label: 'text-sm font-semibold',
        nav_button: 'h-7 w-7 rounded-lg border-0 bg-transparent p-0 opacity-50 hover:opacity-100 hover:bg-accent',
        table: 'w-full border-collapse',
        head_cell: 'w-9 font-medium text-[0.75rem] text-muted-foreground',
        cell: 'h-9 w-9 p-0 text-center text-sm relative first:[&:has([aria-selected])]:rounded-l-lg last:[&:has([aria-selected])]:rounded-r-lg [&:has([aria-selected])]:bg-accent/60 [&:has([aria-selected].day-range-start)]:rounded-l-lg [&:has([aria-selected].day-range-end)]:rounded-r-lg [&:has([aria-selected].day-outside)]:bg-accent/30',
        day: 'h-9 w-9 rounded-lg p-0 font-normal hover:bg-accent aria-selected:opacity-100',
        day_selected:
          'bg-foreground text-background hover:bg-foreground hover:text-background focus:bg-foreground focus:text-background',
        day_today: 'bg-transparent font-semibold text-foreground',
        day_outside: 'text-muted-foreground/40 opacity-100 aria-selected:bg-transparent aria-selected:text-background/70',
        day_range_middle: 'aria-selected:bg-transparent aria-selected:text-foreground',
        day_range_start: 'day-range-start',
        day_range_end: 'day-range-end',
      }}
    />
  );

  if (iconOnly) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        {/* The icon says which field this is; only the label says what it is
            set to, so it has to carry the value for hover and for a reader. */}
        <Hint label={hasValue ? label : placeholder}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={hasValue ? label : placeholder}
              className={cn(
                // Outlined like the controls it stands beside — they arrive as
                // a group of separate buttons, not inside a shared frame.
                `relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full`,
                // Unoutlined like the controls it stands beside: the bar they
                // sit on already separates them from the work.
                'bg-foreground text-background shadow-md transition-all hover:bg-foreground/85',
                'focus:outline-none',
                className,
              )}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {hasValue && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-card bg-primary"
                />
              )}
            </button>
          </PopoverTrigger>
        </Hint>
        <PopoverContent align="end" className="w-auto overflow-hidden rounded-xl border-border/70 p-0 shadow-lg">
          <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
            {placeholder}
          </p>
          {calendar}
          {hasValue && (
            // No room for a clear button in a 28px square, so it lives here.
            <button
              type="button"
              onClick={() => onChange('', '')}
              className="flex w-full items-center gap-1.5 border-t border-border/40 px-3 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" /> Clear dates
            </button>
          )}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // Sized from the app's one control height rather than its own:
            // sitting in a row of h-7 filters it was 36px tall, more rounded and
            // a size larger, so the row read as two kinds of thing.
            `flex ${CONTROL_H} min-w-[11rem] shrink-0 items-center justify-between gap-2 rounded-lg`,
            'border border-border/70 bg-card/70 px-2 text-left text-xs font-medium shadow-none',
            'focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-0',
            className,
          )}
        >
          <span className="truncate">{label}</span>
          {hasValue ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear dates"
              onClick={e => { e.stopPropagation(); onChange('', ''); }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange('', '');
                }
              }}
              className="rounded-md p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : (
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-auto overflow-hidden rounded-xl border-border/70 p-0 shadow-lg"
      >
        {calendar}
        <div className="grid grid-cols-2 gap-4 border-t border-border/50 px-4 py-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">From</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">{from ? fmt(from) : '—'}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">To</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums">
              {to ? fmt(to) : '—'}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
