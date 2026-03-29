import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { Plus, Search, Users, Layers, X, UserPlus, ChevronRight, FolderOpen } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import TaskDetailModal from '@/components/TaskDetailModal';
import { Task } from '@/types';

const ManageEmployeesPage = () => {
  const { users, projects, tasks, createProject, addSection, addMemberToProject, removeMemberFromProject } = useAppStore();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [createProjOpen, setCreateProjOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [sectionProjectId, setSectionProjectId] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  const selectedProject = projects.find(p => p.id === selectedProjectId);
  const projectEmployees = selectedProject
    ? users.filter(u => selectedProject.members.includes(u.id))
    : users.filter(u => u.role === 'employee');
  const filtered = projectEmployees.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));
  const projectTasks = selectedProject ? tasks.filter(t => t.projectId === selectedProject.id) : [];

  const handleCreateProject = () => {
    if (!projName.trim()) return toast.error('Enter project name');
    createProject(projName.trim(), projDesc.trim());
    toast.success('Project created!');
    setCreateProjOpen(false);
    setProjName(''); setProjDesc('');
  };

  const handleAddSection = () => {
    if (!sectionName.trim()) return toast.error('Enter section name');
    addSection(sectionProjectId, sectionName.trim());
    toast.success('Section added!');
    setAddSectionOpen(false);
    setSectionName('');
  };

  const inputCls = "w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6 h-full">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Manage</h1>
          <p className="text-sm text-muted-foreground mt-1">Projects, employees & tasks</p>
        </div>
        <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} onClick={() => setCreateProjOpen(true)}
          className="flex items-center gap-1.5 text-sm px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" /> New Project
        </motion.button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6 h-[calc(100%-80px)]">
        {/* Left: Projects */}
        <div className="space-y-2 overflow-y-auto">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 px-1">Projects</h2>

          {/* All employees option */}
          <motion.div
            whileHover={{ scale: 1.01, x: 4 }}
            whileTap={{ scale: 0.99 }}
            onClick={() => setSelectedProjectId(null)}
            className={`rounded-xl border p-4 cursor-pointer transition-all duration-200 ${!selectedProjectId ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/30'}`}
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Users className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold">All Employees</h4>
                <p className="text-xs text-muted-foreground">{users.filter(u => u.role === 'employee').length} employees</p>
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${!selectedProjectId ? 'rotate-90' : ''}`} />
            </div>
          </motion.div>

          {projects.map(project => {
            const isSelected = selectedProjectId === project.id;
            const projTasks = tasks.filter(t => t.projectId === project.id);
            return (
              <motion.div
                key={project.id}
                whileHover={{ scale: 1.01, x: 4 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setSelectedProjectId(project.id)}
                className={`rounded-xl border p-4 cursor-pointer transition-all duration-200 ${isSelected ? 'border-primary bg-primary/5' : 'bg-card hover:bg-muted/30'}`}
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

        {/* Right: Employees + Tasks */}
        <div className="overflow-y-auto space-y-6">
          {/* Employees section */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                {selectedProject ? `${selectedProject.name} — Employees` : 'All Employees'}
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
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="rounded-xl border bg-card p-4 transition-all duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                        <span className="text-xs font-bold text-primary">{user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold">{user.name}</h4>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                      {selectedProject && user.role !== 'manager' && (
                        <motion.button
                          whileHover={{ scale: 1.1 }}
                          whileTap={{ scale: 0.9 }}
                          onClick={() => { removeMemberFromProject(selectedProject.id, user.id); toast.info('Member removed'); }}
                          className="p-1.5 rounded-lg hover:bg-destructive/10 text-destructive transition-colors"
                        >
                          <X className="h-3.5 w-3.5" />
                        </motion.button>
                      )}
                    </div>
                    <div className="mt-2 ml-[52px] text-[11px] text-muted-foreground">
                      {user.projectIds.length} projects · {tasks.filter(t => t.assignedTo === user.id && t.status !== 'completed').length} active tasks
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Add member button for selected project */}
            {selectedProject && (
              <div className="mt-3">
                <h3 className="text-xs font-semibold text-muted-foreground mb-2">Add Members</h3>
                <div className="flex flex-wrap gap-2">
                  {users.filter(u => u.role === 'employee' && !selectedProject.members.includes(u.id)).map(u => (
                    <motion.button
                      key={u.id}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => { addMemberToProject(selectedProject.id, u.id); toast.success(`${u.name} added!`); }}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border hover:bg-primary/5 hover:border-primary/30 transition-all"
                    >
                      <UserPlus className="h-3 w-3" /> {u.name}
                    </motion.button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Sections for selected project */}
          {selectedProject && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">Sections</h2>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => { setSectionProjectId(selectedProject.id); setAddSectionOpen(true); }}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Add Section
                </motion.button>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedProject.sections.map(s => (
                  <span key={s.id} className="text-xs px-3 py-1.5 rounded-full border bg-muted/50 font-medium">{s.name}</span>
                ))}
              </div>
            </div>
          )}

          {/* Tasks for selected project */}
          {selectedProject && (
            <div>
              <h2 className="text-sm font-semibold text-foreground mb-3">Tasks ({projectTasks.length})</h2>
              <div className="space-y-2">
                {projectTasks.map(task => {
                  const assignee = users.find(u => u.id === task.assignedTo);
                  const section = selectedProject.sections.find(s => s.id === task.sectionId);
                  return (
                    <motion.div
                      key={task.id}
                      whileHover={{ scale: 1.01, x: 4 }}
                      whileTap={{ scale: 0.99 }}
                      onClick={() => setSelectedTask(task)}
                      className="rounded-xl border bg-card p-3 cursor-pointer hover:bg-muted/30 transition-all duration-200"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                            task.priority === 'Urgent' ? 'bg-red-500/15 text-red-400 border-red-500/20' :
                            task.priority === 'High' ? 'bg-orange-500/15 text-orange-400 border-orange-500/20' :
                            task.priority === 'Medium' ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20' :
                            'bg-green-500/15 text-green-400 border-green-500/20'
                          }`}>{task.priority}</span>
                          <h4 className="text-sm font-medium">{task.title}</h4>
                        </div>
                        <span className="text-[11px] text-muted-foreground">{task.status.replace('_', ' ')}</span>
                      </div>
                      <div className="mt-1.5 ml-[52px] text-[11px] text-muted-foreground flex gap-3">
                        <span>{assignee?.name}</span>
                        {section && <span>{section.name}</span>}
                      </div>
                    </motion.div>
                  );
                })}
                {projectTasks.length === 0 && (
                  <p className="text-sm text-muted-foreground py-6 text-center">No tasks in this project</p>
                )}
              </div>
            </div>
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
    </motion.div>
  );
};

export default ManageEmployeesPage;
