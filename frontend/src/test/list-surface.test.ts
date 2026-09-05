/**
 * The list sits on the page, not on a panel.
 *
 * Rows are cards in their own right, so a filled container behind them was a
 * surface under surfaces, and a tint behind every group banded the list on top
 * of that. What separates the groups is the rule between them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const table = () => readFileSync(join(__dirname, '..', 'components/dash/DashTable.tsx'), 'utf8');

describe('the list container', () => {
  it('has neither a fill nor a frame', () => {
    const src = table();
    const container = src.slice(src.indexOf('className="mb-10'), src.indexOf('{groups.map'));
    expect(container).not.toContain('bg-card');
    expect(container).not.toContain('border');
  });

  it('leaves the group strips unwashed', () => {
    const src = table();
    const zone = src.slice(src.indexOf('const { setNodeRef, isOver } = useDroppable'), src.indexOf('{dragging && ('));
    // Side by side on the board the colour tells one column from the next;
    // stacked down a list it just bands the page behind the work.
    expect(zone).not.toContain('${surface}');
    expect(zone).not.toContain('bg-muted/20');
    // The rule between groups is what separates them.
    expect(zone).toContain('border-b');
  });

  it('keeps the colour where it is actually read — on the label', () => {
    expect(table()).toContain('${tokens.pill}');
  });

  it('washes the work, not the row that labels it', () => {
    const src = table();
    // The header strip stays plain; the colour sits behind the tasks, which is
    // the part of a group that is actually the group.
    expect(src).toContain('<div className={`rounded-lg ${tokens.surface}`}>');
    const header = src.slice(src.indexOf('<div className="group/group'), src.indexOf('{open && ('));
    expect(header).not.toContain('tokens.surface');
  });

  it('gives the add row the column accent, as the board column does', () => {
    expect(table()).toContain('${tokens.accent}');
  });

  it('still fills a group being dragged over, which is feedback not decoration', () => {
    const src = table();
    const zone = src.slice(src.indexOf('const { setNodeRef, isOver } = useDroppable'), src.indexOf('{dragging && ('));
    expect(zone).toContain("isOver ? 'bg-primary/5");
  });
});


describe('the rows themselves', () => {
  /** The row and the board card are drawn from one string. */
  const surface = () => {
    const src = readFileSync(join(__dirname, '..', 'lib/card-shadow.ts'), 'utf8');
    const i = src.indexOf('export const WORK_SURFACE');
    return src.slice(i, src.indexOf(';', i));
  };

  it('are the board card, not a flatter cousin of it', () => {
    // The same task read across instead of down. Drawn apart, the two drifted
    // and moving between views felt like moving between apps.
    expect(surface()).toContain('rounded-xl');
    expect(surface()).toContain('border border-border/70');
    expect(surface()).toContain('bg-card');
    expect(surface()).toContain('CARD_SHADOW');
  });

  it('take that surface from the shared string rather than restating it', () => {
    expect(readFileSync(join(__dirname, '..', 'components/dash/DashTable.tsx'), 'utf8'))
      .toContain('const ROW_CARD = WORK_SURFACE');
  });

  it('leave the title as plain text, the row carrying the surface', () => {
    const src = table();
    const i = src.indexOf('group-hover:text-primary');
    const title = src.slice(src.lastIndexOf('<span', i), src.indexOf('</span>', i));
    expect(title).not.toContain('bg-card');
    expect(title).not.toContain('shadow');
  });
});

describe('the board draws work the same way', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('takes its card from the same string', () => {
    expect(read('components/TaskCard.tsx')).toContain('${WORK_SURFACE}');
    expect(read('pages/DashboardPage.tsx')).toContain('${WORK_SURFACE}');
  });

  it('no longer spells the card out by hand anywhere', () => {
    for (const file of ['components/TaskCard.tsx', 'pages/DashboardPage.tsx']) {
      expect(read(file)).not.toContain('rounded-xl border border-border/70 bg-card p-3');
    }
  });
});

describe('adding a story to a group', () => {
  it('is offered without having to hover first', () => {
    const src = table();
    const button = src.slice(src.indexOf("aria-label=\"Add story at the top\""));
    // It was transparent until the group was hovered — invisible, and on a
    // touch screen unreachable.
    expect(button.slice(0, 600)).not.toContain('text-muted-foreground/0');
    expect(button.slice(0, 600)).not.toContain('group-hover/group:');
    expect(button.slice(0, 600)).toContain('text-muted-foreground/60');
  });
});


describe('the controls on each row', () => {
  const leading = () => {
    const src = table();
    return src.slice(src.indexOf('aria-label={`Select ${row.title}`}') - 900,
                     src.indexOf('{row.hasChildren ?'));
  };

  it('shows the checkbox without hovering', () => {
    // Hidden until hover, selecting rows was a feature you had to already know
    // about — and on a touch screen nothing reveals it at all.
    expect(leading()).not.toContain('opacity-0 group-hover:opacity-100');
  });

  it('shows the drag handle without hovering', () => {
    const src = leading();
    expect(src).not.toContain('text-muted-foreground/0');
    expect(src).not.toContain('group-hover:text-muted-foreground/50');
    // Quiet, but present.
    expect(src).toContain('text-muted-foreground/40');
  });

  it('still darkens the handle under the pointer', () => {
    expect(leading()).toContain('hover:text-foreground');
  });
});
