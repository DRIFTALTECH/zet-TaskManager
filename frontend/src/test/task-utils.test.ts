import { describe, it, expect } from 'vitest';
import { isTaskConfirmed } from '@/lib/task-utils';

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
