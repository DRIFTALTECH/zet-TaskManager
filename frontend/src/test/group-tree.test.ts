import { describe, it, expect } from 'vitest';
import { weekMonday } from '@/lib/date-range';

type Dim = 'week' | 'person' | 'project';
type E = { userId: string; projectId: string; workDate: string; seconds: number };
type Node = { path: string; title: string; seconds: number; entryCount: number; children: Node[]; entries: E[] };

/** Mirrors buildGroupTree in TimesheetPage. */
function build(entries: E[], dims: Dim[], parent = ''): Node[] {
  if (dims.length === 0) return [];
  const [dim, ...rest] = dims;
  const keyOf = (d: Dim, e: E) => d === 'week' ? weekMonday(e.workDate) : d === 'person' ? e.userId : e.projectId;
  const b = new Map<string, E[]>();
  for (const e of entries) {
    const k = keyOf(dim, e);
    b.set(k, [...(b.get(k) ?? []), e]);
  }
  return [...b.entries()].map(([k, rows]) => {
    const path = parent ? `${parent}/${k}` : k;
    return {
      path, title: k,
      seconds: rows.reduce((s, e) => s + e.seconds, 0),
      entryCount: rows.length,
      children: build(rows, rest, path),
      entries: rows,
    };
  });
}

const entries: E[] = [
  { userId: 'u1', projectId: 'p1', workDate: '2026-08-17', seconds: 3600 },
  { userId: 'u1', projectId: 'p2', workDate: '2026-08-18', seconds: 3600 },
  { userId: 'u2', projectId: 'p1', workDate: '2026-08-18', seconds: 3600 },
  { userId: 'u1', projectId: 'p1', workDate: '2026-08-25', seconds: 3600 },
];

describe('group drill-down tree', () => {
  it('one dimension gives a flat list of collapsed groups', () => {
    const t = build(entries, ['week']);
    expect(t).toHaveLength(2);
    expect(t.every(n => n.children.length === 0)).toBe(true); // leaves hold entries
  });

  it('two dimensions nest: weeks contain people', () => {
    const t = build(entries, ['week', 'person']);
    expect(t).toHaveLength(2);                       // 2 weeks at the top
    const wkA = t.find(n => n.path === '2026-08-17')!;
    expect(wkA.children).toHaveLength(2);            // u1 and u2 inside it
    expect(wkA.entryCount).toBe(3);
  });

  it('three dimensions nest three deep', () => {
    const t = build(entries, ['week', 'person', 'project']);
    const wkA = t.find(n => n.path === '2026-08-17')!;
    const u1 = wkA.children.find(n => n.path.endsWith('/u1'))!;
    expect(u1.children).toHaveLength(2);             // p1 and p2
    expect(u1.children[0].children).toHaveLength(0); // leaves
  });

  it('a parent total equals the sum of its children', () => {
    const t = build(entries, ['week', 'person']);
    for (const n of t) {
      expect(n.seconds).toBe(n.children.reduce((s, c) => s + c.seconds, 0));
    }
  });

  it('paths are unique, so expanding one group never opens another', () => {
    const t = build(entries, ['week', 'person', 'project']);
    const paths: string[] = [];
    const walk = (ns: Node[]) => ns.forEach(n => { paths.push(n.path); walk(n.children); });
    walk(t);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('CLICK ORDER decides the hierarchy: person-then-week nests people outside', () => {
    const t = build(entries, ['person', 'week']);
    expect(t).toHaveLength(2);                        // u1, u2 on the outside
    const u1 = t.find(n => n.path === 'u1')!;
    expect(u1.children).toHaveLength(2);              // two weeks inside u1
    expect(u1.entryCount).toBe(3);
  });

  it('the reverse click order produces the opposite nesting', () => {
    const weekFirst = build(entries, ['week', 'person']);
    const personFirst = build(entries, ['person', 'week']);
    // Same data, genuinely different shapes — the outer level differs.
    expect(weekFirst.map(n => n.path).sort()).toEqual(['2026-08-17', '2026-08-24']);
    expect(personFirst.map(n => n.path).sort()).toEqual(['u1', 'u2']);
  });

  it('project > person > week nests exactly in that order', () => {
    const t = build(entries, ['project', 'person', 'week']);
    const p1 = t.find(n => n.path === 'p1')!;
    expect(p1.children.map(c => c.path).sort()).toEqual(['p1/u1', 'p1/u2']);
    const p1u1 = p1.children.find(c => c.path === 'p1/u1')!;
    expect(p1u1.children.every(c => c.path.startsWith('p1/u1/2026-'))).toBe(true);
  });

  it('every entry survives, at every depth', () => {
    for (const dims of [
      ['week'], ['person'], ['project'],
      ['week', 'person'], ['person', 'week'], ['project', 'person'],
      ['week', 'person', 'project'], ['project', 'person', 'week'],
    ] as Dim[][]) {
      const t = build(entries, dims);
      const leaves: E[] = [];
      const walk = (ns: Node[]) => ns.forEach(n => n.children.length ? walk(n.children) : leaves.push(...n.entries));
      walk(t);
      expect(leaves).toHaveLength(entries.length);
    }
  });
});
