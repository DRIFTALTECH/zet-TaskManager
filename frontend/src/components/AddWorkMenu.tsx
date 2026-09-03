import type { ReactNode } from 'react';
import { BookOpen, ListTodo } from 'lucide-react';
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
}: {
  trigger: ReactNode;
  onTask: () => void;
  onStory: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
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
