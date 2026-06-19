import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { Sun, Moon, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import GlobalSearchModal from '@/components/GlobalSearchModal';
import NotificationBell from '@/components/NotificationBell';
import MobileNav from '@/components/MobileNav';
import { TaskCreatorModal } from '@/pages/AIPage';

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/tasks': 'My Tasks',
  '/timesheet': 'Timesheet',
  '/reports': 'Time report',
  '/users': 'Users',
  '/manage': 'Manage projects',
  '/settings': 'Settings',
  '/audit': 'Audit',
  '/ai': 'Zani',
};

const AppNavbar = () => {
  const { theme, toggleTheme, currentUser, projects, selectedProjectId, selectProject } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [taskCreatorOpen, setTaskCreatorOpen] = useState(false);
  const location = useLocation();
  const hideProjectPicker = location.pathname === '/tasks';
  // "Create tasks" lives in the navbar only on Dashboard and Zani, for managers/admins.
  const showCreateTasks =
    (location.pathname === '/' || location.pathname === '/ai') &&
    (currentUser?.role === 'manager' || currentUser?.role === 'admin');

  const userProjects = projects.filter(p => currentUser?.projectIds.includes(p.id));
  const pageTitle = pageTitles[location.pathname] ?? 'ZET';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
    <>
      <GlobalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      <TaskCreatorModal open={taskCreatorOpen} onOpenChange={setTaskCreatorOpen} />

      <header className="h-16 border-b border-border/60 glass flex items-center px-2 sm:px-5 gap-1.5 sm:gap-4 sticky top-0 z-40">
        <MobileNav />

        {/* Page title — mobile only (desktop shows it in the sidebar) */}
        {hideProjectPicker && (
          <span className="md:hidden text-sm font-semibold text-foreground truncate min-w-0">{pageTitle}</span>
        )}

        <div className="hidden sm:flex items-center gap-3 min-w-0">
          <span className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 px-2.5 py-0.5 font-mono text-[10px] text-muted-foreground tracking-wide">
            {today}
          </span>
        </div>

        {!hideProjectPicker && (
          <select
            value={selectedProjectId || ''}
            onChange={e => selectProject(e.target.value)}
            className="shrink-0 rounded-xl border border-border/70 bg-card/70 px-2 sm:px-3 py-1.5 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-ring/50 min-w-0 w-[34vw] sm:w-auto sm:min-w-[140px] sm:max-w-[44vw] hover:border-ring/40 transition-colors"
          >
            {userProjects.length === 0 ? (
              <option value="">No projects</option>
            ) : (
              <>
                <option value="all">All projects</option>
                {userProjects.map(p => (
                  <option key={p.id} value={p.id}>
                    {projectPickerLabel(p)}
                  </option>
                ))}
              </>
            )}
          </select>
        )}

        <div className="flex-1" />

        {/* Create tasks (Dashboard & Zani only, managers/admins) */}
        {showCreateTasks && (
          <button
            onClick={() => setTaskCreatorOpen(true)}
            className="shrink-0 flex items-center gap-2 px-2.5 sm:px-3 py-1.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors shadow-sm"
            title="Create tasks with AI"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">Create tasks</span>
          </button>
        )}

        {/* Global search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="shrink-0 flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-1.5 rounded-xl border border-border/50 bg-card/60 hover:bg-accent/60 hover:border-ring/40 transition-all text-muted-foreground hover:text-accent-foreground group"
          title="Search (⌘K)"
        >
          <Search className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
          <span className="hidden sm:inline text-xs text-muted-foreground/70">Search…</span>
          <kbd className="hidden md:inline-flex h-4 items-center rounded border border-border/40 bg-muted/60 px-1 text-[9px] text-muted-foreground/60 font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Notifications */}
        <NotificationBell />

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="shrink-0 relative p-2 rounded-xl border border-transparent hover:border-border/60 hover:bg-accent/60 transition-colors overflow-hidden"
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

        {/* User name */}
        <span className="hidden sm:inline text-sm font-semibold text-foreground">{currentUser?.name}</span>
      </header>
    </>
  );
};

export default AppNavbar;
