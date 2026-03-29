import { useAppStore } from '@/stores/appStore';
import { useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, ListTodo, Clock, Users, UserCog, Settings, LogOut } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import SettingsModal from '@/components/SettingsModal';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/tasks', label: 'My Tasks', icon: ListTodo },
  { path: '/timesheet', label: 'Timesheet', icon: Clock },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/manage', label: 'Manage', icon: UserCog, managerOnly: true },
];

const AppSidebar = () => {
  const [expanded, setExpanded] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentUser = useAppStore(s => s.currentUser);
  const logout = useAppStore(s => s.logout);
  const location = useLocation();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const hoverZoneRef = useRef<HTMLDivElement>(null);

  if (!currentUser) return null;

  return (
    <>
      {/* Invisible hover zone to detect mouse near left edge */}
      <div
        ref={hoverZoneRef}
        className="fixed left-0 top-0 h-full w-5 z-50"
        onMouseEnter={() => setExpanded(true)}
      />

      <aside
        ref={sidebarRef}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={`${expanded ? 'w-60' : 'w-16'} transition-all duration-300 ease-in-out border-r border-border bg-card flex flex-col h-screen sticky top-0 shrink-0 z-40 overflow-hidden`}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b border-border">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary">T</span>
          </div>
          <span className={`font-bold text-lg tracking-tight text-foreground whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>TaskFlow</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {navItems.map(item => {
            if (item.managerOnly && currentUser.role !== 'manager') return null;
            const active = location.pathname === item.path;
            return (
              <Link key={item.path} to={item.path}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'}`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className={`whitespace-nowrap transition-opacity duration-200 ${expanded ? 'opacity-100' : 'opacity-0'}`}>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-border p-3 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-semibold text-primary">{currentUser.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
          </div>
          {expanded && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate text-foreground">{currentUser.name}</p>
              <p className="text-xs text-muted-foreground capitalize">{currentUser.role}</p>
            </div>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors shrink-0">
                <Settings className="h-4 w-4 text-muted-foreground" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" side="top" align="end">
              <button onClick={() => setSettingsOpen(true)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted/50 transition-colors text-foreground"
              >
                <Settings className="h-3.5 w-3.5" /> Settings
              </button>
              <button onClick={() => { logout(); toast.info('Logged out'); }}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-destructive/10 text-destructive transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" /> Logout
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </aside>
      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
};

export default AppSidebar;
