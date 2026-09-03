import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import type { Priority, UserStory } from '@/types';
import AssigneeMultiSelect from '@/components/AssigneeMultiSelect';
import { SprintSelect } from '@/components/SprintSelect';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const PRIORITIES: Priority[] = ['Low', 'Medium', 'High', 'Urgent'];

export function CreateUserStoryDialog({
  open,
  onOpenChange,
  projectId: lockedProjectId,
  initialStatus,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When set, project is locked. When empty, user picks one. */
  projectId?: string | null;
  initialStatus?: string;
  onCreated: (s: UserStory) => void;
}) {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const users = useAppStore(s => s.users);
  const userProjects = currentUser ? projects.filter(p => currentUser.projectIds.includes(p.id)) : [];

  const [manualProjectId, setManualProjectId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [acceptance, setAcceptance] = useState('');
  const [priority, setPriority] = useState<Priority>('Medium');
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [dueDate, setDueDate] = useState('');
  const [sprint, setSprint] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const projectId = (lockedProjectId || manualProjectId).trim();
  const selectedProject = projects.find(p => p.id === projectId);
  const members = selectedProject
    ? users.filter(u => selectedProject.members.includes(u.id)).sort((a, b) => a.name.localeCompare(b.name))
    : [];

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setAcceptance('');
    setPriority('Medium');
    setDueDate('');
    setSprint('');
    setPendingFiles([]);
    setManualProjectId(lockedProjectId || '');
    const pid = lockedProjectId || '';
    const proj = projects.find(p => p.id === pid);
    const self = currentUser?.id;
    const canSelf = !!(self && proj?.members.includes(self));
    setAssigneeIds(new Set(canSelf ? [self] : []));
  }, [open, lockedProjectId, currentUser?.id, projects]);

  useEffect(() => {
    if (!open || lockedProjectId) return;
    const self = currentUser?.id;
    const proj = projects.find(p => p.id === manualProjectId);
    if (self && proj?.members.includes(self)) {
      setAssigneeIds(prev => (prev.size === 0 ? new Set([self]) : prev));
    }
  }, [open, lockedProjectId, manualProjectId, currentUser?.id, projects]);

  const submit = async () => {
    if (!title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!projectId) {
      toast.error('Choose a project');
      return;
    }
    setSaving(true);
    try {
      const story = await api.createUserStory({
        projectId,
        title: title.trim(),
        description,
        acceptanceCriteria: acceptance,
        priority,
        status: initialStatus || 'backlog',
        assigneeIds: [...assigneeIds],
        dueDate: dueDate || null,
        sprint: sprint.trim(),
      });
      for (const file of pendingFiles) {
        try {
          await api.uploadUserStoryAttachment(story.id, file);
        } catch {
          toast.error(`Could not upload ${file.name}`);
        }
      }
      toast.success('User story created');
      onCreated(story);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New user story</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {!lockedProjectId && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Project <span className="text-destructive">*</span>
              </label>
              <Select value={manualProjectId || undefined} onValueChange={setManualProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose project" />
                </SelectTrigger>
                <SelectContent>
                  {userProjects.map(p => (
                    <SelectItem key={p.id} value={p.id}>{projectPickerLabel(p)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="As a user, I want…" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">
              Description (markdown / pasted specs OK)
            </label>
            <Textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={6}
              placeholder="Paste requirements, meeting notes, client specs…"
              className="font-mono text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Attachments (drag & drop or browse)
            </label>
            <div
              onDragOver={e => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setDragOver(false);
                const files = Array.from(e.dataTransfer.files || []);
                if (files.length) setPendingFiles(prev => [...prev, ...files]);
              }}
              className={`rounded-md border border-dashed px-3 py-3 text-center text-[11px] ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border/40 text-muted-foreground/50'
              }`}
            >
              Drop files here
              <label className="ml-2 text-primary cursor-pointer underline">
                browse
                <input
                  type="file"
                  className="sr-only"
                  multiple
                  onChange={e => {
                    const files = Array.from(e.target.files || []);
                    if (files.length) setPendingFiles(prev => [...prev, ...files]);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {pendingFiles.length > 0 && (
              <ul className="mt-1 text-[11px] space-y-0.5">
                {pendingFiles.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex justify-between gap-2">
                    <span className="truncate">{f.name}</span>
                    <button
                      type="button"
                      className="text-red-600 dark:text-red-400"
                      onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Acceptance criteria</label>
            <Textarea
              value={acceptance}
              onChange={e => setAcceptance(e.target.value)}
              rows={3}
              placeholder="Given / When / Then…"
              className="font-mono text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select value={priority} onValueChange={v => setPriority(v as Priority)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map(p => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Due date</label>
              <Input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Sprint</label>
            <SprintSelect value={sprint} onChange={setSprint} projectId={projectId || null} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">Assignees</label>
            {projectId ? (
              <AssigneeMultiSelect members={members} selectedIds={assigneeIds} onChange={setAssigneeIds} />
            ) : (
              <p className="text-xs text-muted-foreground">Pick a project first.</p>
            )}
          </div>
          <Button type="button" className="w-full" disabled={saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create user story
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
