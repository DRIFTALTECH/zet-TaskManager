import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { Mail, Briefcase, ListTodo, Users, Search, X, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { snappy, pageEnter } from '@/lib/motion';
import { isTaskAssignedTo } from '@/lib/task-utils';

// ── Avatar helpers ────────────────────────────────────────────────────────────
const AVATAR_PALETTES = [
  { bg: 'bg-blue-500/20', text: 'text-blue-400', ring: 'ring-blue-500/25', glow: 'shadow-blue-500/20' },
  { bg: 'bg-violet-500/20', text: 'text-violet-400', ring: 'ring-violet-500/25', glow: 'shadow-violet-500/20' },
  { bg: 'bg-emerald-500/20', text: 'text-emerald-400', ring: 'ring-emerald-500/25', glow: 'shadow-emerald-500/20' },
  { bg: 'bg-orange-500/20', text: 'text-orange-400', ring: 'ring-orange-500/25', glow: 'shadow-orange-500/20' },
  { bg: 'bg-pink-500/20', text: 'text-pink-400', ring: 'ring-pink-500/25', glow: 'shadow-pink-500/20' },
  { bg: 'bg-teal-500/20', text: 'text-teal-400', ring: 'ring-teal-500/25', glow: 'shadow-teal-500/20' },
  { bg: 'bg-amber-500/20', text: 'text-amber-400', ring: 'ring-amber-500/25', glow: 'shadow-amber-500/20' },
  { bg: 'bg-cyan-500/20', text: 'text-cyan-400', ring: 'ring-cyan-500/25', glow: 'shadow-cyan-500/20' },
];

function avatarPalette(name: string) {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return AVATAR_PALETTES[h % AVATAR_PALETTES.length];
}
function getInitials(name: string) { return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2); }

const UsersPage = () => {
  const { users, tasks, projects } = useAppStore();
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredUsers = users
    .filter(u => {
      if (selectedProjectId) {
        const project = projects.find(p => p.id === selectedProjectId);
        if (!project?.members.includes(u.id)) return false;
      }
      if (searchTerm.trim()) {
        return u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          u.email.toLowerCase().includes(searchTerm.toLowerCase());
      }
      return true;
    });

  const managers = filteredUsers.filter(u => u.role === 'manager').length;
  const employees = filteredUsers.filter(u => u.role === 'employee').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0"
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-8 pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-bold text-muted-foreground/50 uppercase tracking-widest">Team</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Team Members
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">
              {filteredUsers.length} {filteredUsers.length === 1 ? 'person' : 'people'}
              {selectedProjectId ? ` in ${projects.find(p => p.id === selectedProjectId)?.name ?? ''}` : ' across all projects'}
            </p>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {managers > 0 && (
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary font-semibold">
                {managers} Manager{managers !== 1 ? 's' : ''}
              </div>
            )}
            {employees > 0 && (
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-muted/60 border border-border/40 text-muted-foreground font-medium">
                {employees} Employee{employees !== 1 ? 's' : ''}
              </div>
            )}
          </div>
        </div>

        {/* Filters bar */}
        <div className="flex flex-wrap items-center gap-3 mt-5">
          {/* Search */}
          <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3.5 py-2 flex-1 min-w-[180px] max-w-xs">
            <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
            <input
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Search by name or email…"
              className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40"
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} className="text-muted-foreground/50 hover:text-foreground transition-colors shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Project filter */}
          <div className="relative">
            <select
              value={selectedProjectId}
              onChange={e => setSelectedProjectId(e.target.value)}
              className="appearance-none pl-4 pr-9 py-2 rounded-xl border border-border/40 bg-muted/40 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all text-foreground/80 cursor-pointer hover:bg-muted/60"
            >
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <ChevronRight className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50 rotate-90 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* ── Users grid ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-8">
        {filteredUsers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[300px] text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted/40 flex items-center justify-center mb-4 border border-border/30">
              <Users className="h-7 w-7 text-muted-foreground/25" />
            </div>
            <h3 className="text-lg font-semibold text-foreground/60 mb-1">No members found</h3>
            <p className="text-sm text-muted-foreground/50">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredUsers.map((user, i) => {
              const palette = avatarPalette(user.name);
              const activeTasks = tasks.filter(t => isTaskAssignedTo(t, user.id) && t.status !== 'completed').length;
              const userProjects = projects.filter(p => p.members.includes(user.id));
              const isManager = user.role === 'manager';

              return (
                <motion.div
                  key={user.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/users/${user.id}`)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/users/${user.id}`); } }}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'tween', duration: 0.15, ease: 'easeOut', delay: i * 0.03 }}
                  whileHover={{ y: -3, transition: snappy }}
                  whileTap={{ scale: 0.98, transition: snappy }}
                  className="group rounded-2xl border border-border/30 bg-card hover:border-border/60 hover:shadow-lg transition-all duration-200 cursor-pointer text-left overflow-hidden"
                >
                  {/* Top accent strip based on role */}
                  <div className={`h-[3px] w-full ${isManager ? 'bg-primary' : 'bg-border/40'}`} />

                  <div className="p-5">
                    {/* Avatar + name */}
                    <div className="flex items-center gap-4 mb-4">
                      <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-bold text-base shrink-0 ring-2 transition-all duration-200 group-hover:shadow-lg ${palette.bg} ${palette.text} ${palette.ring} group-hover:${palette.glow}`}>
                        {getInitials(user.name)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-bold text-foreground group-hover:text-primary transition-colors truncate">{user.name}</h3>
                        </div>
                        <span className={`inline-block text-[10px] px-2.5 py-0.5 rounded-full font-bold border ${
                          isManager
                            ? 'bg-primary/10 text-primary border-primary/20'
                            : 'bg-muted/60 text-muted-foreground border-border/40'
                        }`}>
                          {isManager ? 'Manager' : 'Employee'}
                        </span>
                      </div>
                    </div>

                    {/* Info rows */}
                    <div className="space-y-2.5 text-sm">
                      <div className="flex items-center gap-2.5 text-muted-foreground/70 group-hover:text-muted-foreground transition-colors">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate text-xs">{user.email}</span>
                      </div>

                      <div className="flex items-center gap-2.5">
                        <ListTodo className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
                        <span className={`text-xs font-semibold ${
                          activeTasks > 0 ? 'text-primary' : 'text-muted-foreground/50'
                        }`}>
                          {activeTasks} active task{activeTasks !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="flex items-start gap-2.5">
                        <Briefcase className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 mt-0.5" />
                        {userProjects.length === 0 ? (
                          <span className="text-xs text-muted-foreground/40 italic">No projects</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 min-w-0">
                            {userProjects.slice(0, 3).map(p => (
                              <span key={p.id} className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground/70 font-medium">
                                {p.name}
                              </span>
                            ))}
                            {userProjects.length > 3 && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted/50 border border-border/40 text-muted-foreground/50">
                                +{userProjects.length - 3}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* View profile hint */}
                    <div className="mt-4 pt-3.5 border-t border-border/25 flex items-center justify-between">
                      <span className="text-[11px] text-muted-foreground/40">View profile</span>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/25 group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-150" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default UsersPage;
