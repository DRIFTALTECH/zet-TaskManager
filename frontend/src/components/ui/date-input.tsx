import { useState, useEffect } from 'react';
import { format, parse, isValid } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface DateInputProps {
  id?: string;
  /** yyyy-MM-dd or empty */
  value: string;
  onChange: (iso: string) => void;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  inputClassName?: string;
}

function parseFlexible(s: string): Date | null {
  const t = s.trim();
  if (!t) return null;
  const patterns = ['dd-MM-yyyy', 'dd/MM/yyyy', 'd-M-yyyy', 'd/M/yyyy', 'yyyy-MM-dd'];
  for (const p of patterns) {
    try {
      const d = parse(t, p, new Date());
      if (isValid(d)) return d;
    } catch {
      /* continue */
    }
  }
  return null;
}

export function DateInput({ id, value, onChange, className, disabled, required, inputClassName }: DateInputProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  useEffect(() => {
    if (!value) {
      setText('');
      return;
    }
    const d = parse(value, 'yyyy-MM-dd', new Date());
    if (isValid(d)) setText(format(d, 'dd-MM-yyyy'));
    else setText(value);
  }, [value]);

  const selectedValid = (() => {
    if (!value) return undefined;
    const d = parse(value, 'yyyy-MM-dd', new Date());
    return isValid(d) ? d : undefined;
  })();

  const commitText = () => {
    const d = parseFlexible(text);
    if (d) onChange(format(d, 'yyyy-MM-dd'));
    else if (!text.trim()) onChange('');
  };

  const field =
    'flex-1 min-w-0 rounded-xl border border-border/80 bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50';

  return (
    <div className={cn('flex gap-2 items-center', className)}>
      <input
        id={id}
        type="text"
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            (e.target as HTMLInputElement).blur();
          }
        }}
        disabled={disabled}
        placeholder=""
        autoComplete="off"
        className={cn(field, inputClassName)}
        aria-required={required}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-10 w-10 shrink-0 rounded-xl border-border/80"
            disabled={disabled}
            aria-label="Choose date in calendar"
          >
            <CalendarIcon className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={selectedValid}
            onSelect={d => {
              if (d) {
                onChange(format(d, 'yyyy-MM-dd'));
                setText(format(d, 'dd-MM-yyyy'));
              }
              setOpen(false);
            }}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
