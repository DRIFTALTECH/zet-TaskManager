/**
 * ManageProjectsOverview — full-screen grid of project cards (manager panel).
 * Each card summarises a project's health (members, sections, tasks, time,
 * completion). Clicking a card opens the dedicated /manage/:projectId dashboard.
 */
import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { motion } from 'framer-motion';
import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Plus, FolderOpen, Users, LayoutGrid, ListTodo, Sparkles, Clock,
  ArrowUpRight, Search, X, BarChart3,
} from 'lucide-react';
import { snappy, pageEnter } from '@/lib/motion';
import { computeProjectStats, formatHM, projectAccent } from '@/lib/manage-utils';
import { resolveMediaUrl } from '@/lib/env';
import { ANALYTICS_LABELS } from '@/lib/analyticsLabels';
import DeliveryPage from '@/pages/DeliveryPage';
import CreateProjectDialog from '@/components/CreateProjectDialog';
import PageHeader from '@/components/PageHeader';
import { PAGE_CHIP, PAGE_SHELL_SCROLL, SEGMENT_BAR, SEGMENT_BTN, SEGMENT_ICON } from '@/lib/page-styles';
import { Button } from '@/components/ui/button';

const ManageProjectsOverview = () => {
  const { projects, tasks } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const statusView = location.pathname === '/manage/status';

  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const totalMembers = useMemo(() => new Set(projects.flatMap(p => p.members)).size, [projects]);
  const totalTime = useMemo(() => tasks.reduce((s, t) => s + (t.timeTracked || 0), 0), [tasks]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(p =>
      p.name.toLowerCase().includes(q) || (p.description || '').toLowerCase().includes(q));
  }, [projects, search]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className={PAGE_SHELL_SCROLL}
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Sparkles}
        eyebrow="Manager Panel"
        title="Projects"
        actions={
          <>
            {!statusView && (
              <div className="hidden md:flex items-center gap-2">
                <StatPill icon={<FolderOpen className={SEGMENT_ICON} />} value={projects.length} label="projects" />
                <StatPill icon={<Users className={SEGMENT_ICON} />} value={totalMembers} label="members" />
                <StatPill icon={<ListTodo className={SEGMENT_ICON} />} value={tasks.length} label="tasks" />
                <StatPill icon={<Clock className={SEGMENT_ICON} />} value={formatHM(totalTime)} label="logged" />
              </div>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className={SEGMENT_ICON} /> New Project
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <div className={SEGMENT_BAR}>
            <button type="button" onClick={() => navigate('/manage')} className={SEGMENT_BTN(!statusView)}>
              <LayoutGrid className={SEGMENT_ICON} />
              All Projects
            </button>
            <button type="button" onClick={() => navigate('/manage/status')} className={SEGMENT_BTN(statusView)}>
              <BarChart3 className={SEGMENT_ICON} />
              {ANALYTICS_LABELS.projectStatus}
            </button>
          </div>

          {!statusView && projects.length > 0 && (
            <div className="flex h-7 items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-2.5 max-w-sm flex-1 min-w-[200px]">
              <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search projects…"
                className="bg-transparent text-[13px] focus:outline-none flex-1 placeholder:text-muted-foreground/40"
              />
              {search && (
                <button onClick={() => setSearch('')} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      </PageHeader>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {statusView ? (
        <div>
          <DeliveryPage embedded />
        </div>
      ) : (
      <div>
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
                  style={project.backgroundImage && project.accentColor ? { borderColor: `${project.accentColor}66` } : undefined}
                  className="group relative overflow-hidden text-left rounded-2xl border-2 border-border/70 bg-gradient-to-br from-muted/70 via-card to-muted/40 dark:from-muted/50 dark:via-card dark:to-muted/30 p-6 min-h-[250px] flex flex-col cursor-pointer shadow-md transition-[transform,box-shadow] duration-200 ease-out"
                >
                  {/* Background image layer — visible, with a bottom scrim so text stays readable */}
                  {project.backgroundImage && (
                    <>
                      <img src={resolveMediaUrl(project.backgroundImage)} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70 pointer-events-none" />
                      <div className="absolute inset-0 bg-gradient-to-t from-card via-card/55 to-card/10 pointer-events-none" />
                    </>
                  )}

                  {/* Top — icon + arrow */}
                  <div className="relative flex items-start justify-between mb-4">
                    <div className="w-12 h-12 rounded-xl overflow-hidden flex items-center justify-center shrink-0">
                      {project.projectImage ? (
                        <img src={resolveMediaUrl(project.projectImage)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className={`h-full w-full flex items-center justify-center ${projectAccent(project.id).light}`}>
                          <FolderOpen className={`h-6 w-6 ${projectAccent(project.id).text}`} />
                        </div>
                      )}
                    </div>
                    <ArrowUpRight className="h-5 w-5 text-muted-foreground/40 shrink-0 mt-0.5" />
                  </div>

                  {/* Title */}
                  <div className="relative shrink-0">
                    <h3 className="text-base font-bold leading-snug text-foreground line-clamp-2">
                      {projectPickerLabel(project)}
                    </h3>
                    {!project.clientId && (
                      <span className="inline-flex mt-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                        No Client
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-h-0" aria-hidden />

                  {/* Bottom — members · sections · description */}
                  <div className="relative pt-2 mt-auto space-y-2 shrink-0">
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
      )}

      <CreateProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </motion.div>
  );
};

function StatPill({ icon, value, label }: { icon: React.ReactNode; value: React.ReactNode; label: string }) {
  return (
    <div className={PAGE_CHIP}>
      {icon}
      <span className="font-semibold text-foreground">{value}</span> {label}
    </div>
  );
}

export default ManageProjectsOverview;
