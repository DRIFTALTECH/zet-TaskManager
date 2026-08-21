import { describe, it, expect } from 'vitest';
import { resolveRange, weekMonday, todayIso, addDays, daysBetween } from '@/lib/date-range';

describe('week presets', () => {
  it('this week starts on this Monday and lasts 7 days', () => {
    const r = resolveRange({ preset: 'week', offset: 0 });
    expect(r.start).toBe(weekMonday(todayIso()));
    expect(daysBetween(r.start, r.end)).toBe(7);
  });

  it('last week is exactly the previous Monday', () => {
    const r = resolveRange({ preset: 'lastweek', offset: 0 });
    expect(r.start).toBe(addDays(weekMonday(todayIso()), -7));
    expect(daysBetween(r.start, r.end)).toBe(7);
  });

  it('this week and last week never overlap', () => {
    const a = resolveRange({ preset: 'week', offset: 0 });
    const b = resolveRange({ preset: 'lastweek', offset: 0 });
    expect(b.end < a.start).toBe(true);
  });

  it('stepping back from last week reaches the week before', () => {
    const r = resolveRange({ preset: 'lastweek', offset: -1 });
    expect(r.start).toBe(addDays(weekMonday(todayIso()), -14));
  });

  it('a custom range is preserved exactly', () => {
    const r = resolveRange({ preset: 'custom', offset: 0, custom: { start: '2026-03-02', end: '2026-04-15' } });
    expect(r).toEqual({ start: '2026-03-02', end: '2026-04-15' });
  });
});

describe('custom range selection', () => {
  it('a start with no end yet resolves to that single day', () => {
    const r = resolveRange({ preset: 'custom', offset: 0, custom: { start: '2026-03-10' } });
    expect(r).toEqual({ start: '2026-03-10', end: '2026-03-10' });
  });

  it('an end before the start is ignored rather than inverting', () => {
    const r = resolveRange({ preset: 'custom', offset: 0, custom: { start: '2026-03-10', end: '2026-03-01' } });
    expect(r.end).toBe('2026-03-10');
  });
});

describe('all-time preset', () => {
  it('spans far enough back to mean "no filter"', () => {
    const r = resolveRange({ preset: 'all', offset: 0 });
    expect(r.start < '2001-01-01').toBe(true);
    expect(r.end > todayIso()).toBe(true);
  });
});
