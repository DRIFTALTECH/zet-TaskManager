/**
 * ManageProjectsOverview — full-screen grid of project cards (manager panel).
 * Each card summarises a project's health (members, sections, tasks, time,
 * completion). Clicking a card opens the dedicated /manage/:projectId dashboard.
 */
import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, FolderOpen, Users, LayoutGrid, ListTodo, Sparkles, Clock,
  ArrowUpRight, Search, X,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import { computeProjectStats, formatHM } from '@/lib/manage-utils';

const ManageProjectsOverview = () => {
  const { projects, tasks, createProject } = useAppStore();
  const navigate = useNavigate();

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

  const totalMembers = useMemo(() => new Set(projects.flatMap(p => p.members)).size, [projects]);
  const totalTime = useMemo(() => tasks.reduce((s, t) => s + (t.timeTracked || 0), 0), [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [projects, search]);

  const handleCreate = async () => {
    if (!projName.trim()) return toast.error('Enter project name');
    setCreating(true);
    try {
      await createProject(projName.trim(), projDesc.trim());
      toast.success('Project created!');
      setCreateOpen(false); setProjName(''); setProjDesc('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create project');
    } finally { setCreating(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="min-h-full"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="px-4 sm:px-8 pt-6 sm:pt-7 pb-6 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Manager Panel</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Projects
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">A health snapshot of every project — open one to dive in.</p>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2">
              <StatPill icon={<FolderOpen className="h-3.5 w-3.5" />} value={projects.length} label="projects" />
              <StatPill icon={<Users className="h-3.5 w-3.5" />} value={totalMembers} label="members" />
              <StatPill icon={<ListTodo className="h-3.5 w-3.5" />} value={tasks.length} label="tasks" />
              <StatPill icon={<Clock className="h-3.5 w-3.5" />} value={formatHM(totalTime)} label="logged" />
            </div>
            <motion.button
              transition={snappy}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold shadow-sm"
            >
              <Plus className="h-4 w-4" /> New Project
            </motion.button>
          </div>
        </div>

        {/* Search */}
        {projects.length > 0 && (
          <div className="mt-5 flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3.5 py-2 max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground/50 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40"
            />
            {search && (
              <button onClick={() => setSearch('')} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Card grid ───────────────────────────────────────────────────── */}
      <div className="p-4 sm:p-8">
        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-3xl bg-muted/40 flex items-center justify-center mb-5 border border-border/30">
              <LayoutGrid className="h-9 w-9 text-muted-foreground/25" />
            </div>
            <h2 className="text-xl font-bold text-foreground/70 mb-2">No projects yet</h2>
            <p className="text-sm text-muted-foreground/50 max-w-xs leading-relaxed mb-5">
              Create your first project to start organizing teams, sections and tasks.
            </p>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold"
            >
              <Plus className="h-4 w-4" /> New Project
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-20 text-sm text-muted-foreground/50 italic">
            No projects match “{search}”.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {filtered.map((project, i) => {
              const s = computeProjectStats(project, tasks);
              return (
                <motion.div
                  key={project.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...snappy, delay: Math.min(i * 0.03, 0.25) }}
                  whileHover={{ scale: 1.005, x: 2, boxShadow: '0 4px 20px -4px hsl(var(--foreground) / 0.08)' }}
                  whileTap={{ scale: 0.995 }}
                  onClick={() => navigate(`/manage/${project.id}`)}
                  className="group text-left rounded-2xl border-2 border-border/70 bg-gradient-to-br from-muted/70 via-card to-muted/40 dark:from-muted/50 dark:via-card dark:to-muted/30 p-6 min-h-[250px] flex flex-col cursor-pointer shadow-md transition-[transform,box-shadow] duration-200 ease-out"
                >
                  {/* Top — icon + arrow */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center shrink-0">
                      <FolderOpen className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <ArrowUpRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-bold leading-snug text-foreground line-clamp-2 shrink-0">
                    {projectPickerLabel(project)}
                  </h3>

                  <div className="flex-1 min-h-0" aria-hidden />

                  {/* Bottom — members · sections · description */}
                  <div className="pt-2 mt-auto space-y-2 shrink-0">
                    <div className="flex items-center gap-5 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <Users className="h-4 w-4" />
                        {s.memberCount} {s.memberCount === 1 ? 'member' : 'members'}
                      </span>
                      <span className="flex items-center gap-1.5">
                        <LayoutGrid className="h-4 w-4" />
                        {s.sectionCount} {s.sectionCount === 1 ? 'section' : 'sections'}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground/80 line-clamp-2">
                      {project.description || 'No description'}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Create Project Modal ────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={o => { setCreateOpen(o); if (!o) { setProjName(''); setProjDesc(''); } }}>
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Create Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <input
              autoFocus
              value={projName}
              onChange={e => setProjName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleCreate()}
              className={inputCls}
              placeholder="Project name"
            />
            <textarea
              value={projDesc}
              onChange={e => setProjDesc(e.target.value)}
              className={`${inputCls} min-h-[72px] resize-none`}
              placeholder="Description (optional)"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={!projName.trim() || creating}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all shadow-sm hover:shadow-md"
            >
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

function StatPill({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-muted/50 border border-border/40 text-muted-foreground">
      {icon}
      <span className="font-semibold text-foreground">{value}</span> {label}
    </div>
  );
}

export default ManageProjectsOverview;
