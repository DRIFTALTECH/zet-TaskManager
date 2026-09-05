/**
 * Subtasks are created on the card, inline.
 *
 * There was no way to create one at all: you made a loose task and dragged it
 * onto another card, so the relationship had to be built by accident before it
 * could be intended.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TaskCard } from '@/components/TaskCard';
import { useAppStore } from '@/stores/appStore';
import type { Task } from '@/types';

const me = { id: 'u1', name: 'Me', email: 'm@x.com', role: 'employee', avatar: '', projectIds: ['p1'], isActive: true };
const base = {
  description: '', projectId: 'p1', sectionId: 's1', assignedTo: 'u1',
  assigneeIds: ['u1'], assignedBy: 'u1', createdBy: 'u1', dueDate: '',
  priority: 'Medium', status: 'backlog', isStarted: false, approvedByManager: false,
  timeTracked: 0, tags: [], createdAt: '', timeLog: {},
};
const parent = { ...base, id: 't1', title: 'Parent task' } as Task;

beforeEach(() => {
  useAppStore.setState({
    currentUser: me as never, users: [me] as never,
    projects: [{ id: 'p1', name: 'P', members: ['u1'], sections: [] }] as never,
    activeTimers: {},
  });
});

function setup(onAdd?: (title: string) => Promise<void>, subtasks: Task[] = []) {
  return render(
    <TooltipProvider>
      <TaskCard
        task={parent}
        onClick={() => {}}
        subtasks={subtasks}
        expanded
        onToggleExpand={() => {}}
        onAddSubtask={onAdd}
      />
    </TooltipProvider>,
  );
}

describe('adding a subtask from the card', () => {
  it('offers "Add subtask" even when there are none yet', () => {
    setup(vi.fn());
    expect(screen.getAllByText('Add subtask').length).toBeGreaterThan(0);
  });

  it('opens an inline field — not a dialog — and saves on Enter', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    setup(onAdd);
    fireEvent.click(screen.getAllByText('Add subtask')[0]);

    const field = await screen.findByPlaceholderText('Subtask title…');
    // Inline means in the page, not inside a modal.
    expect(field.closest('[role="dialog"]')).toBeNull();

    fireEvent.change(field, { target: { value: 'Write the migration' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('Write the migration'));
  });

  it('stays open with the field cleared, so several can be added in a row', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    setup(onAdd);
    fireEvent.click(screen.getAllByText('Add subtask')[0]);
    const field = await screen.findByPlaceholderText('Subtask title…') as HTMLInputElement;

    fireEvent.change(field, { target: { value: 'First' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(field.value).toBe(''));

    fireEvent.change(field, { target: { value: 'Second' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    expect(onAdd.mock.calls.map(c => c[0])).toEqual(['First', 'Second']);
  });

  it('Escape closes it without creating anything', async () => {
    const onAdd = vi.fn();
    setup(onAdd);
    fireEvent.click(screen.getAllByText('Add subtask')[0]);
    const field = await screen.findByPlaceholderText('Subtask title…');
    fireEvent.change(field, { target: { value: 'Never mind' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByPlaceholderText('Subtask title…')).toBeNull());
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('ignores an empty title', async () => {
    const onAdd = vi.fn();
    setup(onAdd);
    fireEvent.click(screen.getAllByText('Add subtask')[0]);
    const field = await screen.findByPlaceholderText('Subtask title…');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows nothing extra on a card that cannot take subtasks', () => {
    setup(undefined);
    expect(screen.queryByText('Add subtask')).toBeNull();
  });
});


// ── The composer on its own, shared by the card and the task detail view ────

describe('the shared composer', () => {
  it('renders the field in the page, never in a dialog', async () => {
    const { InlineSubtaskComposer } = await import('@/components/InlineSubtaskComposer');
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<InlineSubtaskComposer onAdd={onAdd} />);

    fireEvent.click(screen.getByText('Add subtask'));
    const field = await screen.findByPlaceholderText('Subtask title…');
    expect(field.closest('[role="dialog"]')).toBeNull();

    fireEvent.change(field, { target: { value: 'From the detail view' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith('From the detail view'));
  });

  it('keeps the field open and empty for the next one', async () => {
    const { InlineSubtaskComposer } = await import('@/components/InlineSubtaskComposer');
    const onAdd = vi.fn().mockResolvedValue(undefined);
    render(<InlineSubtaskComposer onAdd={onAdd} />);
    fireEvent.click(screen.getByText('Add subtask'));
    const field = await screen.findByPlaceholderText('Subtask title…') as HTMLInputElement;

    fireEvent.change(field, { target: { value: 'One' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(field.value).toBe(''));
    expect(screen.getByPlaceholderText('Subtask title…')).toBeTruthy();
  });
});

// ── Where the field is allowed to appear at all ────────────────────────────

describe('a card that already has subtasks', () => {
  it('shows the list indented and the composer inside the card', async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const child = { ...base, id: 't2', title: 'Existing subtask', parentTaskId: 't1' } as Task;
    const { container } = setup(onAdd, [child]);

    expect(screen.getByText('Existing subtask')).toBeTruthy();
    // The composer must sit within the card's own border, not float below it —
    // rendered in the strip built for subtask cards it read as a stray input.
    const composer = screen.getByText('Add subtask');
    const indentStrip = container.querySelector('.border-l-2');
    expect(indentStrip && indentStrip.contains(composer)).toBe(false);
  });
});
