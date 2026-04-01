import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useMemo, useState } from 'react';
import { Plus, Search, X, UserPlus, ChevronRight, FolderOpen, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { snappy, pageEnter } from '@/lib/motion';
import { isTaskAssignedTo, taskAssigneeIds } from '@/lib/task-utils';
import TaskDetailModal from '@/components/TaskDetailModal';
import { Task } from '@/types';

const ManageEmployeesPage = () => {
  const {
    users,
    projects,
    tasks,
    createProject,
    addSection,
    removeSection,
    addMemberToProject,
    removeMemberFromProject,
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
  const projectEmployees = selectedProject
    ? users.filter(u => selectedProject.members.includes(u.id))
    : [];
  const filtered = projectEmployees.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const projectTasks = selectedProject ? tasks.filter(t => t.projectId === selectedProject.id) : [];

  const memberRemoveStats = useMemo(() => {
    if (!memberToRemove || !selectedProject) return null;
    const assignedHere = projectTasks.filter(t => isTaskAssignedTo(t, memberToRemove.id));
    const notCompleted = assignedHere.filter(t => t.status !== 'completed');
    const onBoardActive = assignedHere.filter(t =>
      ['in_progress', 'in_review', 'done'].includes(t.status),
    );
    return {
      assignedCount: assignedHere.length,
      activeCount: notCompleted.length,
      inProgressCount: onBoardActive.length,
    };
  }, [memberToRemove, selectedProject, projectTasks]);

  const handleCreateProject = async () => {
    if (!projName.trim()) return toast.error('Enter project name');
    try {
      await createProject(projName.trim(), projDesc.trim());
      toast.success('Project created!');
      setCreateProjOpen(false);
      setProjName('');
      setProjDesc('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create project');
    }
  };

  const handleAddSection = async () => {
    if (!sectionName.trim()) return toast.error('Enter section name');
    try {
      await addSection(sectionProjectId, sectionName.trim());
      toast.success('Section added!');
      setAddSectionOpen(false);
      setSectionName('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not add section');
    }
  };

  const inputCls = "w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  const confirmRemoveMember = async () => {
    if (!memberToRemove || !selectedProject) return;
    setRemovingMember(true);
    try {
      await removeMemberFromProject(selectedProject.id, memberToRemove.id);
      toast.success(`${memberToRemove.name} removed from the project`);
      setMemberToRemove(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not remove member');
    } finally {
      setRemovingMember(false);
    }
  };

  const confirmDeleteSection = async () => {
    if (!sectionToDelete || !selectedProject) return;
    setDeletingSection(true);
    try {
      await removeSection(selectedProject.id, sectionToDelete.id);
      toast.success(`Section "${sectionToDelete.name}" deleted`);
      setSectionToDelete(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not delete section');
    } finally {
      setDeletingSection(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={pageEnter}
      className="p-6 flex flex-col h-[calc(100dvh-3.5rem)] min-h-0"
    >
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Manage projects</h1>
          <p className="text-sm text-muted-foreground mt-1">Members, sections & tasks per project</p>
        </div>
        <motion.button transition={snappy} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} onClick={() => setCreateProjOpen(true)}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" /> New Project
        </motion.button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 flex-1 min-h-0">
        {/* Left: Projects */}
        <div className="space-y-2 overflow-y-auto min-h-0 pr-1">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">Projects</h2>

          {projects.map(project => {
            const isSelected = selectedProjectId === project.id;
            const projTasks = tasks.filter(t => t.projectId === project.id);
            return (
              <motion.div
                key={project.id}
                transition={snappy}
                whileHover={{ scale: 1.005, x: 2 }}
                whileTap={{ scale: 0.995 }}
                onClick={() => setSelectedProjectId(project.id)}
                className={`rounded-xl border p-4 cursor-pointer transition-colors duration-100 ${isSelected ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/30'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold">{project.name}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-1">{project.description}</p>
                  </div>
                  <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${isSelected ? 'rotate-90' : ''}`} />
                </div>
                <div className="flex items-center gap-3 mt-2 ml-[52px] text-[11px] text-muted-foreground">
                  <span>{project.members.length} members</span>
                  <span>{project.sections.length} sections</span>
                  <span>{projTasks.length} tasks</span>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Right: project detail — tasks list scrolls independently */}
        <div className="flex flex-col gap-6 flex-1 min-h-0 overflow-hidden">
          {!selectedProject ? (
            <div className="flex flex-col items-center justify-center h-full min-h-[320px] text-center px-4 border border-dashed rounded-2xl bg-muted/20">
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <FolderOpen className="h-7 w-7 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground">Select a project</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm">
                Choose a project on the left to manage members, sections, and tasks.
              </p>
            </div>
          ) : (
            <>
              <div className="shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedProject.name} — Members
                  </h2>
                  <div className="flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-1.5 w-56">
                    <Search className="h-3.5 w-3.5 text-muted-foreground" />
                    <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Search..." className="bg-transparent text-sm focus:outline-none flex-1" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <AnimatePresence mode="popLayout">
                    {filtered.map(user => (
                      <motion.div
                        key={user.id}
                        layout
                        transition={snappy}
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        whileHover={{ scale: 1.01, y: -1 }}
                        className="rounded-xl border bg-card p-4 transition-colors duration-100"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <span className="text-xs font-bold text-primary">{user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-sm font-semibold">{user.name}</h4>
                            <p className="text-xs text-muted-foreground">{user.email}</p>
                          </div>
                          {user.role !== 'manager' && (
                            <motion.button
                              transition={snappy}
                              whileHover={{ scale: 1.05 }}
                              whileTap={{ scale: 0.95 }}
                              type="button"
                              onClick={() => setMemberToRemove({ id: user.id, name: user.name })}
                              className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors duration-100"
                              aria-label={`Remove ${user.name}`}
                            >
                              <X className="h-3.5 w-3.5" />
                            </motion.button>
                          )}
                        </div>
                        <div className="mt-2 ml-[52px] text-[11px] text-muted-foreground">
                          {user.projectIds.length} projects · {tasks.filter(t => isTaskAssignedTo(t, user.id) && t.status !== 'completed').length} active tasks
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>

                <div className="mt-3">
                  <h3 className="text-xs font-semibold text-muted-foreground mb-2">Add Members</h3>
                  <div className="flex flex-wrap gap-2">
                    {users.filter(u => u.role === 'employee' && !selectedProject.members.includes(u.id)).map(u => (
                      <motion.button
                        key={u.id}
                        transition={snappy}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          void addMemberToProject(selectedProject.id, u.id)
                            .then(() => toast.success(`${u.name} added!`))
                            .catch(e => toast.error(e instanceof Error ? e.message : 'Could not add member'));
                        }}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border hover:bg-primary/5 hover:border-primary/30 transition-colors duration-100"
                      >
                        <UserPlus className="h-3 w-3" /> {u.name}
                      </motion.button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="shrink-0">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Sections</h2>
                  <motion.button
                    transition={snappy}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => { setSectionProjectId(selectedProject.id); setAddSectionOpen(true); }}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Section
                  </motion.button>
                </div>
                <div className="flex flex-wrap gap-2 min-w-0">
                  {selectedProject.sections.map(s => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-full border bg-muted/50 font-medium min-w-0 max-w-full"
                    >
                      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{s.name}</span>
                      <button
                        type="button"
                        onClick={() => setSectionToDelete({ id: s.id, name: s.name })}
                        className="p-0.5 rounded-md hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                        aria-label={`Delete section ${s.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex flex-col flex-1 min-h-0 gap-2">
                <h2 className="text-sm font-semibold text-foreground shrink-0">Tasks ({projectTasks.length})</h2>
                <div className="flex-1 min-h-0 max-h-[calc(100dvh-22rem)] overflow-y-auto overscroll-contain space-y-2 pr-1">
                  {projectTasks.map(task => {
                    const assigneeNames = taskAssigneeIds(task).map(id => users.find(u => u.id === id)?.name).filter(Boolean).join(', ') || '—';
                    const section = selectedProject.sections.find(s => s.id === task.sectionId);
                    return (
                      <motion.div
                        key={task.id}
                        transition={snappy}
                        whileHover={{ scale: 1.005, x: 2 }}
                        whileTap={{ scale: 0.995 }}
                        onClick={() => setSelectedTask(task)}
                        className="rounded-xl border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-colors duration-100"
                      >
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex items-start gap-3 min-w-0 flex-1">
                            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                              task.priority === 'Urgent' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                              task.priority === 'High' ? 'bg-orange-500/15 text-orange-400 border-orange-500/20' :
                              task.priority === 'Medium' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' :
                              'bg-green-500/15 text-green-400 border-green-500/20'
                            }`}>{task.priority}</span>
                            <h4 className="text-sm font-medium min-w-0 break-words [overflow-wrap:anywhere]">{task.title}</h4>
                          </div>
                          <span className="text-[11px] text-muted-foreground shrink-0">{task.status.replace('_', ' ')}</span>
                        </div>
                        <div className="mt-1.5 ml-[52px] text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 min-w-0">
                          <span className="min-w-0 break-words [overflow-wrap:anywhere] max-w-full" title={assigneeNames}>{assigneeNames}</span>
                          {section && <span className="min-w-0 break-words [overflow-wrap:anywhere]">{section.name}</span>}
                        </div>
                      </motion.div>
                    );
                  })}
                  {projectTasks.length === 0 && (
                    <p className="text-sm text-muted-foreground py-6 text-center">No tasks in this project</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Project Modal */}
      <Dialog open={createProjOpen} onOpenChange={setCreateProjOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Create Project</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input value={projName} onChange={e => setProjName(e.target.value)} className={inputCls} placeholder="Project name" />
            <textarea value={projDesc} onChange={e => setProjDesc(e.target.value)} className={`${inputCls} min-h-[60px]`} placeholder="Description" />
            <button onClick={handleCreateProject}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Create</button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Section Modal */}
      <Dialog open={addSectionOpen} onOpenChange={setAddSectionOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Section</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input value={sectionName} onChange={e => setSectionName(e.target.value)} className={inputCls} placeholder="Section name" />
            <button onClick={handleAddSection}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Add</button>
          </div>
        </DialogContent>
      </Dialog>

      <TaskDetailModal task={selectedTask} open={!!selectedTask} onOpenChange={o => !o && setSelectedTask(null)} />

      <AlertDialog open={!!memberToRemove} onOpenChange={o => !o && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {memberToRemove?.name} from this project?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>They will lose access to this project. You can add them again later.</p>
                {memberRemoveStats && memberRemoveStats.assignedCount > 0 && (
                  <p className="text-foreground font-medium">
                    This user has {memberRemoveStats.assignedCount} task
                    {memberRemoveStats.assignedCount !== 1 ? 's' : ''} assigned in this project
                    {memberRemoveStats.activeCount > 0 ? (
                      <>
                        {' '}
                        ({memberRemoveStats.activeCount} still open
                        {memberRemoveStats.inProgressCount > 0
                          ? `; ${memberRemoveStats.inProgressCount} on the board in In progress, In review, or Done`
                          : ''}
                        ).
                      </>
                    ) : (
                      <> (all completed).</>
                    )}
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removingMember}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removingMember}
              onClick={e => {
                e.preventDefault();
                void confirmRemoveMember();
              }}
            >
              {removingMember ? 'Removing…' : 'Remove from project'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!sectionToDelete} onOpenChange={o => !o && setSectionToDelete(null)}>
        <AlertDialogContent className="max-w-[min(100%,28rem)] overflow-hidden">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words [overflow-wrap:anywhere] pr-2">
              Delete section{' '}
              <span className="break-all">&quot;{sectionToDelete?.name}&quot;</span>?
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
              onClick={e => {
                e.preventDefault();
                void confirmDeleteSection();
              }}
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
