import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { Sun, Moon, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import GlobalSearchModal from '@/components/GlobalSearchModal';
import NotificationBell from '@/components/NotificationBell';
import MobileNav from '@/components/MobileNav';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/tasks': 'My Tasks',
  '/timesheet': 'Timesheet',
  '/calendar': 'Calendar',
  '/reports': 'Time report',
  '/users': 'Users',
  '/manage': 'Manage projects',
  '/settings': 'Settings',
  '/audit': 'Audit',
  '/overview': 'Overview',
  '/ai': 'Zani',
};

const HIDE_PROJECT_PICKER_PATHS = new Set(['/tasks', '/overview', '/timesheet', '/calendar']);

const AppNavbar = () => {
  const { theme, toggleTheme, currentUser, projects, selectedProjectId, selectProject } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const hideProjectPicker = HIDE_PROJECT_PICKER_PATHS.has(location.pathname);

  const userProjects = projects.filter(p => currentUser?.projectIds.includes(p.id));
  const pageTitle = pageTitles[location.pathname] ?? 'ZET';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <>
      <GlobalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />

      <header className="h-16 border-b border-border/60 glass flex items-center px-2 sm:px-5 gap-2 sticky top-0 z-40">
        <MobileNav />

        {/* Page title — mobile only (desktop shows it in the sidebar) */}
        {hideProjectPicker && (
          <span className="md:hidden text-sm font-semibold text-foreground truncate min-w-0">{pageTitle}</span>
        )}

        <span className="hidden sm:inline-flex h-9 items-center rounded-xl border border-border/70 bg-card/70 px-3 text-sm font-medium tabular-nums text-muted-foreground shrink-0">
          {today}
        </span>

        {!hideProjectPicker && (
          <Select
            value={userProjects.length === 0 ? 'none' : (selectedProjectId || 'all')}
            onValueChange={v => { if (v !== 'none') selectProject(v); }}
            disabled={userProjects.length === 0}
          >
            <SelectTrigger className="h-9 w-[min(44vw,16rem)] sm:w-56 shrink-0 rounded-xl border-border/70 bg-card/70 px-3 text-sm font-medium shadow-none focus:ring-2 focus:ring-ring/40 focus:ring-offset-0">
              <SelectValue placeholder={userProjects.length === 0 ? 'No projects' : 'Project'} />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/70 shadow-lg p-1 min-w-[14rem] max-h-72">
              {userProjects.length === 0 ? (
                <SelectItem value="none" className="rounded-lg py-2">No projects</SelectItem>
              ) : (
                <>
                  <SelectItem value="all" className="rounded-lg py-2 font-medium">All projects</SelectItem>
                  {userProjects.map(p => (
                    <SelectItem key={p.id} value={p.id} className="rounded-lg py-2">
                      {projectPickerLabel(p)}
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
        )}

        <div className="flex-1" />

        <button
          onClick={() => setSearchOpen(true)}
          className="h-9 shrink-0 flex items-center gap-2 px-3 rounded-xl border border-border/70 bg-card/70 hover:bg-accent/60 hover:border-ring/40 transition-colors text-muted-foreground hover:text-accent-foreground group w-[min(42vw,11rem)] sm:w-64"
          title="Search (⌘K)"
        >
          <Search className="h-4 w-4 shrink-0 group-hover:text-primary transition-colors" />
          <span className="hidden sm:inline text-sm text-muted-foreground/70 flex-1 text-left">Search…</span>
          <kbd className="hidden md:inline-flex h-5 items-center rounded-md border border-border/50 bg-muted/60 px-1.5 text-[10px] text-muted-foreground/70 font-mono">
            ⌘K
          </kbd>
        </button>

        <NotificationBell />

        <button
          onClick={toggleTheme}
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-xl border border-border/70 bg-card/70 hover:bg-accent/60 hover:border-ring/40 transition-colors overflow-hidden"
          title="Toggle theme"
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={theme}
              initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
              animate={{ rotate: 0, opacity: 1, scale: 1 }}
              exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="block"
            >
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </motion.span>
          </AnimatePresence>
        </button>

        <span className="hidden sm:inline-flex h-9 items-center text-sm font-semibold text-foreground shrink-0">
          {currentUser?.name}
        </span>
      </header>
    </>
  );
};

export default AppNavbar;
