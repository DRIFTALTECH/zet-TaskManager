import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { Sun, Moon, Search, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const AppNavbar = () => {
  const { theme, toggleTheme, currentUser, projects, selectedProjectId, selectProject, tasks, users, searchQuery, setSearchQuery } = useAppStore();
  const isManager = currentUser?.role === 'manager';
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const hideProjectPicker = location.pathname === '/tasks';

  const userProjects = projects.filter(p => currentUser?.projectIds.includes(p.id));

  // Search results
  const q = searchQuery.toLowerCase();
  const searchResults = q.length > 1 ? {
    tasks: tasks.filter(t => t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)).slice(0, 5),
    projects: projects.filter(p => p.name.toLowerCase().includes(q)).slice(0, 3),
    people: isManager ? users.filter(u => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 3) : [],
  } : null;

  const hasResults = searchResults && (searchResults.tasks.length || searchResults.projects.length || searchResults.people.length > 0);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setSearchOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
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
              <option value="all">All Projects</option>
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

      {/* Search */}
      <div ref={searchRef} className="relative">
        <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-1.5 min-w-[240px]">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            placeholder={isManager ? 'Search tasks, projects, people...' : 'Search tasks, projects...'}
            className="bg-transparent text-sm focus:outline-none flex-1"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
          )}
        </div>
        {searchOpen && hasResults && (
          <div className="absolute top-full mt-1 w-80 right-0 rounded-xl border bg-card shadow-xl p-2 z-50 max-h-80 overflow-y-auto">
            {searchResults!.tasks.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-muted-foreground px-2 py-1">Tasks</p>
                {searchResults!.tasks.map(t => (
                  <button key={t.id} onClick={() => { setSearchOpen(false); setSearchQuery(''); navigate('/tasks'); }}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted/50 text-sm truncate"
                  >{t.title}</button>
                ))}
              </div>
            )}
            {searchResults!.projects.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-muted-foreground px-2 py-1">Projects</p>
                {searchResults!.projects.map(p => (
                  <button key={p.id} onClick={() => { selectProject(p.id); setSearchOpen(false); setSearchQuery(''); }}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted/50 text-sm"
                  >{p.name}</button>
                ))}
              </div>
            )}
            {isManager && searchResults!.people.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground px-2 py-1">People</p>
                {searchResults!.people.map(u => (
                  <button
                    key={u.id}
                    onClick={() => {
                      setSearchOpen(false);
                      setSearchQuery('');
                      navigate(`/users/${u.id}`);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted/50 text-sm"
                  >
                    {u.avatar} {u.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Theme toggle */}
      <button onClick={toggleTheme} className="p-2 rounded-xl hover:bg-muted/50 transition-colors">
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      {/* User name */}
      <span className="text-sm font-medium text-foreground">{currentUser?.name}</span>
    </header>
  );
};

export default AppNavbar;
