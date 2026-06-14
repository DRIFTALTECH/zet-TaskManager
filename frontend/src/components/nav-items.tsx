import React from 'react';
import { LayoutDashboard, ListTodo, Clock, BarChart3, Users, FolderKanban, ShieldCheck, Sparkles } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  labelNode?: React.ReactNode;
  icon: React.FC<React.SVGProps<SVGSVGElement>>;
  managerOnly?: boolean;
}

export const navItems: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/tasks', label: 'My Tasks', icon: ListTodo },
  { path: '/timesheet', label: 'Timesheet', icon: Clock },
  { path: '/reports', label: 'Time report', icon: BarChart3 },
  { path: '/users', label: 'Users', icon: Users, managerOnly: true },
  { path: '/manage', label: 'Manage projects', icon: FolderKanban, managerOnly: true },
  { path: '/audit', label: 'Audit', icon: ShieldCheck },
  {
    path: '/ai',
    label: 'Zani',
    labelNode: (
      <>
        <span className="text-violet-400 font-bold">Z</span>ani
      </>
    ),
    icon: Sparkles,
  },
];
