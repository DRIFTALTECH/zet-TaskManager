/**
 * A status group in the list is a board column, so it can be recoloured and
 * reordered from either view.
 *
 * The same change, reached from wherever you happen to be reading the work —
 * having to switch to the board to recolour a column is a detour through a
 * view you did not want.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
const table = () => read('components/dash/DashTable.tsx');

describe('recolouring a column from the list', () => {
  it('offers the palette on the group header', () => {
    expect(table()).toContain('aria-label={`Colour of ${group.label}`}');
  });

  it('offers the same swatches the board offers', () => {
    // One palette, not a second list that drifts from the first.
    expect(table()).toContain('COLUMN_COLOR_KEYS.map');
    expect(read('pages/DashboardPage.tsx')).toContain('COLUMN_COLOR_KEYS.map');
  });

  it('marks which colour is currently set', () => {
    expect(table()).toContain("(group.color ?? DEFAULT_COLUMN_COLOR) === key");
  });
});

describe('reordering columns from the list', () => {
  it('gives each status group a drag handle', () => {
    expect(table()).toContain('aria-label="Drag to reorder this column"');
  });

  it('keeps that handle clear of the drop target the group already has', () => {
    // The group registers `groupKey` for rows landing on it; reordering uses a
    // `group:` id so the two cannot be mistaken for each other.
    expect(table()).toContain('id: `group:${groupKey}`');
    expect(table()).toContain("overId.startsWith('group:')");
  });

  it('answers a group drag before it looks for a row', () => {
    const src = table();
    const groupBranch = src.indexOf('const movedGroup = e.active.data.current?.groupKey');
    const rowBranch = src.indexOf('const row = (e.active.data.current?.row as DashRow)', groupBranch);
    expect(groupBranch).toBeGreaterThan(-1);
    expect(rowBranch).toBeGreaterThan(groupBranch);
  });
});

describe('where these controls do not belong', () => {
  it('hides both when the groups are not columns', () => {
    // Grouped by assignee or priority there is nothing to recolour or reorder.
    const src = table();
    expect(src).toContain('groupKeyIsStatus && onReorderColumns && <GroupHandle');
    expect(src).toContain('groupKeyIsStatus && onSetColumnColor && (');
  });
});
