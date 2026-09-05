/**
 * Every control in the dashboard toolbar is the same height and shape.
 *
 * They had drifted to three heights at once — 28px filters, a 32px search box
 * and a 36px date field that was also more rounded and a font size larger — so
 * a single row read as three kinds of thing.
 *
 * Asserted against the source rather than a render: these are Tailwind classes,
 * and jsdom computes no styles from them, so a rendered test would pass no
 * matter how far apart they drifted.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_H } from '@/lib/field-styles';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

describe('the one control height', () => {
  it('is what the toolbar filters use', () => {
    const toolbar = src('components/dash/DashToolbar.tsx');
    expect(toolbar).toContain('${CONTROL_H}');
  });

  it('is what the toolbar filters use', () => {
    // The row of named filter boxes is gone, but TRIGGER still backs the
    // labelled variant, and it stays on the app's field height.
    const toolbar = src('components/dash/DashToolbar.tsx');
    const trigger = toolbar.slice(toolbar.indexOf('const TRIGGER ='), toolbar.indexOf('export const ICON_TRIGGER'));
    expect(trigger).toContain('${CONTROL_H}');
  });

  it('gives the board\'s controls one comfortable size and keeps it', () => {
    const toolbar = src('components/dash/DashToolbar.tsx');
    // They grew on interaction and shrank again, which moved the row under the
    // pointer on the way to the control being reached for.
    expect(toolbar).toContain("export const TOOLBAR_H = 'h-9'");
    expect(toolbar).not.toContain('[&_.tb-btn]:h-7');
    expect(toolbar).not.toContain('const [active, setActive]');
  });

  it('marks the one control that does not go through the shared trigger', () => {
    // The date button builds its own class, so it carries the marker by hand.
    expect(src('components/dash/DashToolbar.tsx')).toContain('className="tb-btn"');
  });

  it('is what the labelled date field uses', () => {
    // Scoped to that branch: the icon variant is a toolbar control and sits at
    // the toolbar's height, which is a different rhythm on purpose.
    const src_ = src('components/DateRangeField.tsx');
    const labelled = src_.slice(src_.lastIndexOf('min-w-[11rem]') - 200);
    expect(labelled).toContain('${CONTROL_H}');
    expect(labelled).not.toMatch(/flex h-9 /);
  });

  it('is 28px, so the assertions above mean something', () => {
    expect(CONTROL_H).toBe('h-7');
  });
});

describe('the one control shape', () => {
  const field = () => src('components/DateRangeField.tsx');

  it('gives the icon variant the same pill as every other toolbar control', () => {
    const icon = field().slice(field().indexOf('if (iconOnly)'), field().indexOf('  return (\n    <Popover open={open}'));
    expect(icon).toContain('h-9 w-9');
    expect(icon).toContain('rounded-full');
  });

  it('keeps the labelled variant in the row rhythm too, for its other callers', () => {
    const labelled = field().slice(field().lastIndexOf('min-w-[11rem]'));
    expect(labelled.slice(0, 300)).toContain('text-xs');
    // rounded-xl next to rounded-lg is what made it read as a different object.
    expect(labelled.slice(0, 300)).not.toContain('rounded-xl');
  });
});

describe('the dashboard header row', () => {
  it('leaves the buttons at the shared control height', () => {
    const page = src('pages/DashboardPage.tsx');
    // A hand-written height on a Button overrides the size the design system
    // already gives it, which is how this row came apart in the first place.
    expect(page).not.toContain('size="sm" className="h-8');
  });
});


describe('the dashboard no longer keeps a row for the project', () => {
  const page = () => src('pages/DashboardPage.tsx');

  it('picks the project from an icon in the control row', () => {
    // It was a full-width Select on a line of its own, above everything.
    expect(page()).not.toContain('aria-label="Project"\n');
    expect(page()).toContain('aria-label={`Project: ${selectedProjectLabel}`}');
    expect(page()).toContain('leading={');
  });

  it('keeps the project name reachable, since the icon cannot show it', () => {
    expect(page()).toContain('const selectedProjectLabel');
    expect(page()).toContain('<Hint label={userProjects.length === 0 ?');
  });

  it('gives that icon the same square as the rest of the row', () => {
    // It shares the one trigger style rather than restating it, which is how
    // the row keeps a single rhythm as controls come and go.
    const trigger = page().slice(page().indexOf('aria-label={`Project:'));
    expect(trigger.slice(0, 500)).toContain('className={ICON_TRIGGER}');
  });
});

describe('where the toolbar sits on the page', () => {
  it('is rendered after the work, not before it', () => {
    const page = src('pages/DashboardPage.tsx');
    // `sticky bottom-0` does nothing to an element that is already first in the
    // column — there is nothing below it to stick past. It has to come last.
    const board = page.indexOf("{dashView === 'list' ? (");
    const bar = page.indexOf('<DashToolbar');
    expect(bar).toBeGreaterThan(board);
  });
});

describe('the floating bar and the work under it', () => {
  const page = () => src('pages/DashboardPage.tsx');

  it('leaves the list room to scroll past it', () => {
    // Without clearance the last rows sit under the bar with no way to reach
    // them: the page has already scrolled as far as it goes.
    expect(page()).toContain('flex-1 min-h-0 overflow-auto pb-16');
  });

  it('gives the board its clearance inside the columns, not under them', () => {
    // Under the columns it read as dead space at the foot of the board; the
    // cards scroll inside each column, so that is where the room is needed.
    expect(page()).toContain('flex-1 min-h-0 pb-2');
    expect(page()).toContain('overscroll-contain rounded-xl px-1.5 pt-2 pb-14');
  });

  it('keeps the saving line above even the bar', () => {
    // A slow save that shows nothing looks like a click that missed.
    expect(page()).toContain('top-0 z-[60] h-0.5');
  });
});

/**
 * The board groups the same way the list does.
 *
 * Grouping used to be hidden outside the list, so the board could only ever be
 * read by status. Asserted against the source for the same reason as above: the
 * lanes are built inside the page component from a hook, and the parts worth
 * pinning here are the wiring decisions, not the rendered output.
 */
