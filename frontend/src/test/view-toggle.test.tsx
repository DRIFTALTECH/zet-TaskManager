/**
 * One button flips between list and board.
 *
 * There are exactly two views, so a pair of buttons spent a second slot saying
 * which one you were already looking at — which the board itself already says.
 * The icon shows the view you are in; the label says where clicking goes.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const page = () => readFileSync(join(__dirname, '..', 'pages/DashboardPage.tsx'), 'utf8');

describe('the view toggle', () => {
  it('is one control, not a pair', () => {
    const src = page();
    expect(src).toContain("const next = dashView === 'list' ? 'board' : 'list'");
    // The old pair mapped over both views to render a button each.
    expect(src).not.toContain("['list', 'List', List],");
  });

  it('says where clicking will take you, not just what it is', () => {
    expect(page()).toContain('`Switch to ${next} view`');
  });

  it('sits at the shared toolbar size, left of search', () => {
    const src = page();
    const toggle = src.slice(src.indexOf('const next = dashView'));
    expect(toggle.slice(0, 700)).toContain('className={ICON_TRIGGER}');
    // viewSwitch is rendered before the search control in the toolbar row.
    expect(src).toContain('viewSwitch={');
  });
});

describe('the toolbar no longer carries Add', () => {
  it('has no add control of its own', () => {
    const src = page();
    const toolbarCall = src.slice(src.indexOf('<DashToolbar'), src.indexOf('/>', src.indexOf('onClearAll=')));
    expect(toolbarCall).not.toContain('trailing=');
    expect(toolbarCall).not.toContain('Add work');
  });

  it('leaves each view its own way to create work', () => {
    // Removing the toolbar button must not strand anyone: the list adds per
    // group, the board per column.
    const table = readFileSync(join(__dirname, '..', 'components/dash/DashTable.tsx'), 'utf8');
    expect(table).toContain('Add story');
    expect(table).toContain('AddWorkMenu');
    expect(page()).toContain('Add task');
  });
});
