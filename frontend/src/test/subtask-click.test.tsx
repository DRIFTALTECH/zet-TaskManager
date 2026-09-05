/**
 * Clicking a subtask opens that subtask, not the task holding it.
 *
 * The nested list is rendered inside the parent card's own clickable element,
 * so the click ran the subtask's handler and then bubbled into the parent's.
 * The parent fired last and won, and the detail panel showed the wrong work.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskCard } from '@/components/TaskCard';
import type { Task } from '@/types';

const base = {
  description: '', projectId: 'p1', sectionId: 'sec1', assignedTo: 'u1',
  assigneeIds: [], assignedBy: 'u1', createdBy: 'u1', dueDate: '',
  priority: 'Medium', status: 'backlog', isStarted: false,
  approvedByManager: false, timeTracked: 0, tags: [], createdAt: '', timeLog: {},
};
const parent = { ...base, id: 't1', title: 'Parent task' } as Task;
const child = { ...base, id: 't2', title: 'Child subtask', parentTaskId: 't1' } as Task;

function renderCard(onClick: () => void, onSubtaskClick: (t: Task) => void) {
  return render(
    <TooltipProvider>
      <TaskCard
        task={parent}
        onClick={onClick}
        subtasks={[child]}
        expanded
        onToggleExpand={() => {}}
        onSubtaskClick={onSubtaskClick}
      />
    </TooltipProvider>,
  );
}

describe('a subtask card answers for itself', () => {
  it('opens the subtask and leaves the parent closed', () => {
    const onClick = vi.fn();
    const onSubtaskClick = vi.fn();
    renderCard(onClick, onSubtaskClick);

    fireEvent.click(screen.getByText('Child subtask'));

    expect(onSubtaskClick).toHaveBeenCalledTimes(1);
    expect(onSubtaskClick.mock.calls[0][0].id).toBe('t2');
    // The bug: the click bubbled on and the parent's handler overwrote it.
    expect(onClick).not.toHaveBeenCalled();
  });

  it('still opens the parent when the parent itself is clicked', () => {
    const onClick = vi.fn();
    const onSubtaskClick = vi.fn();
    renderCard(onClick, onSubtaskClick);

    fireEvent.click(screen.getByText('Parent task'));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubtaskClick).not.toHaveBeenCalled();
  });
});
