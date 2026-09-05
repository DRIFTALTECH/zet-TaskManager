/**
 * Subtasks read as a table: a column per field, set in place.
 *
 * A stack of rows carrying only a title said a subtask was a checklist tick.
 * It is a task — owner, priority, due date, status — and comparing those down a
 * column is the whole point of a list, which needs them in a column.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkItemTable } from '@/components/WorkItemTable';
import { ConfirmDialogHost } from '@/components/ConfirmDialog';
import { useAppStore } from '@/stores/appStore';
import type { Task } from '@/types';

const me = { id: 'u1', name: 'Ada Lovelace', email: 'a@x.com', role: 'employee', avatar: '', projectIds: ['p1'], isActive: true };
const mate = { id: 'u2', name: 'Grace Hopper', email: 'g@x.com', role: 'employee', avatar: '', projectIds: ['p1'], isActive: true };

const base = {
  description: '', projectId: 'p1', sectionId: 's1', assignedTo: 'u1',
  assigneeIds: ['u1'], assignedBy: 'u1', createdBy: 'u1', dueDate: '',
  priority: 'High', status: 'backlog', isStarted: false, approvedByManager: false,
  timeTracked: 0, tags: [], createdAt: '', timeLog: {},
};
const t = (over: Partial<Task>) => ({ ...base, ...over }) as Task;

beforeEach(() => {
  useAppStore.setState({
    currentUser: me as never, users: [me, mate] as never,
    projects: [{ id: 'p1', name: 'P', members: ['u1', 'u2'], sections: [] }] as never,
    activeTimers: {},
  });
});

function table(
  subtasks: Task[],
  onEdit = vi.fn(),
  onAdd?: (t: string) => Promise<void>,
  title = 'Subtasks',
  addLabel = 'Add subtask',
  onDelete?: (t: Task) => void,
) {
  const onOpen = vi.fn();
  const r = render(
    <TooltipProvider>
      <WorkItemTable
        title={title}
        addLabel={addLabel}
        items={subtasks}
        members={[me, mate] as never}
        currentUserId="u1"
        onOpen={onOpen}
        onEdit={onEdit}
        onDelete={onDelete}
        onAdd={onAdd}
      />
    </TooltipProvider>,
  );
  return { ...r, onOpen, onEdit };
}

describe('the subtask table', () => {
  it('names its columns', () => {
    table([t({ id: 'a', title: 'One' })]);
    for (const heading of ['Name', 'Assignee', 'Priority', 'Due date']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
  });

  it('counts what is open, not what exists', () => {
    table([
      t({ id: 'a', title: 'One' }),
      t({ id: 'b', title: 'Two' }),
      t({ id: 'c', title: 'Three', status: 'done' }),
    ]);
    expect(screen.getByText('2 open')).toBeTruthy();
  });

  it('says how many are mine', () => {
    table([
      t({ id: 'a', title: 'Mine' }),
      t({ id: 'b', title: 'Theirs', assigneeIds: ['u2'] }),
    ]);
    expect(screen.getByText('1 for me')).toBeTruthy();
  });

  it('does not claim any are mine when none are', () => {
    table([t({ id: 'a', title: 'Theirs', assigneeIds: ['u2'] })]);
    expect(screen.queryByText(/for me/)).toBeNull();
  });

  it('opens a subtask from its title', () => {
    const { onOpen } = table([t({ id: 'a', title: 'Design filter params' })]);
    fireEvent.click(screen.getByText('Design filter params'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].id).toBe('a');
  });

  it('strikes through work that is finished', () => {
    table([t({ id: 'a', title: 'Done thing', status: 'done' })]);
    expect(screen.getByText('Done thing').className).toContain('line-through');
  });

  it('does not show a status column', () => {
    table([t({ id: 'a', title: 'One' })]);
    expect(screen.queryByText('Status')).toBeNull();
    expect(screen.queryByText('Backlog')).toBeNull();
  });

  it('collapses and expands', () => {
    table([t({ id: 'a', title: 'One' })]);
    fireEvent.click(screen.getByText('Subtasks'));
    expect(screen.queryByText('Name')).toBeNull();
    fireEvent.click(screen.getByText('Subtasks'));
    expect(screen.getByText('Name')).toBeTruthy();
  });

  it('offers a way to add one at the bottom', () => {
    table([t({ id: 'a', title: 'One' })], vi.fn(), vi.fn().mockResolvedValue(undefined));
    expect(screen.getByText('Add subtask')).toBeTruthy();
  });

  it('offers no add row where subtasks cannot nest further', () => {
    table([t({ id: 'a', title: 'One' })]);
    expect(screen.queryByText('Add subtask')).toBeNull();
  });

  it('still shows the header and add row with no subtasks at all', () => {
    table([], vi.fn(), vi.fn().mockResolvedValue(undefined));
    expect(screen.getByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByText('Add subtask')).toBeTruthy();
  });
});


describe('assigning someone', () => {
  it('shows the person a subtask is already on', () => {
    table([t({ id: 'a', title: 'One', assigneeIds: ['u2'] })]);
    fireEvent.click(screen.getByLabelText(/Assignee/i));
    // The already-assigned person is ticked in the picker.
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
  });

  it('reads an older task that carries only assignedTo', () => {
    // Rows written before multi-assignee support have no assigneeIds array.
    // Reading the field straight off the row showed these as unassigned, and
    // picking someone then saved a list built from that empty one — wiping
    // whoever was really on it.
    const legacy = { ...base, id: 'a', title: 'Legacy', assignedTo: 'u2' } as Task;
    delete (legacy as unknown as Record<string, unknown>).assigneeIds;
    table([legacy]);
    fireEvent.click(screen.getByLabelText(/Assignee/i));
    const ticked = screen.getByText('Grace Hopper').closest('button');
    expect(ticked?.textContent).toContain('✓');
  });

  it('adds a person without dropping the one already there', () => {
    const onEdit = vi.fn();
    table([t({ id: 'a', title: 'One', assigneeIds: ['u1'] })], onEdit);
    fireEvent.click(screen.getByLabelText(/Assignee/i));
    fireEvent.click(screen.getByText('Grace Hopper'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][1]).toEqual({ assigneeIds: ['u1', 'u2'] });
  });

  it('removes a person who is already on it', () => {
    const onEdit = vi.fn();
    table([t({ id: 'a', title: 'One', assigneeIds: ['u1', 'u2'] })], onEdit);
    fireEvent.click(screen.getByLabelText(/Assignee/i));
    fireEvent.click(screen.getByText('Ada Lovelace'));
    expect(onEdit.mock.calls[0][1]).toEqual({ assigneeIds: ['u2'] });
  });
});


describe('waiting for a save', () => {
  it('dims the row and blocks it while its edit is in flight', async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    const onEdit = vi.fn(() => new Promise<void>(res => { release = res; }));
    const { container } = table([t({ id: 'a', title: 'One' })], onEdit);

    fireEvent.click(screen.getByLabelText(/Assignee/i));
    fireEvent.click(screen.getByText('Grace Hopper'));

    // Blocked straight away, so a second click cannot land on a stale value.
    await vi.waitFor(() => {
      expect(container.querySelector('.pointer-events-none')).toBeTruthy();
    });
    // But no spinner yet — the wait has not been long enough to be worth one.
    expect(container.querySelector('.animate-spin')).toBeNull();

    await act(async () => { vi.advanceTimersByTime(400); });
    expect(container.querySelector('.animate-spin')).toBeTruthy();

    await act(async () => { release(); await Promise.resolve(); });
    await vi.waitFor(() => {
      expect(container.querySelector('.animate-spin')).toBeNull();
    });
    vi.useRealTimers();
  });

  it('shows no spinner at all when the save comes straight back', async () => {
    const onEdit = vi.fn().mockResolvedValue(undefined);
    const { container } = table([t({ id: 'a', title: 'One' })], onEdit);
    fireEvent.click(screen.getByLabelText(/Assignee/i));
    fireEvent.click(screen.getByText('Grace Hopper'));
    await waitFor(() => expect(onEdit).toHaveBeenCalled());
    expect(container.querySelector('.animate-spin')).toBeNull();
  });
});


describe('the same table one depth up, under a story', () => {
  it('names itself for what it holds', () => {
    table([t({ id: 'a', title: 'Build the filter' })], vi.fn(), undefined, 'Tasks', 'Add task');
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.queryByText('Subtasks')).toBeNull();
  });

  it('offers the wording that fits the depth', () => {
    table([], vi.fn(), vi.fn().mockResolvedValue(undefined), 'Tasks', 'Add task');
    expect(screen.getByText('Add task')).toBeTruthy();
    expect(screen.queryByText('Add subtask')).toBeNull();
  });

  it('carries the same columns, counts and editing as the subtask view', () => {
    const onEdit = vi.fn();
    table(
      [t({ id: 'a', title: 'One' }), t({ id: 'b', title: 'Two', status: 'done' })],
      onEdit, undefined, 'Tasks', 'Add task',
    );
    for (const heading of ['Name', 'Assignee', 'Priority', 'Due date']) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
    expect(screen.getByText('1 open')).toBeTruthy();

    fireEvent.click(screen.getAllByLabelText(/Assignee/i)[0]);
    fireEvent.click(screen.getByText('Grace Hopper'));
    expect(onEdit.mock.calls[0][1]).toEqual({ assigneeIds: ['u1', 'u2'] });
  });
});


describe('renaming a row', () => {
  it('turns the title into a field and saves on Enter', async () => {
    const onEdit = vi.fn();
    table([t({ id: 'a', title: 'Old name' })], onEdit);

    fireEvent.click(screen.getByLabelText('Rename'));
    const field = await screen.findByLabelText('Title') as HTMLInputElement;
    expect(field.value).toBe('Old name');

    fireEvent.change(field, { target: { value: 'New name' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onEdit.mock.calls[0][1]).toEqual({ title: 'New name' });
  });

  it('Escape puts the old title back and saves nothing', async () => {
    const onEdit = vi.fn();
    table([t({ id: 'a', title: 'Old name' })], onEdit);
    fireEvent.click(screen.getByLabelText('Rename'));
    const field = await screen.findByLabelText('Title');
    fireEvent.change(field, { target: { value: 'Discarded' } });
    fireEvent.keyDown(field, { key: 'Escape' });

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('Old name')).toBeTruthy();
  });

  it('saves nothing when the title comes back unchanged', async () => {
    const onEdit = vi.fn();
    table([t({ id: 'a', title: 'Same' })], onEdit);
    fireEvent.click(screen.getByLabelText('Rename'));
    const field = await screen.findByLabelText('Title');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('ignores a title emptied out', async () => {
    const onEdit = vi.fn();
    table([t({ id: 'a', title: 'Keep me' })], onEdit);
    fireEvent.click(screen.getByLabelText('Rename'));
    const field = await screen.findByLabelText('Title');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onEdit).not.toHaveBeenCalled();
  });
});

describe('deleting a row', () => {
  it('asks before removing anything', async () => {
    const onDelete = vi.fn();
    render(<ConfirmDialogHost />);
    table([t({ id: 'a', title: 'Doomed' })], vi.fn(), undefined, 'Subtasks', 'Add subtask', onDelete);

    fireEvent.click(screen.getByLabelText('Delete'));
    await screen.findByText('Delete "Doomed"?');
    expect(onDelete).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Delete', { selector: 'button' }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(onDelete.mock.calls[0][0].id).toBe('a');
  });

  it('cancelling leaves it alone', async () => {
    const onDelete = vi.fn();
    render(<ConfirmDialogHost />);
    table([t({ id: 'a', title: 'Doomed' })], vi.fn(), undefined, 'Subtasks', 'Add subtask', onDelete);

    fireEvent.click(screen.getByLabelText('Delete'));
    await screen.findByText('Delete "Doomed"?');
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(screen.queryByText('Delete "Doomed"?')).toBeNull());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('offers no delete where the reader may not remove things', () => {
    table([t({ id: 'a', title: 'One' })]);
    expect(screen.queryByLabelText('Delete')).toBeNull();
  });
});
