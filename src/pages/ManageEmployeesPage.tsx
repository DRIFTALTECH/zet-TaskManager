import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useState } from 'react';
import { Plus, Search, Users, Layers, X, UserPlus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const ManageEmployeesPage = () => {
  const { users, projects, tasks, createProject, addSection, addMemberToProject, removeMemberFromProject } = useAppStore();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [createProjOpen, setCreateProjOpen] = useState(false);
  const [projName, setProjName] = useState('');
  const [projDesc, setProjDesc] = useState('');
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [sectionName, setSectionName] = useState('');
  const [sectionProjectId, setSectionProjectId] = useState('');

  const employees = users.filter(u => u.role === 'employee');
  const filtered = employees.filter(u => u.name.toLowerCase().includes(searchTerm.toLowerCase()));

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
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6">
      <h1 className="text-2xl font-bold mb-6">Manage Employees</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Employees */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <div className="flex-1 flex items-center gap-2 rounded-xl border bg-muted/50 px-3 py-1.5">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                placeholder="Search employees..." className="bg-transparent text-sm focus:outline-none flex-1" />
            </div>
          </div>
          <div className="space-y-2">
            {filtered.map(user => (
              <div key={user.id}
                onClick={() => setSelectedUserId(user.id)}
                className={`rounded-xl border p-4 cursor-pointer transition-colors card-hover ${selectedUserId === user.id ? 'border-primary bg-primary/5' : 'bg-card'}`}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xl">{user.avatar}</div>
                  <div className="flex-1">
                    <h4 className="text-sm font-semibold">{user.name}</h4>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{user.projectIds.length} projects</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Projects */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Projects</h2>
            <button onClick={() => setCreateProjOpen(true)}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus className="h-3.5 w-3.5" /> New Project
            </button>
          </div>
          <div className="space-y-3">
            {projects.map(project => {
              const isExpanded = expandedProject === project.id;
              const memberUsers = users.filter(u => project.members.includes(u.id));
              const projTasks = tasks.filter(t => t.projectId === project.id);
              return (
                <div key={project.id} className="rounded-xl border bg-card overflow-hidden">
                  <div onClick={() => setExpandedProject(isExpanded ? null : project.id)}
                    className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  >
                    <h4 className="font-semibold text-sm">{project.name}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{project.description}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {project.members.length}</span>
                      <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> {project.sections.length} sections</span>
                      <span>{projTasks.length} tasks</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t p-4 space-y-3">
                      {/* Sections */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-muted-foreground">Sections</span>
                          <button onClick={() => { setSectionProjectId(project.id); setAddSectionOpen(true); }}
                            className="text-xs text-primary hover:underline">+ Add</button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {project.sections.map(s => (
                            <span key={s.id} className="text-xs px-2.5 py-1 rounded-full border bg-muted/50">{s.name}</span>
                          ))}
                        </div>
                      </div>
                      {/* Members */}
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold text-muted-foreground">Members</span>
                          {selectedUserId && !project.members.includes(selectedUserId) && (
                            <button onClick={() => { addMemberToProject(project.id, selectedUserId); toast.success('Employee added to project!'); }}
                              className="flex items-center gap-1 text-xs text-primary hover:underline">
                              <UserPlus className="h-3 w-3" /> Add Selected
                            </button>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {memberUsers.map(u => (
                            <div key={u.id} className="flex items-center justify-between text-xs">
                              <span>{u.avatar} {u.name}</span>
                              {u.role !== 'manager' && (
                                <button onClick={() => { removeMemberFromProject(project.id, u.id); toast.info('Member removed'); }}
                                  className="text-destructive hover:underline"><X className="h-3 w-3" /></button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Create Project Modal */}
      <Dialog open={createProjOpen} onOpenChange={setCreateProjOpen}>
        <DialogContent className="glass sm:max-w-sm">
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
        <DialogContent className="glass sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Section</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <input value={sectionName} onChange={e => setSectionName(e.target.value)} className={inputCls} placeholder="Section name" />
            <button onClick={handleAddSection}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90">Add</button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default ManageEmployeesPage;
