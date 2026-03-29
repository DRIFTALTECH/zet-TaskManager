import { useAppStore } from '@/stores/appStore';
import { Task, Priority, TaskStatus } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Calendar, Tag, User, Clock, AlertTriangle, Plus, X } from 'lucide-react';
import { useState, useEffect } from 'react';

interface Props {
  task: Task | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const priorityColors: Record<Priority, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-400 border-green-500/20',
};

const statusColors: Record<TaskStatus, string> = {
  backlog: 'bg-muted text-muted-foreground',
  in_progress: 'bg-blue-500/15 text-blue-400',
  in_review: 'bg-purple-500/15 text-purple-400',
  done: 'bg-green-500/15 text-green-400',
  completed: 'bg-green-500/15 text-green-400',
};

const statusLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog', in_progress: 'In Progress', in_review: 'In Review', done: 'Done', completed: 'Completed',
};

const TaskDetailModal = ({ task, open, onOpenChange }: Props) => {
  const { users, projects, updateTask, currentUser } = useAppStore();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [newFieldKey, setNewFieldKey] = useState('');
  const [newFieldValue, setNewFieldValue] = useState('');

  // Reset editing state when task changes
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description);
    }
    setEditing(false);
  }, [task?.id]);

  if (!task) return null;

  const project = projects.find(p => p.id === task.projectId);
  const section = project?.sections.find(s => s.id === task.sectionId);
  const assignee = users.find(u => u.id === task.assignedTo);
  const assigner = users.find(u => u.id === task.assignedBy);
  const isCreator = currentUser?.id === task.createdBy;

  const startEdit = () => { setTitle(task.title); setDescription(task.description); setEditing(true); };
  const saveEdit = () => {
    updateTask(task.id, { title, description });
    setEditing(false);
    toast.success('Task updated');
  };

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const isOverdue = new Date(task.dueDate) < new Date() && task.status !== 'completed';
  const customFields = task.customFields || {};

  const addCustomField = () => {
    if (!newFieldKey.trim()) return;
    const updated = { ...customFields, [newFieldKey.trim()]: newFieldValue.trim() };
    updateTask(task.id, { customFields: updated });
    setNewFieldKey('');
    setNewFieldValue('');
    toast.success('Field added');
  };

  const removeCustomField = (key: string) => {
    const updated = { ...customFields };
    delete updated[key];
    updateTask(task.id, { customFields: updated });
    toast.success('Field removed');
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <span>{project?.name}</span>
            <span className="text-border">/</span>
            <span>{section?.name}</span>
            <span className="text-border">/</span>
            <span className="font-mono">TF-{task.id.replace(/\D/g, '').padStart(3, '0')}</span>
          </div>
          <DialogTitle>
            {editing ? (
              <input value={title} onChange={e => setTitle(e.target.value)}
                className="w-full bg-muted/50 rounded-lg px-2 py-1 text-lg font-bold focus:outline-none focus:ring-2 focus:ring-primary/50" />
            ) : (
              <span onClick={startEdit} className="cursor-pointer hover:text-primary transition-colors">{task.title}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          {/* Status & Priority */}
          <div className="flex gap-2 flex-wrap">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${statusColors[task.status]}`}>
              {statusLabels[task.status]}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${priorityColors[task.priority]}`}>
              {task.priority}
            </span>
            {isOverdue && (
              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-500/15 text-red-400 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Overdue
              </span>
            )}
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            {editing ? (
              <textarea value={description} onChange={e => setDescription(e.target.value)}
                className="w-full mt-1 bg-muted/50 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px]" />
            ) : (
              <p className="text-sm mt-1 leading-relaxed cursor-pointer" onClick={startEdit}>{task.description}</p>
            )}
          </div>

          {editing && (
            <div className="flex gap-2">
              <button onClick={saveEdit} className="px-4 py-2 text-sm rounded-xl bg-primary text-primary-foreground hover:opacity-90">Save</button>
              <button onClick={() => setEditing(false)} className="px-4 py-2 text-sm rounded-xl border hover:bg-muted/50">Cancel</button>
            </div>
          )}

          {/* Details grid */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><User className="h-3 w-3" /> Assigned To</div>
              <p className="text-sm font-medium">{assignee?.name}</p>
            </div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><User className="h-3 w-3" /> Assigned By</div>
              <p className="text-sm font-medium">{assigner?.name}</p>
            </div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Calendar className="h-3 w-3" /> Due Date</div>
              <p className={`text-sm font-medium ${isOverdue ? 'text-red-400' : ''}`}>{task.dueDate}</p>
            </div>
            <div className="rounded-xl border p-3">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1"><Clock className="h-3 w-3" /> Time Tracked</div>
              <p className="text-sm font-medium">{formatTime(task.timeTracked)}</p>
            </div>
          </div>

          {/* Tags */}
          {task.tags.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2"><Tag className="h-3 w-3" /> Tags</div>
              <div className="flex gap-1.5 flex-wrap">
                {task.tags.map(tag => (
                  <span key={tag} className="text-xs px-2.5 py-1 rounded-full border bg-muted/50">{tag}</span>
                ))}
              </div>
            </div>
          )}

          {/* Custom Metadata Fields */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted-foreground">Custom Fields</span>
            </div>

            {Object.keys(customFields).length > 0 && (
              <div className="space-y-1.5 mb-3">
                {Object.entries(customFields).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2 text-sm rounded-lg border px-3 py-2">
                    <span className="font-medium text-muted-foreground min-w-[80px]">{key}</span>
                    <span className="text-foreground flex-1">{value}</span>
                    {isCreator && (
                      <button onClick={() => removeCustomField(key)} className="text-muted-foreground hover:text-red-400 transition-colors">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isCreator && (
              <div className="flex gap-2">
                <input
                  value={newFieldKey}
                  onChange={e => setNewFieldKey(e.target.value)}
                  placeholder="Key"
                  className="flex-1 bg-muted/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <input
                  value={newFieldValue}
                  onChange={e => setNewFieldValue(e.target.value)}
                  placeholder="Value"
                  className="flex-1 bg-muted/50 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <button onClick={addCustomField} className="px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Activity */}
          <div className="rounded-xl border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Activity</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>Created on {task.createdAt}</p>
              {task.startedAt && <p>Started on {task.startedAt}</p>}
              {task.completedAt && <p>Completed on {task.completedAt}</p>}
            </div>
          </div>

          {/* Priority change */}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Change Priority</label>
            <div className="flex gap-1.5 mt-1">
              {(['Low', 'Medium', 'High', 'Urgent'] as Priority[]).map(p => (
                <button key={p} onClick={() => { updateTask(task.id, { priority: p }); toast.success(`Priority changed to ${p}`); }}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${task.priority === p ? priorityColors[p] : 'border hover:bg-muted/50'}`}
                >{p}</button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default TaskDetailModal;
