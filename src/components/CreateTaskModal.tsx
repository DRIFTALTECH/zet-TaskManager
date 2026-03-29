import { useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Priority } from '@/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CreateTaskModal = ({ open, onOpenChange }: Props) => {
  const { currentUser, projects, users, createTask } = useAppStore();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [projectId, setProjectId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [tagsStr, setTagsStr] = useState('');

  if (!currentUser) return null;

  const userProjects = projects.filter(p => currentUser.projectIds.includes(p.id));
  const selectedProject = projects.find(p => p.id === projectId);
  const projectMembers = selectedProject ? users.filter(u => selectedProject.members.includes(u.id)) : [];

  const handleSave = () => {
    if (!title.trim() || !projectId || !sectionId || !assignedTo || !dueDate) {
      return toast.error('Please fill all required fields');
    }
    createTask({
      title: title.trim(),
      description: description.trim(),
      projectId,
      sectionId,
      assignedTo,
      assignedBy: currentUser.id,
      createdBy: currentUser.id,
      dueDate,
      priority,
      tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean),
    });
    toast.success('Task created!');
    onOpenChange(false);
    setTitle(''); setDescription(''); setProjectId(''); setSectionId('');
    setAssignedTo(''); setDueDate(''); setPriority('Medium'); setTagsStr('');
  };

  const inputCls = "w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass sm:max-w-lg">
        <DialogHeader><DialogTitle>Create Task</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Task title *" />
          <textarea value={description} onChange={e => setDescription(e.target.value)} className={`${inputCls} min-h-[60px]`} placeholder="Description" />
          <select value={projectId} onChange={e => { setProjectId(e.target.value); setSectionId(''); setAssignedTo(''); }} className={inputCls}>
            <option value="">Select Project *</option>
            {userProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {selectedProject && (
            <select value={sectionId} onChange={e => setSectionId(e.target.value)} className={inputCls}>
              <option value="">Select Section *</option>
              {selectedProject.sections.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}
          {selectedProject && (
            <select value={assignedTo} onChange={e => setAssignedTo(e.target.value)} className={inputCls}>
              <option value="">Assign To *</option>
              {projectMembers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={inputCls} />
          <div className="flex gap-1.5">
            {(['Low', 'Medium', 'High', 'Urgent'] as Priority[]).map(p => (
              <button key={p} onClick={() => setPriority(p)}
                className={`flex-1 text-xs py-2 rounded-xl transition-colors ${priority === p ? 'bg-primary text-primary-foreground' : 'border hover:bg-muted/50'}`}
              >{p}</button>
            ))}
          </div>
          <input value={tagsStr} onChange={e => setTagsStr(e.target.value)} className={inputCls} placeholder="Tags (comma-separated)" />
          <button onClick={handleSave} className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
            Create Task
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CreateTaskModal;
