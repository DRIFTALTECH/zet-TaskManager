import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, X } from 'lucide-react';
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
            'flex items-center gap-2 rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-sm font-medium transition-colors hover:border-ring/40 focus:outline-none focus:ring-2 focus:ring-primary/40',
            !hasValue && 'text-muted-foreground',
            className,
          )}
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{label}</span>
          {hasValue && (
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
              className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={selected}
          defaultMonth={from ? fromIso(from) : new Date()}
          disabled={disableFuture ? { after: new Date() } : undefined}
          onSelect={r => {
            onChange(r?.from ? toIso(r.from) : '', r?.to ? toIso(r.to) : '');
            // Close once a complete range is chosen; stay open after the first click.
            if (r?.from && r?.to) setOpen(false);
          }}
          numberOfMonths={isMobile ? 1 : 2}
          className="p-3"
        />
        <div className="flex items-center justify-between gap-4 border-t border-border/40 px-3 py-2.5 text-xs">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">From</p>
              <p className="font-semibold tabular-nums">{from ? fmt(from) : '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">To</p>
              <p className="font-semibold tabular-nums">
                {to ? fmt(to) : <span className="font-normal text-muted-foreground">pick an end date</span>}
              </p>
            </div>
          </div>
          {hasValue && (
            <button
              type="button"
              onClick={() => { onChange('', ''); setOpen(false); }}
              className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
