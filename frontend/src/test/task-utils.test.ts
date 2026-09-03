import { describe, it, expect } from 'vitest';
import { isStandaloneTask, isTaskConfirmed, isStoryConfirmed, rollupStoryHours } from '@/lib/task-utils';

describe('isTaskConfirmed', () => {
  it('hides manager-approved and terminal completed work from the active board', () => {
    expect(isTaskConfirmed({ status: 'completed', approvedByManager: true })).toBe(true);
    expect(isTaskConfirmed({ status: 'completed', approvedByManager: false })).toBe(true);
    expect(isTaskConfirmed({ status: 'done', approvedByManager: true })).toBe(true);
  });

  it('keeps Done tasks that still need manager confirmation', () => {
    expect(isTaskConfirmed({ status: 'done', approvedByManager: false })).toBe(false);
    expect(isTaskConfirmed({ status: 'in_progress', approvedByManager: false })).toBe(false);
  });
});

describe('isStoryConfirmed', () => {
  it('hides approved or completed stories from the active board', () => {
    expect(isStoryConfirmed({ status: 'completed', approvedByManager: true })).toBe(true);
    expect(isStoryConfirmed({ status: 'done', approvedByManager: true })).toBe(true);
    expect(isStoryConfirmed({ status: 'done', approvedByManager: false })).toBe(false);
  });
});

describe('isStandaloneTask', () => {
  it('treats missing or unknown story as standalone', () => {
    const ids = new Set(['us1']);
    expect(isStandaloneTask({ userStoryId: null }, ids)).toBe(true);
    expect(isStandaloneTask({ userStoryId: undefined }, ids)).toBe(true);
    expect(isStandaloneTask({ userStoryId: 'gone' }, ids)).toBe(true);
    expect(isStandaloneTask({ userStoryId: 'us1' }, ids)).toBe(false);
  });
});

describe('rollupStoryHours', () => {
  it('sums estimates and time tracked from linked tasks only', () => {
    const tasks = [
      { userStoryId: 'us1', estimatedHours: 4, timeTracked: 3600 },
      { userStoryId: 'us1', estimatedHours: 2, timeTracked: 1800 },
      { userStoryId: 'us2', estimatedHours: 99, timeTracked: 9999 },
      { userStoryId: 'us1', estimatedHours: null, timeTracked: 0 },
    ];
    expect(rollupStoryHours(tasks, 'us1')).toEqual({ estimatedHours: 6, actualHours: 1.5 });
    expect(rollupStoryHours(tasks, 'none')).toEqual({ estimatedHours: null, actualHours: 0 });
  });
});