describe('grouping reaches the board', () => {
  const page = () => src('pages/DashboardPage.tsx');

  it('offers the group control in both views', () => {
    expect(page()).not.toContain("showGrouping={dashView === 'list'}");
    expect(page()).toContain('showGrouping');
  });

  it('draws lanes for what the board is grouped by, not only the columns', () => {
    expect(page()).toContain('{boardLanes.map(col => (');
    expect(page()).toContain('items={boardLanes.map(c => c.id)}');
  });

  it('keeps stored-column editing to the stored columns', () => {
    // Reorder, colour, rename and the Done marker all write to a column row.
    // A lane derived from priority or a person has no row to write to.
    expect(page()).toContain('canEditLane={statusLanes}');
    expect(page()).toContain('isDoneColumn={statusLanes && col.id === doneColumnId}');
  });

  it('puts cards where the grouping says, not where the status says', () => {
    expect(page()).toContain('boardTaskCards.filter(c => laneOf(c.task) === colId)');
    expect(page()).toContain('if (laneOfStory(st) !== colId) return false;');
  });
});

/**
 * Drilling into a story's task, or a task's subtask, can be walked back.
 *
 * Each of those replaces the modal rather than stacking on it, so the way back
 * used to be closing and finding the parent again on the board. Asserted
 * against the source: the trail lives in page state and the button is one prop
 * on a modal rendered deep inside a page that needs the whole store to mount.
 */
describe('stepping back out of a detail', () => {
  const page = () => src('pages/DashboardPage.tsx');

  it('remembers what a task was opened from', () => {
    expect(page()).toContain('const [detailTrail, setDetailTrail]');
    expect(page()).toContain('setDetailTrail(prev => [...prev, from]);');
  });

  it('routes the events that open a subtask through the trail', () => {
    // Subtask rows, global search and notifications all use this one event.
    expect(page()).toContain('if (found) openTaskFromDetail(found);');
    expect(page()).toContain('onTaskClick={openTaskFromDetail}');
  });

  it('treats a click on the board as an entry, not a step deeper', () => {
    expect(page()).toContain('onTaskClick={openTaskFresh}');
    expect(page()).toContain('onStoryClick={openStoryFresh}');
  });

  it('offers the button only where there is somewhere to go', () => {
    const backs = page().match(/onBack=\{detailTrail\.length > 0 \? goBackDetail : undefined\}/g);
    expect(backs).toHaveLength(2);
  });

  it('steps back onto the current version of the item, not the one left behind', () => {
    // The trail holds ids, so a story edited while a task was open comes back
    // with those edits rather than as the copy captured on the way in.
    expect(page()).toContain('const s = dashStories.find(x => x.id === last.id);');
    expect(page()).toContain('const t = tasks.find(x => x.id === last.id);');
  });

  it('clears the trail when the modal is closed outright', () => {
    expect(page()).toContain('onOpenChange={o => !o && closeDetail()}');
    expect(page()).toContain('onOpenChange={o => { if (!o) closeDetail(); }}');
  });
});
