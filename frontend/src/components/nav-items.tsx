import React from 'react';
import { LayoutDashboard, Clock, BarChart3, Users, FolderKanban, Sparkles, CalendarDays, CalendarRange, LayoutGrid, TrendingUp, ShieldCheck, FileText } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  labelNode?: React.ReactNode;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  managerOnly?: boolean;
  /** Only a superadmin sees this entry. */
  superadminOnly?: boolean;
}

export const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/overview', label: 'Overview', icon: LayoutGrid, managerOnly: true },
  { path: '/timesheet', label: 'Timesheet', icon: Clock },
  { path: '/calendar', label: 'Calendar', icon: CalendarRange },
  { path: '/meeting-notes', label: 'Meeting notes', icon: CalendarDays },
  { path: '/reports', label: 'Reports', icon: BarChart3 },
  { path: '/users', label: 'Users', icon: Users, managerOnly: true },
  { path: '/users/forecast', label: 'What Will Happen Next?', icon: TrendingUp, managerOnly: true },
  { path: '/manage', label: 'Manage projects', icon: FolderKanban, managerOnly: true },
  { path: '/prd', label: 'PRD import', icon: FileText, managerOnly: true },
  {
    path: '/ai',
    label: 'Zani',
    labelNode: (
      <>
        <span className="text-violet-600 dark:text-violet-400 font-bold">Z</span>ani
      </>
    ),
    icon: Sparkles,
  },
  { path: '/superadmin', label: 'Superadmin', icon: ShieldCheck, superadminOnly: true },
];


/**
 * Whether a nav item is the active route.
 *
 * Shared by the desktop rail and the mobile drawer. They used to disagree: the
 * drawer compared the path exactly, so on /manage/123 or /users/abc it highlighted
 * nothing while the rail correctly highlighted the parent item.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.path === '/manage') return pathname.startsWith('/manage');
  if (item.path === '/users/forecast') return pathname === '/users/forecast';
  if (item.path === '/users') {
    return pathname === '/users' || (pathname.startsWith('/users/') && pathname !== '/users/forecast');
  }
  return pathname === item.path;
}

/** Items this user may see, in order. */
export function visibleNavItems(role: string | undefined): NavItem[] {
  return navItems.filter(item => {
    if (item.superadminOnly && role !== 'superadmin') return false;
    if (item.managerOnly && role !== 'manager' && role !== 'superadmin') return false;
    return true;
  });
}
