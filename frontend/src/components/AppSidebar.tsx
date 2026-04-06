import { useAppStore } from '@/stores/appStore';
import { useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, ListTodo, Clock, Users, FolderKanban, Settings, LogOut } from 'lucide-react';
import { TaskFlowLogo } from '@/components/brand/TaskFlowLogo';
import { useState } from 'react';
import { toast } from 'sonner';
import UserAvatar from '@/components/UserAvatar';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/tasks', label: 'My Tasks', icon: ListTodo },
  { path: '/timesheet', label: 'Timesheet', icon: Clock },
  { path: '/users', label: 'Users', icon: Users, managerOnly: true },
  { path: '/manage', label: 'Manage projects', icon: FolderKanban, managerOnly: true },
];

const AppSidebar = () => {
  const [expanded, setExpanded] = useState(false);
  const currentUser = useAppStore(s => s.currentUser);
  const logout = useAppStore(s => s.logout);
  const location = useLocation();

  if (!currentUser) return null;

  return (
    <>
      {/* Invisible hover zone near left edge */}
      <div
        className="fixed left-0 top-0 h-full w-5 z-50"
        onMouseEnter={() => setExpanded(true)}
      />

      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={`${expanded ? 'w-60' : 'w-16'} transition-[width] duration-150 ease-out border-r border-border bg-card flex flex-col h-screen sticky top-0 shrink-0 z-40 overflow-hidden`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border shrink-0">
          <TaskFlowLogo iconOnly={!expanded} className="min-w-0" />
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            if ('managerOnly' in item && item.managerOnly && currentUser.role !== 'manager') return null;
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors duration-100 ${
                  active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className={`whitespace-nowrap transition-opacity duration-100 ${expanded ? 'opacity-100' : 'opacity-0'}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-border p-3 shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/settings" className="shrink-0">
              <UserAvatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />
            </Link>

            {expanded && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-foreground">{currentUser.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{currentUser.role}</p>
              </div>
            )}

            <div className={`flex items-center gap-1 shrink-0 ${expanded ? '' : 'flex-col ml-auto'}`}>
              <Link to="/settings"
                className={`p-1.5 rounded-lg hover:bg-muted/50 transition-colors duration-100 ${
                  location.pathname === '/settings' ? 'text-primary bg-primary/10' : 'text-muted-foreground'
                }`}
                title="Settings">
                <Settings className="h-4 w-4" />
              </Link>
              <button onClick={() => { logout(); toast.info('Logged out'); }}
                className="p-1.5 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors duration-100"
                title="Logout">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AppSidebar;
