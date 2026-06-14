import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { useLocation, Link } from 'react-router-dom';
import { Menu, Settings, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { ZetLogo } from '@/components/brand/ZetLogo';
import UserAvatar from '@/components/UserAvatar';
import { navItems } from '@/components/nav-items';

/** Hamburger + slide-in nav drawer. Rendered in the navbar, visible only under md. */
const MobileNav = () => {
  const [open, setOpen] = useState(false);
  const currentUser = useAppStore(s => s.currentUser);
  const logout = useAppStore(s => s.logout);
  const location = useLocation();

  if (!currentUser) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className="md:hidden p-2 -ml-1 rounded-lg text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
      </SheetTrigger>

      <SheetContent side="left" className="w-[min(80vw,18rem)] p-0 flex flex-col glass">
        <div className="flex items-center gap-2 px-4 h-16 border-b border-sidebar-border/70 shrink-0">
          <ZetLogo />
        </div>

        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
            Workspace
          </p>
          {navItems.map(item => {
            if (item.managerOnly && currentUser.role !== 'manager') return null;
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                  active
                    ? 'bg-brand-gradient glow-brand text-sidebar-primary-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                }`}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">{item.labelNode ?? item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border/70 p-3 shrink-0">
          <div className="flex items-center gap-2">
            <Link to="/settings" onClick={() => setOpen(false)} className="shrink-0">
              <UserAvatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />
            </Link>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate text-foreground">{currentUser.name}</p>
              <p className="text-[11px] text-muted-foreground capitalize tracking-wide">{currentUser.role}</p>
            </div>
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="p-2 rounded-lg hover:bg-sidebar-accent/60 text-muted-foreground transition-colors"
              title="Settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
            <button
              onClick={() => {
                setOpen(false);
                logout();
                toast.info('Logged out');
              }}
              className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              title="Logout"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default MobileNav;
