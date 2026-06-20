import { describe, it, expect } from 'vitest';
import { formatHM, hoursDecimal, projectAccent, PROJECT_ACCENTS } from '@/lib/manage-utils';

describe('formatHM', () => {
  it('formats hours and minutes', () => {
    expect(formatHM(0)).toBe('0m');
    expect(formatHM(60)).toBe('1m');
    expect(formatHM(3600)).toBe('1h');
    expect(formatHM(3660)).toBe('1h 1m');
    expect(formatHM(3 * 3600 + 25 * 60)).toBe('3h 25m');
  });
});

describe('hoursDecimal', () => {
  it('rounds to 1 decimal', () => {
    expect(hoursDecimal(3600)).toBe(1);
    expect(hoursDecimal(1800)).toBe(0.5);
    expect(hoursDecimal(5400)).toBe(1.5);
  });
});

describe('projectAccent', () => {
  it('is deterministic and from the palette', () => {
    const a = projectAccent('proj-123');
    expect(a).toBe(projectAccent('proj-123')); // stable per id
    expect(PROJECT_ACCENTS).toContain(a);
    expect(a.hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
