/**
 * The board's controls: one centred row, always there.
 *
 * Hiding them behind a click saved a row and cost a click on every visit. They
 * sit in the page rather than floating over it, so the board below keeps its
 * place whatever the toolbar is doing.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DashToolbar } from '@/components/dash/DashToolbar';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useAppStore } from '@/stores/appStore';

const noop = () => {};

function toolbar(over: Partial<Parameters<typeof DashToolbar>[0]> = {}) {
  const onSearch = vi.fn();
  const onSortBy = vi.fn();
  render(
    <TooltipProvider>
      <DashToolbar
        groupBy="status"
        onGroupBy={vi.fn()}
        sortBy="default"
        onSortBy={onSortBy}
        showGrouping
        search=""
        onSearch={onSearch}
        sprintOptions={{ names: [], hasBlank: false }}
        sprintFilter={new Set()}
        onToggleSprint={noop}
        onClearSprints={noop}
        members={[]}
        assigneeFilter={new Set()}
        onToggleAssignee={noop}
        onClearAssignees={noop}
        priorityFilter={new Set()}
        onTogglePriority={noop}
        onClearPriorities={noop}
        dateFrom=""
        dateTo=""
        onDateRange={noop}
        openFilter={null}
        onOpenFilter={noop}
        onClearAll={noop}
        {...over}
      />
    </TooltipProvider>,
  );
  return { onSearch, onSortBy };
}

beforeEach(() => {
  useAppStore.setState({ users: [] as never, projects: [] as never });
});

describe('the controls row', () => {
  const bar = () =>
    screen.getByPlaceholderText('Search tasks and stories…').closest('.absolute') as HTMLElement;

  it('floats over the board, clear of the bottom edge', () => {
    toolbar();
    // Absolute inside the dashboard rather than fixed to the window, so it
    // never reaches across the sidebar.
    expect(bar().className).toContain('bottom-2.5');
    expect(bar().className).toContain('z-50');
    expect(screen.getByPlaceholderText('Search tasks and stories…').closest('.fixed')).toBeNull();
  });

  it('lets clicks through everywhere except the controls themselves', () => {
    toolbar();
    // A transparent strip across the page would otherwise swallow every click
    // that landed in it.
    expect(bar().className).toContain('pointer-events-none');
    const row = screen.getByPlaceholderText('Search tasks and stories…')
      .closest('.pointer-events-auto') as HTMLElement;
    expect(row).toBeTruthy();
    // No panel behind the group: each control carries its own surface, so a
    // second one around them was a box drawn around things that had one.
    expect(row.className).not.toContain('bg-background/80');
    expect(row.className).not.toContain('backdrop-blur');
  });

  it('stays below the saving line, which has to sit above even this', () => {
    const page = readFileSync(join(__dirname, '..', 'pages/DashboardPage.tsx'), 'utf8');
    // The bar took z-50, so the line moved up rather than being buried by it.
    expect(page).toContain('top-0 z-[60] h-0.5');
  });

  it('keeps every control on the one bar', () => {
    toolbar({ viewSwitch: <button type="button">v</button> });
    const row = screen.getByPlaceholderText('Search tasks and stories…')
      .closest('.flex-nowrap') as HTMLElement;
    expect(row.contains(screen.getByLabelText('All people'))).toBe(true);
    expect(row.contains(screen.getByText('v'))).toBe(true);
  });

  it('shows the search field without anything being clicked first', () => {
    toolbar();
    expect(screen.getByPlaceholderText('Search tasks and stories…')).toBeTruthy();
  });

  it('shows every control beside it', () => {
    toolbar({ viewSwitch: <button type="button">Board switch</button> });
    expect(screen.getByText('Board switch')).toBeTruthy();
    expect(screen.getByLabelText(/^Sort:/)).toBeTruthy();
    for (const label of ['All sprints', 'All people', 'All priorities', 'Any due date']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });




  it('is dark by default, not only once the pointer arrives', () => {
    toolbar();
    // The dark fill used to be the hover state; it is now where the control
    // starts, and hover lifts a shade from there.
    for (const label of ['All people', 'Any due date']) {
      const cls = screen.getByLabelText(label).className;
      expect(cls).toContain('bg-foreground');
      expect(cls).toContain('text-background');
      expect(cls).toContain('shadow-md');
    }
  });

  it('gives the field the same dark ground, so the row reads as one thing', () => {
    toolbar();
    const box = screen.getByPlaceholderText('Search tasks and stories…').parentElement as HTMLElement;
    expect(box.className).toContain('bg-foreground');
    expect(box.className).toContain('text-background');
  });

  it('still answers the pointer, a shade off its resting colour', () => {
    toolbar();
    // Jumping to a different colour would be no response at all once the
    // resting state is already the dark one.
    expect(screen.getByLabelText('All people').className).toContain('hover:bg-foreground/85');
  });


  it('offers group only where grouping applies', () => {
    toolbar({ showGrouping: false });
    expect(screen.queryByLabelText(/^Group:/)).toBeNull();
    expect(screen.getByLabelText(/^Sort:/)).toBeTruthy();
  });

  it('draws no ring on the controls', () => {
    toolbar();
    // Nothing outlines a control here: the fill and the lift carry it, and a
    // ring on click was reading as a stray border.
    for (const label of ['All people', 'Any due date']) {
      const cls = screen.getByLabelText(label).className;
      expect(cls).not.toContain('focus:ring-2');
      expect(cls).not.toMatch(/\bborder\b/);
    }
  });
});

describe('searching', () => {
  it('passes what is typed straight through', () => {
    const { onSearch } = toolbar();
    fireEvent.change(screen.getByPlaceholderText('Search tasks and stories…'), {
      target: { value: 'plane' },
    });
    expect(onSearch).toHaveBeenCalledWith('plane');
  });

  it('offers a way to clear it only once there is something to clear', () => {
    toolbar();
    expect(screen.queryByLabelText('Clear search')).toBeNull();
    toolbar({ search: 'plane' });
    expect(screen.getAllByLabelText('Clear search').length).toBeGreaterThan(0);
  });

  it('clears from the field', () => {
    const { onSearch } = toolbar({ search: 'plane' });
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('Escape drops the query, there being nothing left to close', () => {
    const { onSearch } = toolbar({ search: 'plane' });
    fireEvent.keyDown(screen.getByPlaceholderText('Search tasks and stories…'), { key: 'Escape' });
    expect(onSearch).toHaveBeenCalledWith('');
  });

  it('still lists what is filtering the board below', () => {
    toolbar({ priorityFilter: new Set(['High']) as never });
    expect(screen.getByText('High')).toBeTruthy();
  });
});

describe('the filters', () => {
  const members = [
    { id: 'u1', name: 'Ada Lovelace', avatar: '' },
    { id: 'u2', name: 'Grace Hopper', avatar: '' },
  ];

  it('names each one for hover and for a screen reader', () => {
    toolbar({ members: members as never });
    for (const label of ['All sprints', 'All people', 'All priorities', 'Any due date']) {
      expect(screen.getByLabelText(label)).toBeTruthy();
    }
  });

  it('shows no text of its own', () => {
    toolbar();
    expect(screen.queryByText('All priorities')).toBeNull();
  });

  it('asks to be opened when clicked', () => {
    const onOpenFilter = vi.fn();
    toolbar({ members: members as never, onOpenFilter });
    fireEvent.click(screen.getByLabelText('All people'));
    expect(onOpenFilter).toHaveBeenCalledWith('people');
  });

  it('lists its choices once open', () => {
    const onToggleAssignee = vi.fn();
    toolbar({ members: members as never, onToggleAssignee, openFilter: 'people' });
    fireEvent.click(screen.getByText('Ada Lovelace'));
    expect(onToggleAssignee).toHaveBeenCalledWith('u1');
  });

  it('says what it is set to once something is chosen', () => {
    toolbar({ priorityFilter: new Set(['High']) as never });
    expect(screen.getByLabelText('All priorities: High')).toBeTruthy();
  });

  it('counts them when several are chosen', () => {
    toolbar({ priorityFilter: new Set(['High', 'Urgent']) as never });
    expect(screen.getByLabelText('All priorities: 2 selected')).toBeTruthy();
  });

  it('changes a setting from the row', () => {
    const { onSortBy } = toolbar();
    fireEvent.click(screen.getByLabelText(/^Sort:/));
    fireEvent.click(screen.getByText('Due date'));
    expect(onSortBy).toHaveBeenCalledWith('due');
  });

  it('offers a way to clear the dates', () => {
    const onDateRange = vi.fn();
    toolbar({ dateFrom: '2026-09-01', dateTo: '2026-09-30', onDateRange });
    fireEvent.click(screen.getByLabelText(/Sep 01, 2026/));
    fireEvent.click(screen.getByText('Clear dates'));
    expect(onDateRange).toHaveBeenCalledWith('', '');
  });
});


describe('the bar sizing', () => {
  const bar = () =>
    screen.getByPlaceholderText('Search tasks and stories…').closest('.absolute') as HTMLElement;
  const field = () =>
    screen.getByPlaceholderText('Search tasks and stories…').parentElement as HTMLElement;
  const row = () =>
    screen.getByPlaceholderText('Search tasks and stories…').closest('.flex-nowrap') as HTMLElement;

  it('stays at one size — nothing to wake up first', () => {
    toolbar();
    // It grew on interaction and shrank again, which meant the row moved under
    // the pointer on the way to the control being reached for.
    for (const label of ['All people', 'Any due date']) {
      expect(screen.getByLabelText(label).className).toContain('h-9');
    }
    expect(field().className).toContain('h-9');
  });

  it('does not change size when a control is touched', () => {
    toolbar();
    const before = screen.getByLabelText('All people').className;
    fireEvent.mouseDown(screen.getByLabelText('All people'));
    expect(screen.getByLabelText('All people').className).toBe(before);
  });

  it('opens the field to a readable width once it is shown', () => {
    toolbar();
    fireEvent.mouseEnter(row());
    expect(field().className).toContain('w-[min(70vw,22rem)]');
  });

  it('rounds every control to a pill, the field included', () => {
    toolbar();
    expect(field().className).toContain('rounded-full');
    for (const label of ['All people', 'Any due date']) {
      expect(screen.getByLabelText(label).className).toContain('rounded-full');
    }
  });

  it('keeps the chips reachable, floating with the controls', () => {
    toolbar({ priorityFilter: new Set(['High']) as never });
    // In the page flow they rendered under the floating bar and were covered by
    // it, which made "Clear all" the one thing on screen nobody could reach.
    const chip = screen.getByText('High');
    expect(bar().contains(chip)).toBe(true);
    expect(bar().contains(screen.getByText('Clear all'))).toBe(true);
  });

  it('centres the row over the board it belongs to', () => {
    toolbar();
    expect(row().className).toContain('justify-center');
  });
});


describe('a long search query', () => {
  const long = 'sdf sdf sd fs dfa sdf asdf sdf sd fs df a sdf sdf sd fs dfa sdf asdf';

  it('does not let its chip stretch across the page', () => {
    toolbar({ search: long });
    const chip = screen.getByTitle(`“${long}”`);
    // Untruncated it ran the width of the page and out the far side, under the
    // controls sitting on top of it.
    expect(chip.className).toContain('max-w-');
    expect(chip.querySelector('.truncate')).toBeTruthy();
  });

  it('still says the whole query on hover, and can still be removed', () => {
    toolbar({ search: long });
    expect(screen.getByTitle(`“${long}”`)).toBeTruthy();
    expect(screen.getByLabelText(`Remove “${long}”`)).toBeTruthy();
  });
});


describe('the bar unfolding', () => {
  const row = () =>
    screen.getByPlaceholderText('Search tasks and stories…').closest('.flex-nowrap') as HTMLElement;
  const field = () =>
    screen.getByPlaceholderText('Search tasks and stories…').parentElement as HTMLElement;
  const wings = () =>
    [...row().querySelectorAll(':scope > span')] as HTMLElement[];

  it('starts as the search control alone', () => {
    toolbar({ viewSwitch: <button type="button">v</button> });
    // Closed it is one thing to aim at, not a row to read.
    expect(field().className).toContain('w-9');
    for (const w of wings()) {
      expect(w.className).toContain('max-w-0');
      expect(w.className).toContain('opacity-0');
    }
  });

  it('unfolds outward — one side from the left, one from the right', () => {
    toolbar({ viewSwitch: <button type="button">v</button> });
    const [left, right] = wings();
    expect(left.className).toContain('-translate-x-4');
    expect(right.className).toContain('translate-x-4');
    expect(right.className).not.toContain('-translate-x-4');
  });

  it('opens everything when the pointer arrives', () => {
    toolbar({ viewSwitch: <button type="button">v</button> });
    fireEvent.mouseEnter(row());
    expect(field().className).toContain('w-[min(70vw,22rem)]');
    for (const w of wings()) {
      expect(w.className).toContain('opacity-100');
      expect(w.className).toContain('translate-x-0');
    }
  });

  it('leads with the view switch and trails with what the board is scoped to', () => {
    toolbar({
      viewSwitch: <button type="button">v</button>,
      leading: <button type="button">p</button>,
    });
    const [left, right] = wings();
    expect(left.contains(screen.getByText('v'))).toBe(true);
    expect(right.contains(screen.getByText('p'))).toBe(true);
  });

  it('closes again when the pointer leaves', () => {
    toolbar();
    fireEvent.mouseEnter(row());
    fireEvent.mouseLeave(row());
    expect(field().className).toContain('w-9');
  });

  it('stays open while a query is holding the board', () => {
    // Collapsing would hide the control keeping the board in the state being
    // read, and the words that put it there.
    toolbar({ search: 'plane' });
    fireEvent.mouseLeave(row());
    expect(field().className).toContain('w-[min(70vw,22rem)]');
  });

  it('stays open while a filter is on', () => {
    toolbar({ priorityFilter: new Set(['High']) as never });
    fireEvent.mouseLeave(row());
    for (const w of wings()) expect(w.className).toContain('opacity-100');
  });

  it('opens on keyboard focus, which no hover ever reports', () => {
    toolbar();
    fireEvent.focus(screen.getByPlaceholderText('Search tasks and stories…'));
    expect(field().className).toContain('w-[min(70vw,22rem)]');
  });
});
