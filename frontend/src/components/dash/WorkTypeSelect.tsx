/**
 * The story/task switch.
 *
 * Type is a property of the item, not a decision frozen at creation, so it is
 * shown the same way everywhere it appears — on a row, in a detail header, in
 * the composer — and changing it is a pick from a list rather than a button
 * whose effect you have to infer.
 */
import { BookOpen, Check, ChevronDown, CircleDot } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export type WorkType = 'story' | 'task';

const OPTIONS: { value: WorkType; label: string; hint: string }[] = [
  { value: 'story', label: 'Story', hint: 'Holds tasks and sub-stories' },
  { value: 'task', label: 'Task', hint: 'A single piece of work' },
];

export function WorkTypeSelect({
  value,
  onChange,
  disabled,
  size = 'sm',
}: {
  value: WorkType;
  onChange: (next: WorkType) => void;
  disabled?: boolean;
  /** `sm` is the row/composer glyph; `md` is the detail header. */
  size?: 'sm' | 'md';
}) {
  const Icon = value === 'story' ? BookOpen : CircleDot;
  const iconClass = size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label={`Type: ${value === 'story' ? 'Story' : 'Task'}`}
          onClick={e => e.stopPropagation()}
          className={`group/type flex shrink-0 items-center gap-0.5 rounded transition-colors hover:bg-muted disabled:opacity-50 ${
            size === 'md' ? 'px-1.5 py-1 text-xs font-medium' : 'p-0.5'
          }`}
        >
          <Icon className={`${iconClass} ${value === 'story' ? 'text-primary' : 'text-primary/70'}`} />
          {size === 'md' && <span>{value === 'story' ? 'Story' : 'Task'}</span>}
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/0 transition-colors group-hover/type:text-muted-foreground/60" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56" onClick={e => e.stopPropagation()}>
        {OPTIONS.map(opt => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => opt.value !== value && onChange(opt.value)}
            className="gap-2"
          >
            {opt.value === 'story'
              ? <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
              : <CircleDot className="h-3.5 w-3.5 shrink-0 text-primary/70" />}
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium">{opt.label}</span>
              <span className="block text-[10px] text-muted-foreground">{opt.hint}</span>
            </span>
            {opt.value === value && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default WorkTypeSelect;
