/**
 * A subtask can be timed by whoever may actually start it.
 *
 * The card only offered Start to assignees. The server is looser — `start_task`
 * accepts an assignee OR the creator — so the button was hidden from people the
 * API would have accepted. Subtasks felt it worst: they are made by dragging one
 * card onto another and often carry no assignee of their own, so nobody could
 * put time against them at all.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskCard } from '@/components/TaskCard';
import { useAppStore } from '@/stores/appStore';
import type { Task } from '@/types';

const me = { id: 'u1', name: 'Me', email: 'm@x.com', role: 'employee', avatar: '', projectIds: ['p1'], isActive: true };
const other = { id: 'u2', name: 'Other', email: 'o@x.com', role: 'employee', avatar: '', projectIds: ['p1'], isActive: true };

const base = {
  description: '', projectId: 'p1', sectionId: 's1', assignedTo: 'u1',
  assigneeIds: ['u1'], assignedBy: 'u1', createdBy: 'u1', dueDate: '',
  priority: 'Medium', status: 'backlog', isStarted: false,
  approvedByManager: false, timeTracked: 0, tags: [], createdAt: '', timeLog: {},
};

beforeEach(() => {
  useAppStore.setState({
    currentUser: me as never,
    users: [me, other] as never,
    projects: [{ id: 'p1', name: 'P', members: ['u1', 'u2'], sections: [] }] as never,
    activeTimers: {},
  });
});

function hasStart(over: Partial<Task>) {
  const { unmount } = render(
    <TooltipProvider>
      <TaskCard task={{ ...base, id: 'x', title: 'T', ...over } as Task} onClick={() => {}} />
    </TooltipProvider>,
  );
  const found = !!screen.queryByText('Start');
  unmount();
  return found;
}

describe('the Start button on a subtask', () => {
  it('shows on a subtask assigned to me', () => {
    expect(hasStart({ parentTaskId: 'p1t' })).toBe(true);
  });

  it('shows on an unassigned subtask I created — the reported gap', () => {
    expect(hasStart({ parentTaskId: 'p1t', assigneeIds: [], assignedTo: '', createdBy: 'u1' })).toBe(true);
  });

  it('still hides on work that is neither mine nor created by me', () => {
    expect(hasStart({ parentTaskId: 'p1t', assigneeIds: ['u2'], assignedTo: 'u2', createdBy: 'u2' })).toBe(false);
  });

  it('still hides once the subtask is finished', () => {
    expect(hasStart({ parentTaskId: 'p1t', status: 'done' })).toBe(false);
    expect(hasStart({ parentTaskId: 'p1t', status: 'completed' })).toBe(false);
  });

  it('behaves the same on a top-level task', () => {
    expect(hasStart({ assigneeIds: [], assignedTo: '', createdBy: 'u1' })).toBe(true);
  });
});
