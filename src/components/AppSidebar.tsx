import { useAppStore } from '@/stores/appStore';
import { useLocation, Link } from 'react-router-dom';
import { LayoutDashboard, ListTodo, Clock, Users, UserCog, ChevronLeft, ChevronRight, Settings, LogOut } from 'lucide-react';
import { useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from 'sonner';
import SettingsModal from '@/components/SettingsModal';

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/tasks', label: 'My Tasks', icon: ListTodo },
  { path: '/timesheet', label: 'Timesheet', icon: Clock },
  { path: '/users', label: 'Users', icon: Users },
  { path: '/manage', label: 'Manage Employees', icon: UserCog, managerOnly: true },
];

const AppSidebar = () => {
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const currentUser = useAppStore(s => s.currentUser);
  const logout = useAppStore(s => s.logout);
  const location = useLocation();

  if (!currentUser) return null;

  return (
    <>
      <aside className={`${collapsed ? 'w-16' : 'w-60'} transition-all duration-300 border-r bg-card flex flex-col h-screen sticky top-0 shrink-0`}>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary">T</span>
          </div>
          {!collapsed && <span className="font-bold text-lg tracking-tight">TaskFlow</span>}
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
                {!collapsed && <span>{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* Collapse toggle */}
        <button onClick={() => setCollapsed(!collapsed)}
          className="mx-2 mb-2 p-2 rounded-xl hover:bg-muted/50 transition-colors flex items-center justify-center"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* User section */}
        <div className="border-t p-3 flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-lg shrink-0">
            {currentUser.avatar}
          </div>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentUser.name}</p>
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
                className="flex items-center gap-2 w-full px-3 py-2 text-sm rounded-lg hover:bg-muted/50 transition-colors"
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
