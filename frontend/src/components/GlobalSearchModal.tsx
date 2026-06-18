import { useAppStore } from '@/stores/appStore';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import {
  Search, ListTodo, FolderOpen, Users, X, ChevronRight, Clock,
  AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { isTaskAssignedTo } from '@/lib/task-utils';
import UserAvatar from '@/components/UserAvatar';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: 'text-red-400',
  High: 'text-orange-400',
  Medium: 'text-yellow-400',
  Low: 'text-green-400',
};

const STATUS_ICONS: Record<string, React.ElementType> = {
  completed: CheckCircle2,
  done: CheckCircle2,
  in_progress: Clock,
  in_review: AlertTriangle,
};

export default function GlobalSearchModal({ open, onOpenChange }: Props) {
  const { tasks, projects, users, currentUser } = useAppStore();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'admin';

  // Reset query on open
  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard shortcut: Cmd/Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenChange(true);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onOpenChange]);

  const q = query.toLowerCase().trim();

  const results = useMemo(() => {
    if (!q || !currentUser) return null;

    // ── Tasks (access-aware) ────────────────────────────────────────────────
    const accessibleTasks = isManager
      ? tasks
      : tasks.filter(t =>
          t.createdBy === currentUser.id ||
          isTaskAssignedTo(t, currentUser.id),
        );

    const matchedTasks = accessibleTasks
      .filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
      )
      .slice(0, 6);

    // ── Projects (only ones the user is a member of) ────────────────────────
    const accessibleProjects = isManager
      ? projects
      : projects.filter(p => currentUser.projectIds.includes(p.id));

    const matchedProjects = accessibleProjects
      .filter(p => p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q))
      .slice(0, 4);

    // ── People (managers only) ──────────────────────────────────────────────
    const matchedPeople = isManager
      ? users
          .filter(u =>
            u.name.toLowerCase().includes(q) ||
            u.email.toLowerCase().includes(q),
          )
          .slice(0, 4)
      : [];

    return { tasks: matchedTasks, projects: matchedProjects, people: matchedPeople };
  }, [q, tasks, projects, users, currentUser, isManager]);

  const hasResults = results &&
    (results.tasks.length > 0 || results.projects.length > 0 || results.people.length > 0);

  function close() {
    onOpenChange(false);
  }

  function goTask(taskId: string) {
    close();
    navigate('/tasks');
    // Brief delay so the page mounts before we try to open the modal
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('zet:open-task', { detail: { taskId } }));
    }, 100);
  }

  function goProject(projectId: string) {
    close();
    useAppStore.getState().selectProject(projectId);
    navigate('/');
  }

  function goUser(userId: string) {
    close();
    navigate(`/users/${userId}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-0 gap-0 overflow-hidden rounded-2xl border border-border/50 shadow-2xl">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border/30">
          <Search className="h-4 w-4 text-muted-foreground/60 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tasks, projects, people…"
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground/40"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-muted-foreground/40 hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border/40 bg-muted/50 px-1.5 text-[10px] text-muted-foreground/50 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[420px] overflow-y-auto">
          {!q && (
            <div className="py-12 text-center text-sm text-muted-foreground/40">
              <Search className="h-8 w-8 mx-auto mb-3 opacity-20" />
              Type to search across tasks, projects{isManager ? ', and people' : ''}
              <p className="text-xs mt-2 opacity-60">
                <kbd className="font-mono">⌘K</kbd> / <kbd className="font-mono">Ctrl+K</kbd> to open anytime
              </p>
            </div>
          )}

          {q && !hasResults && (
            <div className="py-12 text-center text-sm text-muted-foreground/40">
              No results for <span className="font-medium text-foreground/60">"{query}"</span>
            </div>
          )}

          {hasResults && (
            <div className="p-2 space-y-1">

              {/* ── Tasks ── */}
              {results!.tasks.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                    <ListTodo className="h-3 w-3" />
                    Tasks
                  </div>
                  {results!.tasks.map(t => {
                    const project = projects.find(p => p.id === t.projectId);
                    const StatusIcon = STATUS_ICONS[t.status] ?? ListTodo;
                    return (
                      <button
                        key={t.id}
                        onClick={() => goTask(t.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left group"
                      >
                        <StatusIcon className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{t.title}</p>
                          {project && (
                            <p className="text-xs text-muted-foreground/50 truncate">{project.name}</p>
                          )}
                        </div>
                        <span className={`text-[11px] font-semibold shrink-0 ${PRIORITY_COLORS[t.priority] ?? ''}`}>
                          {t.priority}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                      </button>
                    );
                  })}
                </section>
              )}

              {/* ── Projects ── */}
              {results!.projects.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                    <FolderOpen className="h-3 w-3" />
                    Projects
                  </div>
                  {results!.projects.map(p => (
                    <button
                      key={p.id}
                      onClick={() => goProject(p.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left group"
                    >
                      <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <FolderOpen className="h-3.5 w-3.5 text-primary/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{p.name}</p>
                        <p className="text-xs text-muted-foreground/50">{p.members.length} member{p.members.length !== 1 ? 's' : ''} · {p.sections.length} section{p.sections.length !== 1 ? 's' : ''}</p>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </section>
              )}

              {/* ── People (manager only) ── */}
              {isManager && results!.people.length > 0 && (
                <section>
                  <div className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">
                    <Users className="h-3 w-3" />
                    People
                  </div>
                  {results!.people.map(u => (
                    <button
                      key={u.id}
                      onClick={() => goUser(u.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-muted/50 transition-colors text-left group"
                    >
                      <UserAvatar name={u.name} avatar={u.avatar} size="sm" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">{u.name}</p>
                        <p className="text-xs text-muted-foreground/50 truncate">{u.email}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${
                        u.role !== 'employee'
                          ? 'bg-primary/10 text-primary border-primary/20'
                          : 'bg-muted/60 text-muted-foreground border-border/40'
                      }`}>
                        {u.role === 'admin' ? 'Admin' : u.role === 'manager' ? 'Manager' : 'Employee'}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/20 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  ))}
                </section>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        {hasResults && (
          <div className="border-t border-border/20 px-4 py-2 flex items-center gap-4 text-[10px] text-muted-foreground/35">
            <span><kbd className="font-mono">↵</kbd> to select</span>
            <span><kbd className="font-mono">ESC</kbd> to close</span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
