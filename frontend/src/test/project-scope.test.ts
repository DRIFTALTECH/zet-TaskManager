import { describe, expect, it } from 'vitest';
import { defaultSelectedProjectIdForUser } from '@/lib/project-utils';
import type { Project } from '@/types';

const project = (id: string): Project => ({
  id, name: id, description: '', members: [], sections: [], createdAt: '',
} as Project);

describe('which project the dashboard opens on', () => {
  it('opens a member on All projects', () => {
    expect(defaultSelectedProjectIdForUser([project('p1')], ['p1'], 'employee')).toBe('all');
  });

  it('opens a superadmin on All projects even though they join none', () => {
    // They see everything by design; membership says nothing about their scope.
    expect(defaultSelectedProjectIdForUser([project('p1')], [], 'superadmin')).toBe('all');
  });

  it('has nowhere to send someone with no projects', () => {
    expect(defaultSelectedProjectIdForUser([project('p1')], [], 'employee')).toBe(null);
    expect(defaultSelectedProjectIdForUser([], [], 'superadmin')).toBe(null);
  });
});
