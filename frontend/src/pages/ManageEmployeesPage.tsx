import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  Plus, Search, X, UserPlus, ChevronRight, FolderOpen,
  Trash2, Users, LayoutGrid, ListTodo, Sparkles,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import { isTaskAssignedTo, taskAssigneeIds } from '@/lib/task-utils';
import TaskDetailModal from '@/components/TaskDetailModal';
import { Task } from '@/types';
import UserAvatar from '@/components/UserAvatar';

// ── Project accent colors ──────────────────────────────────────────────────────
const PROJECT_ACCENTS = [
  { border: 'border-l-blue-500', bg: 'bg-blue-500', light: 'bg-blue-500/10', text: 'text-blue-400', ring: 'ring-blue-500/20', pill: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  { border: 'border-l-violet-500', bg: 'bg-violet-500', light: 'bg-violet-500/10', text: 'text-violet-400', ring: 'ring-violet-500/20', pill: 'bg-violet-500/15 text-violet-400 border-violet-500/30' },
  { border: 'border-l-emerald-500', bg: 'bg-emerald-500', light: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', pill: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  { border: 'border-l-orange-500', bg: 'bg-orange-500', light: 'bg-orange-500/10', text: 'text-orange-400', ring: 'ring-orange-500/20', pill: 'bg-orange-500/15 text-orange-400 border-orange-500/30' },
  { border: 'border-l-pink-500', bg: 'bg-pink-500', light: 'bg-pink-500/10', text: 'text-pink-400', ring: 'ring-pink-500/20', pill: 'bg-pink-500/15 text-pink-400 border-pink-500/30' },
  { border: 'border-l-teal-500', bg: 'bg-teal-500', light: 'bg-teal-500/10', text: 'text-teal-400', ring: 'ring-teal-500/20', pill: 'bg-teal-500/15 text-teal-400 border-teal-500/30' },
  { border: 'border-l-amber-500', bg: 'bg-amber-500', light: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', pill: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  { border: 'border-l-cyan-500', bg: 'bg-cyan-500', light: 'bg-cyan-500/10', text: 'text-cyan-400', ring: 'ring-cyan-500/20', pill: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30' },
];


const PRIORITY_STYLES: Record<string, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/25',
  High:   'bg-orange-500/15 text-orange-400 border-orange-500/25',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
  Low:    'bg-green-500/15 text-green-400 border-green-500/25',
};

function projectAccent(id: string) {
  let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return PROJECT_ACCENTS[h % PROJECT_ACCENTS.length];
}

// ═══════════════════════════════════════════════════════════════════════════════
const ManageEmployeesPage = () => {
  const {
    users, projects, tasks, createProject, addSection, removeSection,
    addMemberToProject, removeMemberFromProject,
  } = useAppStore();

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [createProjOpen, setCreateProjOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [sectionProjectId, setSectionProjectId] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<{ id: string; name: string } | null>(null);
  const [sectionToDelete, setSectionToDelete] = useState<{ id: string; name: string } | null>(null);
  const [removingMember, setRemovingMember] = useState(false);
  const [deletingSection, setDeletingSection] = useState(false);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const selectedAccent = selectedProject ? projectAccent(selectedProject.id) : PROJECT_ACCENTS[0];
  const projectMembers = selectedProject ? users.filter(u => selectedProject.members.includes(u.id)) : [];
  const filtered = projectMembers.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const projectTasks = selectedProject ? tasks.filter(t => t.projectId === selectedProject.id) : [];

  // Global stats
  const totalMembers = useMemo(() => new Set(projects.flatMap(p => p.members)).size, [projects]);
  const totalTasks = tasks.length;

  const memberRemoveStats = useMemo(() => {
    if (!memberToRemove || !selectedProject) return null;
    const assignedHere = projectTasks.filter(t => isTaskAssignedTo(t, memberToRemove.id));
    const notCompleted = assignedHere.filter(t => t.status !== 'completed');
    const onBoardActive = assignedHere.filter(t => ['in_progress', 'in_review', 'done'].includes(t.status));
    return { assignedCount: assignedHere.length, activeCount: notCompleted.length, inProgressCount: onBoardActive.length };
  }, [memberToRemove, selectedProject, projectTasks]);

  const inputCls = 'w-full rounded-xl border border-border/50 bg-muted/40 px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/20 transition-all placeholder:text-muted-foreground/40';

  const handleCreateProject = async () => {
    if (!projName.trim()) return toast.error('Enter project name');
    try {
      await createProject(projName.trim(), projDesc.trim());
      toast.success('Project created!');
      setCreateProjOpen(false); setProjName(''); setProjDesc('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not create project'); }
  };

  const handleAddSection = async () => {
    if (!sectionName.trim()) return toast.error('Enter section name');
    try {
      await addSection(sectionProjectId, sectionName.trim());
      toast.success('Section added!');
      setAddSectionOpen(false); setSectionName('');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not add section'); }
  };

  const confirmRemoveMember = async () => {
    if (!memberToRemove || !selectedProject) return;
    setRemovingMember(true);
    try {
      await removeMemberFromProject(selectedProject.id, memberToRemove.id);
      toast.success(`${memberToRemove.name} removed from the project`);
      setMemberToRemove(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not remove member'); }
    finally { setRemovingMember(false); }
  };

  const confirmDeleteSection = async () => {
    if (!sectionToDelete || !selectedProject) return;
    setDeletingSection(true);
    try {
      await removeSection(selectedProject.id, sectionToDelete.id);
      toast.success(`Section "${sectionToDelete.name}" deleted`);
      setSectionToDelete(null);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not delete section'); }
    finally { setDeletingSection(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="flex flex-col h-[calc(100dvh-3.5rem)] min-h-0 overflow-hidden"
    >
      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 px-8 pt-7 pb-5 border-b border-border/30 bg-gradient-to-b from-muted/20 to-transparent">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-4 w-4 text-primary/60" />
              <span className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-widest">Manager Panel</span>
            </div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/60 bg-clip-text text-transparent">
              Manage Projects
            </h1>
            <p className="text-sm text-muted-foreground/60 mt-1.5">Organize teams, sections and tasks across every project</p>
          </div>

          <div className="flex items-center gap-3 mt-1">
            {/* Stats pills */}
            <div className="hidden sm:flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-muted/50 border border-border/40 text-muted-foreground">
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="font-semibold text-foreground">{projects.length}</span> projects
              </div>
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-muted/50 border border-border/40 text-muted-foreground">
                <Users className="h-3.5 w-3.5" />
                <span className="font-semibold text-foreground">{totalMembers}</span> members
              </div>
              <div className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-muted/50 border border-border/40 text-muted-foreground">
                <ListTodo className="h-3.5 w-3.5" />
                <span className="font-semibold text-foreground">{totalTasks}</span> tasks
              </div>
            </div>

            <motion.button
              transition={snappy}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={() => setCreateProjOpen(true)}
              className="flex items-center gap-2 text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity font-semibold shadow-sm"
            >
              <Plus className="h-4 w-4" /> New Project
            </motion.button>
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 divide-x divide-border/25">

        {/* ── LEFT: Project list ──────────────────────────────────────────── */}
        <div className="w-[300px] shrink-0 flex flex-col min-h-0 bg-muted/5">
          <div className="px-4 pt-4 pb-3 shrink-0">
            <p className="text-[10px] font-bold text-muted-foreground/50 uppercase tracking-widest px-1 mb-3">
              {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto min-h-0 px-3 pb-4 space-y-1.5">
            {projects.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-muted/60 flex items-center justify-center mb-3">
                  <FolderOpen className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground/50">No projects yet</p>
                <button
                  onClick={() => setCreateProjOpen(true)}
                  className="mt-3 text-xs text-primary hover:text-primary/80 font-semibold transition-colors"
                >
                  Create your first one
                </button>
              </div>
            )}
            {projects.map(project => {
              const isSelected = selectedProjectId === project.id;
              const accent = projectAccent(project.id);
              const projTasks = tasks.filter(t => t.projectId === project.id);
              return (
                <motion.button
                  key={project.id}
                  transition={snappy}
                  whileHover={{ x: 2 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`w-full text-left rounded-xl border-l-[3px] border border-border/30 p-3.5 transition-all duration-150 group ${
                    isSelected
                      ? `${accent.border} bg-card shadow-sm border-border/40`
                      : `border-l-transparent hover:border-l-border/60 hover:bg-card/80 bg-transparent`
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                      isSelected ? `${accent.light}` : 'bg-muted/60 group-hover:bg-muted'
                    }`}>
                        <FolderOpen className={`h-4 w-4 transition-colors ${isSelected ? accent.text : 'text-muted-foreground/50 group-hover:text-muted-foreground'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold truncate transition-colors ${isSelected ? 'text-foreground' : 'text-foreground/80 group-hover:text-foreground'}`}>
                        {projectPickerLabel(project)}
                      </div>
                      {project.description && (
                        <div className="text-[11px] text-muted-foreground/50 truncate mt-0.5">{project.description}</div>
                      )}
                    </div>
                    <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-all ${isSelected ? `${accent.text} rotate-90` : 'text-muted-foreground/25 group-hover:text-muted-foreground/50'}`} />
                  </div>
                  <div className="flex items-center gap-3 mt-2.5 ml-12 text-[11px] text-muted-foreground/50">
                    <span className={`transition-colors ${isSelected ? accent.text : ''}`}>{project.members.length} members</span>
                    <span>·</span>
                    <span>{project.sections.length} sections</span>
                    <span>·</span>
                    <span>{projTasks.length} tasks</span>
                  </div>
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: Project detail ───────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto min-h-0">
          {!selectedProject ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[400px] text-center px-8">
              <div className="w-20 h-20 rounded-3xl bg-muted/40 flex items-center justify-center mb-5 border border-border/30">
                <LayoutGrid className="h-9 w-9 text-muted-foreground/25" />
              </div>
              <h2 className="text-xl font-bold text-foreground/70 mb-2">Select a project</h2>
              <p className="text-sm text-muted-foreground/50 max-w-xs leading-relaxed">
                Choose a project from the left panel to manage its members, sections, and tasks.
              </p>
            </div>
          ) : (
            <div className="p-7 space-y-8">

              {/* Project header */}
              <div className={`rounded-2xl border border-border/30 overflow-hidden`}>
                <div className={`h-1 w-full ${selectedAccent.bg}`} />
                <div className="px-6 py-5 bg-gradient-to-r from-muted/20 to-transparent">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${selectedAccent.light}`}>
                        <FolderOpen className={`h-5 w-5 ${selectedAccent.text}`} />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-foreground">{projectPickerLabel(selectedProject)}</h2>
                      {selectedProject.description && (
                        <p className="text-sm text-muted-foreground/60 mt-0.5">{selectedProject.description}</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Members section ─────────────────────────────────────── */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Users className={`h-4 w-4 ${selectedAccent.text}`} />
                    <h3 className="text-sm font-bold text-foreground">
                      Members
                      <span className="ml-2 text-xs font-normal text-muted-foreground/60">({filtered.length})</span>
                    </h3>
                  </div>
                    <div className="flex items-center gap-2 bg-muted/40 border border-border/40 rounded-xl px-3 py-1.5 w-52">
                      <Search className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                      <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search members…"
                        className="bg-transparent text-sm focus:outline-none flex-1 placeholder:text-muted-foreground/40"
                      />
                      {searchTerm && (
                        <button onClick={() => setSearchTerm('')} className="text-muted-foreground/50 hover:text-foreground transition-colors">
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <AnimatePresence mode="popLayout">
                    {filtered.map(user => {
                      const activeTasks = tasks.filter(t => isTaskAssignedTo(t, user.id) && t.status !== 'completed').length;
                      return (
                        <motion.div
                          key={user.id}
                          layout
                          transition={snappy}
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className="group rounded-xl border border-border/35 bg-card hover:border-border/60 hover:shadow-sm transition-all duration-150 p-4"
                        >
                          <div className="flex items-center gap-3">
                            <UserAvatar name={user.name} avatar={user.avatar} size="md" />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-semibold group-hover:text-primary transition-colors">{user.name}</span>
                                {user.role === 'manager' && (
                                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-primary/10 text-primary border border-primary/20">
                                    Manager
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{user.email}</p>
                            </div>
                              <motion.button
                                transition={snappy}
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={() => setMemberToRemove({ id: user.id, name: user.name })}
                                className="p-2 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-all shrink-0"
                                aria-label={`Remove ${user.name}`}
                              >
                                <X className="h-3.5 w-3.5" />
                              </motion.button>
                          </div>
                          <div className="mt-2.5 ml-13 flex items-center gap-3 text-[11px] text-muted-foreground/50" style={{ marginLeft: '52px' }}>
                            <span>{user.projectIds.length} {user.projectIds.length === 1 ? 'project' : 'projects'}</span>
                            <span>·</span>
                            <span className={activeTasks > 0 ? 'text-primary/70 font-semibold' : ''}>{activeTasks} active {activeTasks === 1 ? 'task' : 'tasks'}</span>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  {filtered.length === 0 && searchTerm && (
                    <div className="col-span-2 text-center py-8 text-sm text-muted-foreground/50 italic">
                      No members match "{searchTerm}"
                    </div>
                  )}
                  {projectMembers.length === 0 && (
                    <div className="col-span-2 text-center py-8 text-sm text-muted-foreground/40 italic border border-dashed border-border/30 rounded-xl">
                      No members yet. Add someone below.
                    </div>
                  )}
                </div>

                {/* Add members */}
                {users.filter(u => !selectedProject.members.includes(u.id)).length > 0 && (
                  <div className="mt-5 pt-5 border-t border-border/25">
                    <p className="text-[11px] font-bold text-muted-foreground/50 uppercase tracking-widest mb-3">Add to project</p>
                    <div className="flex flex-wrap gap-2">
                      {users
                        .filter(u => !selectedProject.members.includes(u.id))
                        .sort((a, b) => {
                          const ro = (a.role === 'manager' ? 0 : 1) - (b.role === 'manager' ? 0 : 1);
                          return ro !== 0 ? ro : a.name.localeCompare(b.name);
                        })
                        .map(u => (
                          <motion.button
                            key={u.id}
                            transition={snappy}
                            whileHover={{ scale: 1.03, y: -1 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => {
                              void addMemberToProject(selectedProject.id, u.id)
                                .then(() => toast.success(`${u.name} added!`))
                                .catch(e => toast.error(e instanceof Error ? e.message : 'Could not add member'));
                            }}
                            className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl border border-border/40 bg-muted/30 hover:bg-primary/8 hover:border-primary/40 hover:text-primary text-muted-foreground/70 transition-all duration-150 font-medium group"
                          >
                            <UserAvatar name={u.name} avatar={u.avatar} size="xs" />
                            <span>{u.name}</span>
                            {u.role === 'manager' && (
                              <span className="text-[9px] font-bold text-primary/60 group-hover:text-primary">Mgr</span>
                            )}
                            <UserPlus className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                          </motion.button>
                        ))}
                    </div>
                  </div>
                )}
              </section>

              {/* ── Sections ────────────────────────────────────────────── */}
              <section>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <LayoutGrid className={`h-4 w-4 ${selectedAccent.text}`} />
                    <h3 className="text-sm font-bold text-foreground">
                      Sections
                      <span className="ml-2 text-xs font-normal text-muted-foreground/60">({selectedProject.sections.length})</span>
                    </h3>
                  </div>
                  <motion.button
                    transition={snappy}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => { setSectionProjectId(selectedProject.id); setAddSectionOpen(true); }}
                    className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl border transition-all font-semibold ${selectedAccent.pill}`}
                  >
                    <Plus className="h-3 w-3" /> Add Section
                  </motion.button>
                </div>

                {selectedProject.sections.length === 0 ? (
                  <div className="py-6 text-center text-sm text-muted-foreground/40 italic border border-dashed border-border/30 rounded-xl">
                    No sections yet
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <AnimatePresence>
                      {selectedProject.sections.map(s => (
                        <motion.span
                          key={s.id}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          exit={{ opacity: 0, scale: 0.9 }}
                          className="inline-flex items-center gap-2 text-xs px-3.5 py-2 rounded-xl border border-border/40 bg-muted/30 font-medium group hover:border-border/60 hover:bg-muted/50 transition-all"
                        >
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${selectedAccent.bg}`} />
                          <span className="break-words [overflow-wrap:anywhere]">{s.name}</span>
                          <button
                            type="button"
                            onClick={() => setSectionToDelete({ id: s.id, name: s.name })}
                            className="p-0.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-all"
                            aria-label={`Delete section ${s.name}`}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </motion.span>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </section>

              {/* ── Tasks ───────────────────────────────────────────────── */}
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <ListTodo className={`h-4 w-4 ${selectedAccent.text}`} />
                  <h3 className="text-sm font-bold text-foreground">
                    Tasks
                    <span className="ml-2 text-xs font-normal text-muted-foreground/60">({projectTasks.length})</span>
                  </h3>
                </div>

                {projectTasks.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground/40 italic border border-dashed border-border/30 rounded-xl">
                    No tasks in this project
                  </div>
                ) : (
                  <div className="space-y-2">
                    {projectTasks.map(task => {
                      const assigneeNames = taskAssigneeIds(task)
                        .map(id => users.find(u => u.id === id)?.name)
                        .filter(Boolean).join(', ') || '—';
                      const taskSection = selectedProject.sections.find(s => s.id === task.sectionId);
                      const priStyle = PRIORITY_STYLES[task.priority] ?? PRIORITY_STYLES.Low;
                      return (
                        <motion.div
                          key={task.id}
                          transition={snappy}
                          whileHover={{ x: 3 }}
                          onClick={() => setSelectedTask(task)}
                          className="group flex items-start gap-3 rounded-xl border border-border/30 bg-card hover:border-border/60 hover:shadow-sm p-4 cursor-pointer transition-all duration-150"
                        >
                          <span className={`shrink-0 text-[10px] px-2.5 py-1 rounded-full font-bold border ${priStyle}`}>
                            {task.priority}
                          </span>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors break-words [overflow-wrap:anywhere] leading-snug">
                              {task.title}
                            </h4>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[11px] text-muted-foreground/55">
                              {assigneeNames !== '—' && <span>{assigneeNames}</span>}
                              {taskSection && (
                                <>
                                  {assigneeNames !== '—' && <span>·</span>}
                                  <span>{taskSection.name}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <span className={`shrink-0 text-[10px] px-2.5 py-1 rounded-full border font-medium capitalize ${
                            task.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' :
                            task.status === 'in_progress' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
                            task.status === 'in_review' ? 'bg-violet-500/15 text-violet-400 border-violet-500/25' :
                            task.status === 'done' ? 'bg-green-500/15 text-green-400 border-green-500/25' :
                            'bg-muted text-muted-foreground border-border/40'
                          }`}>
                            {task.status.replace('_', ' ')}
                          </span>
                        </motion.div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>

      {/* ── Create Project Modal ──────────────────────────────────────────── */}
      <Dialog open={createProjOpen} onOpenChange={o => { setCreateProjOpen(o); if (!o) { setProjName(''); setProjDesc(''); } }}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Create Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <input
              autoFocus
              value={projName}
              onChange={e => setProjName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleCreateProject()}
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
              onClick={() => void handleCreateProject()}
              disabled={!projName.trim()}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all shadow-sm hover:shadow-md"
            >
              Create Project
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Add Section Modal ─────────────────────────────────────────────── */}
      <Dialog open={addSectionOpen} onOpenChange={o => { setAddSectionOpen(o); if (!o) setSectionName(''); }}>
        <DialogContent
          className="sm:max-w-sm rounded-2xl"
          onOpenAutoFocus={e => { e.preventDefault(); (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Add Section</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <input
              autoFocus
              value={sectionName}
              onChange={e => setSectionName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && void handleAddSection()}
              className={inputCls}
              placeholder="Section name"
            />
            <button
              onClick={() => void handleAddSection()}
              disabled={!sectionName.trim()}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-bold text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-all shadow-sm"
            >
              Add Section
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />

      {/* ── Remove Member Confirmation ────────────────────────────────────── */}
      <AlertDialog open={!!memberToRemove} onOpenChange={o => !o && setMemberToRemove(null)}>
        <AlertDialogContent className="rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {memberToRemove?.name}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>They will lose access to this project. You can re-add them at any time.</p>
                {memberRemoveStats && memberRemoveStats.assignedCount > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-3.5 py-2.5 text-amber-400 text-sm font-medium mt-2">
                    This user has {memberRemoveStats.assignedCount} task{memberRemoveStats.assignedCount !== 1 ? 's' : ''} assigned in this project
                    {memberRemoveStats.activeCount > 0 && ` (${memberRemoveStats.activeCount} still open)`}.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingMember}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removingMember}
              onClick={e => { e.preventDefault(); void confirmRemoveMember(); }}
            >
              {removingMember ? 'Removing…' : 'Remove from project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Section Confirmation ───────────────────────────────────── */}
      <AlertDialog open={!!sectionToDelete} onOpenChange={o => !o && setSectionToDelete(null)}>
        <AlertDialogContent className="max-w-[min(100%,28rem)] rounded-2xl overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words [overflow-wrap:anywhere] pr-2">
              Delete section &quot;{sectionToDelete?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words [overflow-wrap:anywhere]">
              You can only delete a section if it has no tasks and no timesheet rows. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingSection}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deletingSection}
              onClick={e => { e.preventDefault(); void confirmDeleteSection(); }}
            >
              {deletingSection ? 'Deleting…' : 'Delete section'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
};

export default ManageEmployeesPage;
