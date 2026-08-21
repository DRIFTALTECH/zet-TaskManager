import { describe, it, expect } from 'vitest';
import { weekMonday } from '@/lib/date-range';

/** Mirrors the grouping in TeamTimeBreakdown, so the maths is pinned by a test. */
type E = { userId: string; projectId: string; workDate: string; seconds: number; billable: boolean };

function group(entries: E[], by: 'week' | 'project' | 'person') {
  const m = new Map<string, { seconds: number; billable: number; people: Set<string>; n: number }>();
  for (const e of entries) {
    const key = by === 'week' ? weekMonday(e.workDate) : by === 'project' ? e.projectId : e.userId;
    const g = m.get(key) ?? { seconds: 0, billable: 0, people: new Set<string>(), n: 0 };
    g.seconds += e.seconds;
    if (e.billable) g.billable += e.seconds;
    g.people.add(e.userId);
    g.n += 1;
    m.set(key, g);
  }
  return m;
}

const entries: E[] = [
  { userId: 'u1', projectId: 'p1', workDate: '2026-08-17', seconds: 3600, billable: true },  // Mon
  { userId: 'u1', projectId: 'p2', workDate: '2026-08-19', seconds: 7200, billable: false }, // Wed, same week
  { userId: 'u2', projectId: 'p1', workDate: '2026-08-24', seconds: 1800, billable: true },  // next week
];

describe('team time grouping', () => {
  it('groups a whole week together regardless of weekday', () => {
    const g = group(entries, 'week');
    expect(g.size).toBe(2);
    expect(g.get('2026-08-17')!.seconds).toBe(10800); // 1h + 2h
    expect(g.get('2026-08-24')!.seconds).toBe(1800);
  });

  it('groups by project across people and weeks', () => {
    const g = group(entries, 'project');
    expect(g.get('p1')!.seconds).toBe(5400);   // u1 1h + u2 0.5h
    expect(g.get('p1')!.people.size).toBe(2);  // two people on this project
    expect(g.get('p2')!.seconds).toBe(7200);
  });

  it('groups by person across projects', () => {
    const g = group(entries, 'person');
    expect(g.get('u1')!.seconds).toBe(10800);
    expect(g.get('u1')!.n).toBe(2);
    expect(g.get('u2')!.seconds).toBe(1800);
  });

  it('counts billable separately from total', () => {
    const g = group(entries, 'person');
    expect(g.get('u1')!.billable).toBe(3600);  // only the first entry is billable
    expect(g.get('u1')!.seconds).toBe(10800);
  });

  it('totals are identical whichever way you group', () => {
    const total = (by: 'week' | 'project' | 'person') =>
      [...group(entries, by).values()].reduce((s, g) => s + g.seconds, 0);
    expect(total('week')).toBe(12600);
    expect(total('project')).toBe(12600);
    expect(total('person')).toBe(12600);
  });
});
