import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { localISODateFromDate, parseLocalISODate } from '@/lib/due-date-utils';
import { cn } from '@/lib/utils';

type DatePickerInputProps = {
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  id?: string;
  'aria-label'?: string;
};

/** Date field with native input plus a calendar popover. */
export function DatePickerInput({
  value,
  onChange,
  className,
  id,
  'aria-label': ariaLabel,
}: DatePickerInputProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseLocalISODate(value) : undefined;

  return (
    <div className={cn('relative flex items-center', className)}>
      <input
        id={id}
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        className="w-full rounded-xl border border-border/80 bg-muted/40 pl-3 pr-10 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="absolute right-1.5 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label={ariaLabel ? `${ariaLabel} — open calendar` : 'Open calendar'}
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0 rounded-xl border-border/60" align="end">
          <Calendar
            mode="single"
            selected={selected}
            onSelect={date => {
              if (!date) return;
              onChange(localISODateFromDate(date));
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
