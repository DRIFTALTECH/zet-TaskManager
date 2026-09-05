/**
 * The card a drop would land inside nudges while the drag is over it.
 *
 * Dropping onto a card and dropping onto the column behind it are the same
 * gesture until you let go, so the board gave no sign which was about to
 * happen — the question only arrived afterwards. This answers it beforehand.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskCard } from '@/components/TaskCard';
import { DropHostContext } from '@/lib/drop-target';
import { useAppStore } from '@/stores/appStore';
import type { Task } from '@/types';

const me = { id: 'u1', name: 'Me', email: 'm@x.com', role: 'employee', avatar: '', projectIds: ['p1'], isActive: true };
const task = {
  id: 't1', title: 'Host card', description: '', projectId: 'p1', sectionId: 's1',
  assignedTo: 'u1', assigneeIds: ['u1'], assignedBy: 'u1', createdBy: 'u1', dueDate: '',
  priority: 'Medium', status: 'backlog', isStarted: false, approvedByManager: false,
  timeTracked: 0, tags: [], createdAt: '', timeLog: {},
} as Task;

beforeEach(() => {
  useAppStore.setState({
    currentUser: me as never, users: [me] as never,
    projects: [{ id: 'p1', name: 'P', members: ['u1'], sections: [] }] as never,
    activeTimers: {},
  });
});

function renderWithHost(hostId: string | null) {
  const { container, unmount } = render(
    <DropHostContext.Provider value={hostId}>
      <TooltipProvider>
        <TaskCard task={task} onClick={() => {}} />
      </TooltipProvider>
    </DropHostContext.Provider>,
  );
  const nudging = !!container.querySelector('.animate-drop-nudge, [class*="animate-drop-nudge"]');
  const ringed = !!container.querySelector('[class*="ring-primary"]');
  unmount();
  return { nudging, ringed };
}

describe('the drop-target nudge', () => {
  it('nudges the card the drag is hovering', () => {
    const { nudging, ringed } = renderWithHost('t1');
    expect(nudging).toBe(true);
    // The ring carries the meaning for anyone who has asked for less motion.
    expect(ringed).toBe(true);
  });

  it('leaves every other card still', () => {
    expect(renderWithHost('some-other-card').nudging).toBe(false);
  });

  it('leaves every card still when nothing is being dragged', () => {
    expect(renderWithHost(null).nudging).toBe(false);
  });
});
