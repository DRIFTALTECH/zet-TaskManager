import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { Sun, Moon, Search } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import GlobalSearchModal from '@/components/GlobalSearchModal';

const AppNavbar = () => {
  const { theme, toggleTheme, currentUser, projects, selectedProjectId, selectProject } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const hideProjectPicker = location.pathname === '/tasks';

  const userProjects = projects.filter(p => currentUser?.projectIds.includes(p.id));

  return (
    <>
      <GlobalSearchModal open={searchOpen} onOpenChange={setSearchOpen} />

      <header className="h-14 border-b bg-card/80 backdrop-blur-sm flex items-center px-4 gap-4 sticky top-0 z-40">
        {!hideProjectPicker && (
          <select
            value={selectedProjectId || ''}
            onChange={e => selectProject(e.target.value)}
            className="rounded-xl border bg-muted/50 px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[140px]"
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

        {/* Global search trigger */}
        <button
          onClick={() => setSearchOpen(true)}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl border border-border/40 bg-muted/40 hover:bg-muted/70 hover:border-border/70 transition-all text-muted-foreground/60 hover:text-foreground group"
          title="Search (⌘K)"
        >
          <Search className="h-3.5 w-3.5 group-hover:text-primary transition-colors" />
          <span className="hidden sm:inline text-xs text-muted-foreground/50">Search…</span>
          <kbd className="hidden md:inline-flex h-4 items-center rounded border border-border/30 bg-muted/50 px-1 text-[9px] text-muted-foreground/40 font-mono">
            ⌘K
          </kbd>
        </button>

        {/* Theme toggle */}
        <button onClick={toggleTheme} className="p-2 rounded-xl hover:bg-muted/50 transition-colors">
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        {/* User name */}
        <span className="text-sm font-medium text-foreground">{currentUser?.name}</span>
      </header>
    </>
  );
};

export default AppNavbar;
