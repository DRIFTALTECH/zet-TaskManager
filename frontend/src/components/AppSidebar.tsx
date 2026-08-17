import { useAppStore } from '@/stores/appStore';
import { useLocation, Link } from 'react-router-dom';
import { Settings, LogOut } from 'lucide-react';
import { ZetLogo } from '@/components/brand/ZetLogo';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import UserAvatar from '@/components/UserAvatar';
import { isNavItemActive, visibleNavItems } from '@/components/nav-items';

const AppSidebar = () => {
  const [expanded, setExpanded] = useState(false);
  const currentUser = useAppStore(s => s.currentUser);
  const logout = useAppStore(s => s.logout);
  const location = useLocation();

  if (!currentUser) return null;

  return (
    <>
      {/* Invisible hover zone near left edge (desktop only) */}
      <div
        className="hidden md:block fixed left-0 top-0 h-full w-5 z-50"
        onMouseEnter={() => setExpanded(true)}
      />

      <aside
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
        className={`${expanded ? 'w-60' : 'w-16'} transition-[width] duration-200 ease-out glass border-r border-sidebar-border hidden md:flex flex-col h-screen sticky top-0 shrink-0 z-40 overflow-hidden`}
      >
        {/* Logo */}
        <div className={`flex items-center h-16 border-b border-sidebar-border/70 shrink-0 ${
          expanded ? 'gap-2 px-4' : 'justify-center px-0'
        }`}>
          <ZetLogo iconOnly={!expanded} className="min-w-0" />
        </div>

        {/* Nav */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto overflow-x-hidden">
          {expanded && (
            <p className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground/60">
              Workspace
            </p>
          )}
          {visibleNavItems(currentUser.role).map(item => {
            const active = isNavItemActive(item, location.pathname);
            return (
              <Link key={item.path} to={item.path}
                title={expanded ? undefined : item.label}
                className={`relative flex items-center rounded-xl text-sm font-medium transition-colors duration-150 ${
                  expanded ? 'gap-3 px-3 py-2.5' : 'mx-auto h-10 w-10 justify-center'
                } ${
                  active ? 'text-sidebar-primary-foreground' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active-pill"
                    transition={{ type: 'spring', stiffness: 480, damping: 38 }}
                    className="absolute inset-0 rounded-xl bg-brand-gradient glow-brand"
                    aria-hidden
                  />
                )}
                <item.icon className="relative z-10 h-[18px] w-[18px] shrink-0" />
                {expanded && (
                  <span className="relative z-10 whitespace-nowrap">
                    {item.labelNode ?? item.label}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border/70 p-3 shrink-0">
          <div className={`flex gap-2 ${expanded ? 'items-center' : 'flex-col items-center'}`}>
            <Link to="/settings" className="shrink-0 rounded-full ring-2 ring-transparent hover:ring-ring/50 transition-shadow">
              <UserAvatar name={currentUser.name} avatar={currentUser.avatar} size="sm" />
            </Link>

            {expanded && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{currentUser.name}</p>
                <p className="text-[11px] text-muted-foreground capitalize tracking-wide">{currentUser.role}</p>
              </div>
            )}

            <div className={`flex gap-1 shrink-0 ${expanded ? 'items-center' : 'flex-col items-center'}`}>
              <Link to="/settings"
                className={`p-1.5 rounded-lg hover:bg-sidebar-accent/60 transition-colors duration-100 ${
                  location.pathname === '/settings' ? 'text-primary bg-sidebar-accent' : 'text-muted-foreground'
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
