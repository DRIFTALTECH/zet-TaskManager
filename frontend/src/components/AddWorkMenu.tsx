import type { ReactNode } from 'react';
import { BookOpen, ListTodo } from 'lucide-react';
import { Hint } from '@/components/ui/hint';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Project-level + : Task or Story. Story-level uses a plain task button. */
export function AddWorkMenu({
  trigger,
  onTask,
  onStory,
  hint,
}: {
  trigger: ReactNode;
  onTask: () => void;
  onStory: () => void;
  /**
   * Named here rather than by the caller wrapping `trigger`: a wrapped trigger
   * is no longer the element `asChild` clones, so the menu stops opening. The
   * tooltip has to sit around the trigger, not inside it.
   */
  hint?: string;
}) {
  return (
    <DropdownMenu>
      <Hint label={hint}>
        <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" className="w-36">
        <DropdownMenuItem className="gap-2" onClick={onTask}>
          <ListTodo className="h-3.5 w-3.5" /> Task
        </DropdownMenuItem>
        <DropdownMenuItem className="gap-2" onClick={onStory}>
          <BookOpen className="h-3.5 w-3.5" /> Story
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
