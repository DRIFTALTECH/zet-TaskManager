import React from 'react';
import { LayoutDashboard, Clock, BarChart3, Users, FolderKanban, Sparkles, CalendarDays, CalendarRange, LayoutGrid, TrendingUp, ShieldCheck, FileText } from 'lucide-react';

export type NavGroup = 'primary' | 'management';

export interface NavItem {
  path: string;
  label: string;
  labelNode?: React.ReactNode;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  group: NavGroup;
  managerOnly?: boolean;
  /** Only a superadmin sees this entry. */
  superadminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, group: 'primary' },
  { path: '/timesheet', label: 'Timesheet', icon: Clock, group: 'primary' },
  { path: '/calendar', label: 'Calendar', icon: CalendarRange, group: 'primary' },
  { path: '/meeting-notes', label: 'Meeting Notes', icon: CalendarDays, group: 'primary' },
  {
    path: '/ai',
    label: 'Zani',
    group: 'primary',
    labelNode: (
      <>
        <span className="text-violet-600 dark:text-violet-400 font-bold">Z</span>ani
      </>
    ),
    icon: Sparkles,
  },
  { path: '/overview', label: 'Overview', icon: LayoutGrid, group: 'management', managerOnly: true },
  { path: '/manage', label: 'Projects', icon: FolderKanban, group: 'management', managerOnly: true },
  { path: '/users', label: 'Users', icon: Users, group: 'management', managerOnly: true },
  { path: '/reports', label: 'Reports', icon: BarChart3, group: 'management' },
  { path: '/users/forecast', label: 'What will happen next', icon: TrendingUp, group: 'management', managerOnly: true },
  { path: '/superadmin', label: 'Superadmin', icon: ShieldCheck, group: 'management', superadminOnly: true },
  { path: '/superadmin/prompts', label: 'AI Prompts', icon: Sparkles, group: 'management', superadminOnly: true },
];

/**
 * Whether a nav item is the active route.
 *
 * Shared by the desktop rail and the mobile drawer. They used to disagree: the
 * drawer compared the path exactly, so on /manage/123 or /users/abc it highlighted
 * nothing while the rail correctly highlighted the parent item.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (item.path === '/manage') return path.startsWith('/manage');
  if (item.path === '/overview') return path === '/overview' || path.startsWith('/overview/');
  if (item.path === '/users/forecast') return path === '/users/forecast';
  if (item.path === '/users') {
    return path === '/users' || (path.startsWith('/users/') && path !== '/users/forecast');
  }
  return path === item.path;
}

function allowedForRole(item: NavItem, role: string | undefined): boolean {
  if (item.superadminOnly && role !== 'superadmin') return false;
  if (item.managerOnly && role !== 'manager' && role !== 'superadmin') return false;
  return true;
}

/** Items this user may see, in order. */
export function visibleNavItems(role: string | undefined, group?: NavGroup): NavItem[] {
  return navItems.filter(item => {
    if (group && item.group !== group) return false;
    return allowedForRole(item, role);
  });
}
