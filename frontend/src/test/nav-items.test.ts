import { describe, it, expect } from 'vitest';
import { isNavItemActive, visibleNavItems, navItems } from '@/components/nav-items';

const item = (path: string) => navItems.find(i => i.path === path)!;

describe('isNavItemActive', () => {
  it('highlights the parent on nested manage routes', () => {
    expect(isNavItemActive(item('/manage'), '/manage/123')).toBe(true);
    expect(isNavItemActive(item('/manage'), '/manage')).toBe(true);
  });

  it('highlights Users on a user detail page', () => {
    expect(isNavItemActive(item('/users'), '/users/abc')).toBe(true);
    expect(isNavItemActive(item('/users'), '/users')).toBe(true);
  });

  it('does not confuse the forecast route with Users', () => {
    expect(isNavItemActive(item('/users'), '/users/forecast')).toBe(false);
    expect(isNavItemActive(item('/users/forecast'), '/users/forecast')).toBe(true);
  });

  it('highlights Overview on nested overview routes', () => {
    expect(isNavItemActive(item('/overview'), '/overview')).toBe(true);
    expect(isNavItemActive(item('/overview'), '/overview/users')).toBe(true);
  });

  it('matches plain routes exactly', () => {
    expect(isNavItemActive(item('/timesheet'), '/timesheet')).toBe(true);
    expect(isNavItemActive(item('/timesheet'), '/timesheet/approvals')).toBe(false);
    expect(isNavItemActive(item('/calendar'), '/calendar/')).toBe(true);
  });

  it('does not mark Dashboard active on other routes', () => {
    expect(isNavItemActive(item('/'), '/timesheet')).toBe(false);
  });
});

describe('visibleNavItems', () => {
  it('hides manager-only and superadmin-only items from an employee', () => {
    const paths = visibleNavItems('employee').map(i => i.path);
    expect(paths).not.toContain('/users');
    expect(paths).not.toContain('/manage');
    expect(paths).not.toContain('/superadmin');
    expect(paths).toContain('/timesheet');
  });

  it('gives a manager the manager items but not the superadmin page', () => {
    const paths = visibleNavItems('manager').map(i => i.path);
    expect(paths).toContain('/manage');
    expect(paths).not.toContain('/superadmin');
  });

  it('gives a superadmin everything', () => {
    expect(visibleNavItems('superadmin').map(i => i.path)).toContain('/superadmin');
  });

  it('keeps workspace items in primary and the rest under management', () => {
    expect(visibleNavItems('superadmin', 'primary').map(i => i.path)).toEqual([
      '/', '/timesheet', '/calendar', '/meeting-notes', '/ai',
    ]);
    expect(visibleNavItems('superadmin', 'management').map(i => i.path)).toEqual([
      '/overview', '/manage', '/users', '/reports', '/users/forecast', '/superadmin',
    ]);
  });
});
