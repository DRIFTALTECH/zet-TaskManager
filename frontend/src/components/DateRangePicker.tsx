import { useMemo } from 'react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { DateRange } from 'react-day-picker';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import {
  RANGE_PRESETS,
  formatRangeLabel,
  fromIso,
  resolveRange,
  toIso,
  type RangePresetId,
  type RangeSelection,
} from '@/lib/date-range';

/**
 * Period selector: a preset (day / week / month / rolling window / custom range),
 * arrows to step by whole periods, and a "Today" reset.
 *
 * The timesheet and calendar pages could previously only move one week at a time.
 * This replaces that with any period the user wants, while keeping the familiar
 * arrow stepping for the common case of paging through weeks.
 */
export default function DateRangePicker({
  value,
  onChange,
  /** Hide presets that do not apply — the calendar grid, for instance, has no use for a 30-day window. */
  allowedPresets,
  /** Block navigating past today. Timesheets cannot be logged in the future. */
  disableFuture = true,
  className,
}: {
  value: RangeSelection;
  onChange: (next: RangeSelection) => void;
  allowedPresets?: RangePresetId[];
  disableFuture?: boolean;
  className?: string;
}) {
  const isMobile = useIsMobile();

  const presets = useMemo(
    () => (allowedPresets ? RANGE_PRESETS.filter(p => allowedPresets.includes(p.id)) : RANGE_PRESETS),
    [allowedPresets],
  );

  const range = useMemo(() => resolveRange(value), [value]);
  const label = formatRangeLabel(range, value.preset);

  // Stepping forward is meaningless for a custom range, and disallowed past today.
  const canStepForward =
    value.preset !== 'custom' && (!disableFuture || value.offset < 0);
  const atToday = value.preset !== 'custom' && value.offset === 0;

  const step = (dir: -1 | 1) => {
    if (value.preset === 'custom') return;
    const nextOffset = value.offset + dir;
    if (disableFuture && nextOffset > 0) return;
    onChange({ ...value, offset: nextOffset });
  };

  const selectedForCalendar: DateRange | undefined =
    value.preset === 'custom' && value.custom?.start
      ? { from: fromIso(value.custom.start), to: value.custom.end ? fromIso(value.custom.end) : undefined }
      : undefined;

  const formatDay = (iso: string) =>
    fromIso(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <div className={cn('flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 min-w-0', className)}>
      {/* Preset segmented control — scrolls horizontally rather than overflowing. */}
      <div className="flex items-center gap-0.5 rounded-xl border border-border/50 bg-muted/30 p-0.5 max-w-full overflow-x-auto scrollbar-none">
        {presets.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange({ preset: p.id, offset: 0, custom: value.custom })}
            className={cn(
              'px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap',
              value.preset === p.id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Stepper + current period */}
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={() => step(-1)}
          disabled={value.preset === 'custom'}
          aria-label="Previous period"
          className="p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/50 text-sm font-semibold tabular-nums hover:bg-muted/50 transition-colors min-w-0 flex-1 sm:flex-none sm:min-w-[190px] justify-center"
            >
              <CalendarDays className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate">{label}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {/* Two months side by side so a start and an end are visible at once —
                picking a range in a single month means scrolling blind. One month
                on phones, where two will not fit. */}
            <Calendar
              mode="range"
              selected={selectedForCalendar}
              defaultMonth={fromIso(range.start)}
              disabled={disableFuture ? { after: new Date() } : undefined}
              onSelect={r => {
                if (!r?.from) return;
                onChange({
                  preset: 'custom',
                  offset: 0,
                  custom: { start: toIso(r.from), end: r.to ? toIso(r.to) : undefined },
                });
              }}
              numberOfMonths={isMobile ? 1 : 2}
              className="p-3"
            />
            <div className="border-t border-border/40 px-3 py-2.5 flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">From</p>
                  <p className="font-semibold tabular-nums">
                    {value.custom?.start ? formatDay(value.custom.start) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">To</p>
                  <p className="font-semibold tabular-nums">
                    {value.custom?.end
                      ? formatDay(value.custom.end)
                      : <span className="text-muted-foreground font-normal">pick an end date</span>}
                  </p>
                </div>
              </div>
              {value.custom?.start && (
                <button
                  type="button"
                  onClick={() => onChange({ preset: 'week', offset: 0 })}
                  className="text-muted-foreground hover:text-foreground underline underline-offset-2"
                >
                  Clear
                </button>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <button
          type="button"
          onClick={() => step(1)}
          disabled={!canStepForward}
          aria-label="Next period"
          className="p-1.5 rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>

        {!atToday && (
          <button
            type="button"
            onClick={() => onChange({ preset: value.preset === 'custom' ? 'week' : value.preset, offset: 0 })}
            className="ml-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            Today
          </button>
        )}
      </div>
    </div>
  );
}
