import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { ChevronDown, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useIsMobile } from '@/hooks/use-mobile';
import { fromIso, toIso } from '@/lib/date-range';
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
}: {
  /** ISO yyyy-mm-dd, or '' for no lower bound. */
  from: string;
  /** ISO yyyy-mm-dd, or '' for no upper bound. */
  to: string;
  onChange: (from: string, to: string) => void;
  placeholder?: string;
  className?: string;
  disableFuture?: boolean;
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

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 min-w-[15rem] shrink-0 items-center justify-between gap-2 rounded-xl border border-border/70 bg-card/70 px-3 text-left text-sm font-medium shadow-none focus:outline-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-0',
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
