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

  it('matches plain routes exactly', () => {
    expect(isNavItemActive(item('/timesheet'), '/timesheet')).toBe(true);
    expect(isNavItemActive(item('/timesheet'), '/timesheet/approvals')).toBe(false);
  });

  it('does not mark Dashboard active on other routes', () => {
    expect(isNavItemActive(item('/'), '/tasks')).toBe(false);
  });
});

describe('visibleNavItems', () => {
  it('hides manager-only and superadmin-only items from an employee', () => {
    const paths = visibleNavItems('employee').map(i => i.path);
    expect(paths).not.toContain('/users');
    expect(paths).not.toContain('/manage');
    expect(paths).not.toContain('/prd');
    expect(paths).not.toContain('/superadmin');
    expect(paths).toContain('/timesheet');
  });

  it('gives a manager the manager items but not the superadmin page', () => {
    const paths = visibleNavItems('manager').map(i => i.path);
    expect(paths).toContain('/manage');
    expect(paths).toContain('/prd');
    expect(paths).not.toContain('/superadmin');
  });

  it('gives a superadmin everything', () => {
    expect(visibleNavItems('superadmin').map(i => i.path)).toContain('/superadmin');
  });
});
