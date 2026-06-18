import { useState, useRef, useEffect, useId, useCallback } from 'react';
import { useAppStore } from '@/stores/appStore';
import { api } from '@/lib/api';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUpIcon, User, Calendar, Clock, Tag, Check, Pencil,
  AlertCircle, CheckCircle2, Paperclip, ShieldOff, XCircle,
  FolderPlus, Layers, UserPlus, Info, BarChart2, Briefcase,
  TrendingUp, ListTodo, AlarmClock, Timer,
  Sparkles, Mic, Square, Upload, FileText, Type as TypeIcon, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AIChatAction, AIChatMessage, AIExtractedTask, AIProposal, AICard,
  AICardTaskData, AICardStatData, AICardProjectData, AICardTimesheetData, Priority } from '@/types';
import CreateTaskModal from '@/components/CreateTaskModal';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { snappy, pageEnter } from '@/lib/motion';
import { cn } from '@/lib/utils';

// ── Priority badge styles ──────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, string> = {
  Urgent: 'bg-red-500/15 text-red-400 border-red-500/20',
  High:   'bg-orange-500/15 text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  Low:    'bg-green-500/15 text-green-400 border-green-500/20',
};

// ── Zani Z-mark icon ──────────────────────────────────────────────────────────

function ZaniIcon({ className }: { className?: string }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <path
        d="M7 9h18M7 23h18M23.5 9L8.5 23"
        stroke={`url(#zg-${uid})`}
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id={`zg-${uid}`} x1="7" y1="9" x2="25" y2="23" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// ── Auto-resize textarea hook ─────────────────────────────────────────────────

function useAutoResizeTextarea({ minHeight, maxHeight }: { minHeight: number; maxHeight?: number }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback((reset?: boolean) => {
    const el = textareaRef.current;
    if (!el) return;
    if (reset) { el.style.height = `${minHeight}px`; return; }
    el.style.height = `${minHeight}px`;
    const newH = Math.max(minHeight, Math.min(el.scrollHeight, maxHeight ?? Infinity));
    el.style.height = `${newH}px`;
  }, [minHeight, maxHeight]);

  useEffect(() => {
    if (textareaRef.current) textareaRef.current.style.height = `${minHeight}px`;
  }, [minHeight]);

  useEffect(() => {
    const onResize = () => adjustHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [adjustHeight]);

  return { textareaRef, adjustHeight };
}

// ── Prefill shape ─────────────────────────────────────────────────────────────

export interface TaskPrefill {
  title?: string;
  description?: string;
  priority?: Priority;
  dueDate?: string;
  assigneeId?: string;
  projectId?: string;
  sectionId?: string;
  tags?: string[];
}

// ── Proposal card — handles project / section / task / member ─────────────────

function ProposalCard({
  proposal,
  onEditTask,
  onExecuted,
}: {
  proposal: AIProposal;
  onEditTask: (p: TaskPrefill) => void;
  onExecuted: () => void;
}) {
  const { createProject, addSection, createTask, addMemberToProject, currentUser } = useAppStore();
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // inline-edit state (for project / section / member)
  const [editing, setEditing] = useState(false);
  const [editName, setEditName]           = useState(proposal.name        ?? '');
  const [editDesc, setEditDesc]           = useState(proposal.description  ?? '');
  const [editSectionName, setEditSectionName] = useState(proposal.section_name ?? '');

  const handleAccept = async (overrides?: Partial<AIProposal>) => {
    setAccepting(true);
    const p = { ...proposal, ...overrides };
    try {
      switch (p.type) {
        case 'create_project':
          await createProject(p.name!, p.description ?? '');
          break;
        case 'create_section':
          await addSection(p.project_id!, p.section_name!);
          break;
        case 'create_task':
          await createTask({
            title: p.title!,
            description: p.description ?? '',
            projectId: p.project_id!,
            sectionId: p.section_id!,
            dueDate: p.due_date ?? '',
            priority: (p.priority as Priority) ?? 'Medium',
            tags: p.tags ?? [],
            assigneeIds: [p.assignee_id!],
            assignedBy: currentUser!.id,
            createdBy: currentUser!.id,
          });
          break;
        case 'add_member':
          await addMemberToProject(p.project_id!, p.user_id!);
          break;
      }
      // refresh store so the rest of the UI reflects the new item
      await useAppStore.getState().bootstrap();
      setAccepted(true);
      onExecuted();
      toast.success(successMsg(p));
    } catch (err) {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  if (accepted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={snappy}
        className="rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3 flex items-center gap-3"
      >
        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-sm font-semibold text-green-400">Done</span>
        <span className="text-sm text-muted-foreground truncate">{cardTitle(proposal)}</span>
      </motion.div>
    );
  }

  // ── Edit mode (inline, for non-task types) ────────────────────────────────
  if (editing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={snappy}
        className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 space-y-3"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-400">
          {cardIcon(proposal.type)}
          Edit {typeLabel(proposal.type)}
        </div>

        {proposal.type === 'create_project' && (
          <>
            <input
              autoFocus
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Project name"
              className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:border-violet-500/60"
            />
            <textarea
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:border-violet-500/60 resize-none"
            />
          </>
        )}

        {proposal.type === 'create_section' && (
          <input
            autoFocus
            value={editSectionName}
            onChange={e => setEditSectionName(e.target.value)}
            placeholder="Section name"
            className="w-full px-3 py-2 text-sm rounded-lg border border-border/60 bg-background focus:outline-none focus:border-violet-500/60"
          />
        )}

        {proposal.type === 'add_member' && (
          <p className="text-xs text-muted-foreground">
            Adding <span className="font-semibold text-foreground">{proposal.user_name}</span> to{' '}
            <span className="font-semibold text-foreground">{proposal.project_name}</span>.
            To change, dismiss and ask Zani again.
          </p>
        )}

        <div className="flex items-center gap-2 pt-1 border-t border-violet-500/10">
          <button
            onClick={() => {
              if (proposal.type === 'create_project') {
                void handleAccept({ name: editName, description: editDesc });
              } else if (proposal.type === 'create_section') {
                void handleAccept({ section_name: editSectionName });
              } else {
                void handleAccept();
              }
              setEditing(false);
            }}
            disabled={accepting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Confirm
          </button>
          <button
            onClick={() => setEditing(false)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-border/60 bg-muted/30 text-xs font-medium hover:bg-muted/60 transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    );
  }

  // ── Default card view ─────────────────────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={snappy}
      className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3"
    >
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="p-1.5 rounded-lg bg-violet-500/10 text-violet-400">
          {cardIcon(proposal.type)}
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-violet-400/70">
          {typeLabel(proposal.type)}
        </span>
        {proposal.type === 'create_task' && proposal.priority && (
          <span className={`ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold border ${PRIORITY_BADGE[proposal.priority] ?? PRIORITY_BADGE.Medium}`}>
            {proposal.priority}
          </span>
        )}
      </div>

      {/* Title / name */}
      <p className="text-sm font-semibold leading-snug">{cardTitle(proposal)}</p>

      {/* Description */}
      {(proposal.description || proposal.type === 'create_project') && proposal.description && (
        <p className="text-xs text-muted-foreground leading-relaxed">{proposal.description}</p>
      )}

      {/* Meta row */}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {proposal.type === 'create_section' && proposal.project_name && (
          <span className="flex items-center gap-1.5"><Tag className="h-3 w-3" /> {proposal.project_name}</span>
        )}
        {proposal.type === 'create_task' && (
          <>
            {proposal.assignee_name && (
              <span className="flex items-center gap-1.5"><User className="h-3 w-3" /> {proposal.assignee_name}</span>
            )}
            {proposal.project_name && (
              <span className="flex items-center gap-1.5">
                <Tag className="h-3 w-3" /> {proposal.project_name}
                {proposal.section_name && <span className="opacity-60"> / {proposal.section_name}</span>}
              </span>
            )}
            {proposal.due_date && (
              <span className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> {proposal.due_date}</span>
            )}
          </>
        )}
        {proposal.type === 'add_member' && (
          <>
            <span className="flex items-center gap-1.5"><User className="h-3 w-3" /> {proposal.user_name}</span>
            <span className="flex items-center gap-1.5"><Tag className="h-3 w-3" /> {proposal.project_name}</span>
          </>
        )}
      </div>

      {/* Tags */}
      {proposal.type === 'create_task' && proposal.tags && proposal.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {proposal.tags.map(tag => (
            <span key={tag} className="px-2 py-0.5 rounded-full bg-muted/50 text-[10px] text-muted-foreground">{tag}</span>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1 border-t border-violet-500/10">
        <button
          onClick={() => {
            if (proposal.type === 'create_task') {
              onEditTask({
                title: proposal.title,
                description: proposal.description ?? undefined,
                priority: (proposal.priority as Priority) ?? undefined,
                dueDate: proposal.due_date ?? undefined,
                assigneeId: proposal.assignee_id ?? undefined,
                projectId: proposal.project_id ?? undefined,
                sectionId: proposal.section_id ?? undefined,
                tags: proposal.tags,
              });
            } else {
              setEditing(true);
            }
          }}
          disabled={accepting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-border/60 bg-muted/30 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
        <button
          onClick={() => void handleAccept()}
          disabled={accepting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" />
          {accepting ? 'Creating…' : 'Accept'}
        </button>
      </div>
    </motion.div>
  );
}

// Card helpers
function typeLabel(type: AIProposal['type']) {
  return { create_project: 'New project', create_section: 'New section', create_task: 'New task', add_member: 'Add member' }[type] ?? type;
}
function cardTitle(p: AIProposal) {
  if (p.type === 'create_project') return p.name ?? 'Unnamed project';
  if (p.type === 'create_section') return p.section_name ?? 'Unnamed section';
  if (p.type === 'create_task')    return p.title ?? 'Unnamed task';
  if (p.type === 'add_member')     return `Add ${p.user_name ?? 'user'} to ${p.project_name ?? 'project'}`;
  return '';
}
function cardIcon(type: AIProposal['type']) {
  if (type === 'create_project') return <FolderPlus className="h-3.5 w-3.5" />;
  if (type === 'create_section') return <Layers className="h-3.5 w-3.5" />;
  if (type === 'create_task')    return <Clock className="h-3.5 w-3.5" />;
  if (type === 'add_member')     return <UserPlus className="h-3.5 w-3.5" />;
  return null;
}
function successMsg(p: AIProposal) {
  if (p.type === 'create_project') return `Project "${p.name}" created!`;
  if (p.type === 'create_section') return `Section "${p.section_name}" created!`;
  if (p.type === 'create_task')    return `Task "${p.title}" created!`;
  if (p.type === 'add_member')     return `${p.user_name} added to ${p.project_name}!`;
  return 'Done!';
}

// ── Extracted task card (non-agentic suggestions) ─────────────────────────────

function ExtractedTaskCard({ task, onEdit }: { task: AIExtractedTask; onEdit: (p: TaskPrefill) => void }) {
  const { users, projects, currentUser, createTask } = useAppStore();
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);

  const assignee = task.assignee_id ? users.find(u => u.id === task.assignee_id) : null;
  const project  = task.project_id  ? projects.find(p => p.id === task.project_id) : null;
  const section  = task.section_id  ? project?.sections?.find(s => s.id === task.section_id) ?? null : null;

  const prefill: TaskPrefill = {
    title: task.title ?? undefined,
    description: task.description ?? undefined,
    priority: (task.priority as Priority) ?? undefined,
    dueDate: task.due_date ?? undefined,
    assigneeId: task.assignee_id ?? undefined,
    projectId: task.project_id ?? undefined,
    sectionId: task.section_id ?? undefined,
    tags: task.tags,
  };

  const canAccept = !!task.title && !!task.project_id && !!task.section_id && !!task.assignee_id;

  const handleAccept = async () => {
    if (!currentUser) return;
    if (!canAccept) { toast.info('Some fields are missing — use Edit.'); onEdit(prefill); return; }
    setAccepting(true);
    try {
      await createTask({
        title: task.title,
        description: task.description ?? '',
        projectId: task.project_id!,
        sectionId: task.section_id!,
        dueDate: task.due_date ?? '',
        priority: (task.priority as Priority) ?? 'Medium',
        tags: task.tags ?? [],
        assigneeIds: [task.assignee_id!],
        assignedBy: currentUser.id,
        createdBy: currentUser.id,
      });
      setAccepted(true);
      toast.success(`"${task.title}" created!`);
    } catch (err) {
      toast.error('Could not create the task. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  if (accepted) {
    return (
      <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={snappy}
        className="rounded-xl border border-green-500/20 bg-green-500/5 px-4 py-3 flex items-center gap-3">
        <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-sm font-semibold text-green-400">Created</span>
        <span className="text-sm text-muted-foreground truncate">{task.title}</span>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 space-y-3">
      <div className="flex items-start gap-2 min-w-0">
        {task.priority && (
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0 mt-0.5 ${PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.Medium}`}>
            {task.priority}
          </span>
        )}
        <span className="text-sm font-semibold leading-snug">{task.title}</span>
      </div>
      {task.description && <p className="text-xs text-muted-foreground leading-relaxed">{task.description}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground">
        {assignee && <span className="flex items-center gap-1.5"><User className="h-3 w-3" /> {assignee.name}</span>}
        {project && (
          <span className="flex items-center gap-1.5">
            <Tag className="h-3 w-3" /> {project.name}
            {(section || task.section_name) && <span className="opacity-60"> / {section?.name ?? task.section_name}</span>}
          </span>
        )}
        {task.due_date && <span className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> {task.due_date}</span>}
      </div>
      {task.suggest_create_section && (
        <p className="text-[11px] text-amber-400 flex items-center gap-1.5">
          <span>⚠</span> No suitable section found — consider creating one first.
        </p>
      )}
      <div className="flex items-center gap-2 pt-1 border-t border-violet-500/10">
        <button onClick={handleAccept} disabled={accepting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 transition-colors disabled:opacity-50">
          <Check className="h-3.5 w-3.5" />
          {accepting ? 'Creating…' : 'Accept'}
        </button>
        <button onClick={() => onEdit(prefill)} disabled={accepting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-border/60 bg-muted/30 text-xs font-medium hover:bg-muted/60 transition-colors disabled:opacity-50">
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      </div>
    </motion.div>
  );
}

// ── Personal Agent Card Components ───────────────────────────────────────────

const PRIORITY_DOT: Record<string, string> = {
  Urgent: 'bg-red-400',
  High:   'bg-orange-400',
  Medium: 'bg-yellow-400',
  Low:    'bg-green-400',
};

function AgentTaskCard({ data }: { data: AICardTaskData }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className={`rounded-xl border p-3 space-y-1.5 ${data.is_overdue ? 'border-red-500/25 bg-red-500/5' : 'border-border/40 bg-card/60'}`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[data.priority] ?? 'bg-muted-foreground'}`} />
        <p className="text-sm font-semibold leading-snug flex-1">{data.title}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold shrink-0 ${PRIORITY_BADGE[data.priority] ?? PRIORITY_BADGE.Medium}`}>
          {data.priority}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground pl-4">
        <span className="flex items-center gap-1">
          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${
            data.is_overdue ? 'bg-red-500/15 text-red-400 border-red-500/20' : 'bg-muted/50 text-muted-foreground border-border/40'
          }`}>{data.is_overdue ? '⚠ Overdue' : data.status}</span>
        </span>
        {data.due_date && (
          <span className={`flex items-center gap-1 ${data.is_overdue ? 'text-red-400' : ''}`}>
            <Calendar className="h-3 w-3" /> {data.due_date}
          </span>
        )}
        {data.project_name && (
          <span className="flex items-center gap-1">
            <Tag className="h-3 w-3" /> {data.project_name}
            {data.section_name && <span className="opacity-60">/ {data.section_name}</span>}
          </span>
        )}
      </div>
    </motion.div>
  );
}

function AgentStatCard({ data }: { data: AICardStatData }) {
  const stats = [
    { label: 'Assigned', value: data.assigned_total, icon: <ListTodo className="h-4 w-4" />, color: 'text-violet-400 bg-violet-500/10' },
    { label: 'In Progress', value: data.in_progress, icon: <Timer className="h-4 w-4" />, color: 'text-blue-400 bg-blue-500/10' },
    { label: 'Done this week', value: data.completed_this_week, icon: <CheckCircle2 className="h-4 w-4" />, color: 'text-green-400 bg-green-500/10' },
    { label: 'Overdue', value: data.overdue, icon: <AlarmClock className="h-4 w-4" />, color: data.overdue > 0 ? 'text-red-400 bg-red-500/10' : 'text-muted-foreground bg-muted/30' },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className="rounded-xl border border-border/40 bg-card/60 p-4"
    >
      <div className="flex items-center gap-1.5 mb-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <BarChart2 className="h-3.5 w-3.5" /> My Stats
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl px-3 py-2.5 flex items-center gap-2.5 ${s.color}`}>
            {s.icon}
            <div>
              <p className="text-xl font-bold tabular-nums leading-none">{s.value}</p>
              <p className="text-[11px] opacity-70 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

function AgentProjectCard({ data }: { data: AICardProjectData }) {
  const pct = data.total_tasks > 0 ? Math.round((data.completed_tasks / data.total_tasks) * 100) : 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className="rounded-xl border border-border/40 bg-card/60 p-3 space-y-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="p-1.5 rounded-lg bg-violet-500/10">
            <Briefcase className="h-3.5 w-3.5 text-violet-400" />
          </span>
          <p className="text-sm font-semibold truncate">{data.name}</p>
        </div>
        <span className="text-[11px] text-muted-foreground shrink-0">{data.section_count} section{data.section_count !== 1 ? 's' : ''}</span>
      </div>
      {data.description && (
        <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 pl-8">{data.description}</p>
      )}
      {data.total_tasks > 0 && (
        <div className="pl-8 space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{data.completed_tasks}/{data.total_tasks} my tasks done</span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {data.total_tasks === 0 && (
        <p className="text-[11px] text-muted-foreground/50 pl-8 italic">No tasks assigned in this project yet.</p>
      )}
    </motion.div>
  );
}

function AgentTimesheetCard({ data }: { data: AICardTimesheetData }) {
  const maxH = Math.max(...data.by_project.map(p => p.hours), 1);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className="rounded-xl border border-border/40 bg-card/60 p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          <TrendingUp className="h-3.5 w-3.5" /> This Week's Timesheet
        </div>
        <div className="text-right">
          <p className="text-lg font-bold tabular-nums text-foreground">{data.total_hours}h</p>
          <p className="text-[10px] text-muted-foreground">{data.total_entries} entries · {data.week_start} – {data.week_end}</p>
        </div>
      </div>
      {data.by_project.length > 0 && (
        <div className="space-y-1.5">
          {data.by_project.map(p => (
            <div key={p.project_name} className="space-y-0.5">
              <div className="flex justify-between text-[11px]">
                <span className="font-medium text-foreground/80 truncate">{p.project_name}</span>
                <span className="tabular-nums text-muted-foreground shrink-0 ml-2">{p.hours}h</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div className="h-full rounded-full bg-violet-500/70 transition-all" style={{ width: `${(p.hours / maxH) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function AgentCardRenderer({ card }: { card: AICard }) {
  if (card.type === 'task')               return <AgentTaskCard data={card.data as AICardTaskData} />;
  if (card.type === 'stat')               return <AgentStatCard data={card.data as AICardStatData} />;
  if (card.type === 'project')            return <AgentProjectCard data={card.data as AICardProjectData} />;
  if (card.type === 'timesheet_summary')  return <AgentTimesheetCard data={card.data as AICardTimesheetData} />;
  return null;
}

// ── Message bubble ────────────────────────────────────────────────────────────

const TOOL_LABELS: Record<string, string> = {
  create_project:             'Proposed project',
  create_section:             'Proposed section',
  create_task:                'Proposed task',
  add_member_to_project:      'Proposed member',
  list_projects:              'Fetched projects',
  list_users:                 'Fetched users',
  get_my_tasks:               'Fetched your tasks',
  get_my_tasks_due_today:     'Fetched due-today tasks',
  get_my_overdue_tasks:       'Fetched overdue tasks',
  get_my_stats:               'Fetched your stats',
  get_my_timesheet_this_week: 'Fetched timesheet',
  get_my_projects:            'Fetched your projects',
};

// Tools whose result is shown as cards — hide the action badge
const DATA_TOOLS = new Set([
  'get_my_tasks', 'get_my_tasks_due_today', 'get_my_overdue_tasks',
  'get_my_stats', 'get_my_timesheet_this_week', 'get_my_projects',
]);

interface DisplayMessage {
  role: 'user' | 'assistant';
  content: string;
  tasks?: AIExtractedTask[];
  actions?: AIChatAction[];
  proposals?: AIProposal[];
  cards?: AICard[];
  loading?: boolean;
}

function ActionBadge({ action }: { action: AIChatAction }) {
  const label = TOOL_LABELS[action.tool] ?? action.tool;

  if (action.status === 'already_exists') {
    return (
      <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={snappy}
        className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span><span className="font-semibold">Already exists:</span> {action.summary}</span>
      </motion.div>
    );
  }
  if (action.status === 'proposed') {
    // proposal cards are shown separately; skip badge for these
    return null;
  }
  if (action.status === 'error') {
    // Internal tool errors are for the agent only — never show in the UI
    return null;
  }
  if (action.status === 'success') {
    return (
      <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={snappy}
        className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span><span className="font-semibold">{label}:</span> {action.summary}</span>
      </motion.div>
    );
  }
  if (action.status === 'denied') {
    return (
      <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={snappy}
        className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400">
        <ShieldOff className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span><span className="font-semibold">Access denied:</span> {action.summary}</span>
      </motion.div>
    );
  }
  return (
    <motion.div initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={snappy}
      className="flex items-start gap-2 text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400">
      <XCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span><span className="font-semibold">Error:</span> {action.summary}</span>
    </motion.div>
  );
}

function MessageBubble({
  msg,
  onEditTask,
}: {
  msg: DisplayMessage;
  onEditTask: (p: TaskPrefill) => void;
}) {
  const isUser = msg.role === 'user';
  const [executed, setExecuted] = useState<Set<number>>(new Set());

  // filter: skip list_* / data tool badges, and internal tool errors
  const visibleActions = (msg.actions ?? []).filter(
    a => a.status !== 'error'
      && !((['list_projects', 'list_users'].includes(a.tool) && ['success', 'proposed'].includes(a.status))
      || (DATA_TOOLS.has(a.tool) && a.status === 'data'))
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={snappy}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${
        isUser ? 'bg-primary text-primary-foreground' : 'bg-violet-500/10 border border-violet-500/20'
      }`}>
        {isUser ? <User className="h-3.5 w-3.5" /> : <ZaniIcon className="h-[18px] w-[18px]" />}
      </div>

      {/* Content */}
      <div className={`flex flex-col gap-2 max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground">
            <span className="whitespace-pre-wrap">{msg.content}</span>
          </div>
        ) : (
          <div className="text-sm leading-relaxed text-foreground py-0.5">
            {msg.loading ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.span key={i} className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full"
                      animate={{ y: [0, -4, 0] }}
                      transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.15 }} />
                  ))}
                </span>
                Working on it…
              </span>
            ) : (
              <span className="whitespace-pre-wrap">{msg.content}</span>
            )}
          </div>
        )}

        {/* Action badges (already_exists / denied / error) */}
        {visibleActions.length > 0 && (
          <div className="w-full space-y-1.5">
            {visibleActions.map((action, i) => (
              <ActionBadge key={i} action={action} />
            ))}
          </div>
        )}

        {/* Proposal cards (project / section / task / member) */}
        {msg.proposals && msg.proposals.length > 0 && (
          <div className="w-full space-y-2">
            {msg.proposals.map((p, i) => (
              !executed.has(i) && (
                <ProposalCard
                  key={i}
                  proposal={p}
                  onEditTask={onEditTask}
                  onExecuted={() => setExecuted(prev => new Set([...prev, i]))}
                />
              )
            ))}
          </div>
        )}

        {/* Personal agent data cards (tasks, stats, projects, timesheet) */}
        {msg.cards && msg.cards.length > 0 && (
          <div className="w-full space-y-2">
            {msg.cards.map((card, i) => (
              <AgentCardRenderer key={i} card={card} />
            ))}
          </div>
        )}

        {/* Suggestion task cards (non-agentic flow) */}
        {msg.tasks && msg.tasks.length > 0 && (
          <div className="w-full space-y-2">
            {msg.tasks.map((task, i) => (
              <ExtractedTaskCard key={i} task={task} onEdit={onEditTask} />
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ── Suggestion chips ──────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What tasks are due today?",
  "Show me my stats for this week",
  "What are my overdue tasks?",
  "How many hours did I log this week?",
  "What projects am I working on?",
  "Create a task to fix the login bug, assign to the first team member, high priority",
];

// ── v0-style chat input ───────────────────────────────────────────────────────

function ZaniInput({
  value, onChange, onSend, loading, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  loading: boolean;
  autoFocus?: boolean;
}) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({ minHeight: 60, maxHeight: 200 });

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus, textareaRef]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !loading) onSend();
    }
  };

  const active = value.trim().length > 0 && !loading;

  return (
    <div className="relative rounded-2xl border border-border/70 bg-card shadow-sm overflow-hidden">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={e => { onChange(e.target.value); adjustHeight(); }}
        onKeyDown={handleKeyDown}
        placeholder="Tell Zani what needs to be done…"
        disabled={loading}
        className={cn(
          'w-full px-4 pt-4 pb-2',
          'resize-none bg-transparent',
          'text-sm text-foreground',
          'focus:outline-none',
          'placeholder:text-muted-foreground/50',
          'min-h-[60px]',
          'disabled:opacity-60',
        )}
        style={{ overflow: 'hidden' }}
      />
      <div className="flex items-center justify-between px-3 pb-3 pt-1">
        <div className="flex items-center gap-1">
          <button type="button" tabIndex={-1}
            className="group p-2 hover:bg-muted/60 rounded-lg transition-colors flex items-center gap-1 text-muted-foreground">
            <Paperclip className="w-4 h-4" />
            <span className="text-xs hidden group-hover:inline">Attach</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground/40 hidden sm:inline">
            Enter to send · Shift+Enter for new line
          </span>
          <button type="button" onClick={onSend} disabled={!active}
            className={cn(
              'p-1.5 rounded-lg transition-all',
              active ? 'bg-violet-600 text-white hover:bg-violet-500' : 'bg-muted text-muted-foreground opacity-40 cursor-not-allowed',
            )}>
            <ArrowUpIcon className="w-4 h-4" />
            <span className="sr-only">Send</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

// ── Task-creation chain: type / document / voice / record → extract → tasks ─────

type ExtractMode = 'text' | 'document' | 'voice' | 'record';

export function TaskCreatorModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [editPrefill, setEditPrefill] = useState<TaskPrefill | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const onEditTask = (p: TaskPrefill) => { setEditPrefill(p); setEditOpen(true); onOpenChange(false); };
  const [mode, setMode] = useState<ExtractMode>('text');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AIExtractedTask[] | null>(null);
  const [sourceText, setSourceText] = useState('');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  const reset = () => {
    setText(''); setFile(null); setRecordedBlob(null); setRecording(false);
    setResults(null); setSourceText('');
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mr.onstop = () => {
        setRecordedBlob(new Blob(chunksRef.current, { type: mr.mimeType || 'audio/webm' }));
        stream.getTracks().forEach(t => t.stop());
      };
      mr.start();
      recorderRef.current = mr;
      setRecording(true);
    } catch {
      toast.error('Could not access the microphone.');
    }
  };
  const stopRecording = () => { recorderRef.current?.stop(); setRecording(false); };

  const canExtract =
    (mode === 'text' && text.trim().length > 0) ||
    ((mode === 'document' || mode === 'voice') && !!file) ||
    (mode === 'record' && !!recordedBlob && !recording);

  const extract = async () => {
    setLoading(true);
    try {
      const fd = new FormData();
      if (mode === 'text') fd.append('text', text.trim());
      else if ((mode === 'document' || mode === 'voice') && file) fd.append('file', file, file.name);
      else if (mode === 'record' && recordedBlob) fd.append('file', recordedBlob, 'recording.webm');
      const res = await api.aiExtractTasks(fd);
      setResults(res.tasks);
      setSourceText(res.sourceText || '');
      if (res.tasks.length === 0) toast.info('No tasks found in that input.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not extract tasks');
    } finally {
      setLoading(false);
    }
  };

  const TABS: { id: ExtractMode; label: string; icon: typeof TypeIcon }[] = [
    { id: 'text', label: 'Type', icon: TypeIcon },
    { id: 'document', label: 'Document', icon: FileText },
    { id: 'voice', label: 'Voice file', icon: Upload },
    { id: 'record', label: 'Record', icon: Mic },
  ];

  return (
    <>
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="rounded-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Sparkles className="h-4 w-4 text-violet-400" /> Create tasks with AI
          </DialogTitle>
        </DialogHeader>

        {results === null ? (
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground/70">
              Describe the work, upload a document, or record your voice — Zani extracts the tasks and suggests who to assign.
            </p>

            {/* Mode tabs */}
            <div className="flex gap-1 rounded-xl border border-border/50 bg-muted/30 p-1">
              {TABS.map(t => (
                <button key={t.id} onClick={() => setMode(t.id)}
                  className={cn('flex-1 flex items-center justify-center gap-1.5 px-2 py-2 rounded-lg text-xs font-semibold transition-colors',
                    mode === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  <t.icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              ))}
            </div>

            {mode === 'text' && (
              <textarea autoFocus value={text} onChange={e => setText(e.target.value)} rows={8}
                placeholder="e.g. Build the login page by Friday — assign to Lokesh. Also Bharath should write API tests, high priority."
                className="w-full px-3.5 py-3 text-sm rounded-xl border border-border/60 bg-background/60 focus:outline-none focus:border-violet-500/50 resize-y leading-relaxed" />
            )}

            {(mode === 'document' || mode === 'voice') && (
              <label className="flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-border/50 hover:border-violet-500/40 cursor-pointer transition-colors">
                {mode === 'document' ? <FileText className="h-7 w-7 text-muted-foreground/40" /> : <Upload className="h-7 w-7 text-muted-foreground/40" />}
                <span className="text-sm text-muted-foreground/70">{file ? file.name : (mode === 'document' ? 'Choose a document (.pdf .docx .txt .md)' : 'Choose an audio file')}</span>
                <input type="file" className="hidden"
                  accept={mode === 'document' ? '.pdf,.docx,.txt,.md,.csv' : 'audio/*'}
                  onChange={e => setFile(e.target.files?.[0] ?? null)} />
              </label>
            )}

            {mode === 'record' && (
              <div className="flex flex-col items-center justify-center gap-3 py-8 rounded-xl border border-border/50 bg-muted/20">
                {recording ? (
                  <button onClick={stopRecording} className="flex items-center gap-2 px-5 py-3 rounded-full bg-red-500 text-white font-semibold animate-pulse">
                    <Square className="h-4 w-4" /> Stop recording
                  </button>
                ) : (
                  <button onClick={() => void startRecording()} className="flex items-center gap-2 px-5 py-3 rounded-full bg-violet-600 text-white font-semibold hover:bg-violet-500 transition-colors">
                    <Mic className="h-4 w-4" /> {recordedBlob ? 'Record again' : 'Start recording'}
                  </button>
                )}
                {recordedBlob && !recording && <span className="text-xs text-emerald-400">Recording ready — extract below.</span>}
              </div>
            )}

            <div className="flex justify-end">
              <button onClick={() => void extract()} disabled={!canExtract || loading}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-semibold hover:bg-violet-500 transition-colors disabled:opacity-40">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? 'Extracting…' : 'Extract tasks'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{results.length} task{results.length !== 1 ? 's' : ''} found</p>
              <button onClick={() => setResults(null)} className="text-xs text-violet-400 hover:underline">← Back to input</button>
            </div>
            {sourceText && (
              <details className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
                <summary className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wide cursor-pointer">Source text</summary>
                <p className="mt-2 text-xs text-muted-foreground/70 whitespace-pre-wrap max-h-40 overflow-y-auto">{sourceText}</p>
              </details>
            )}
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground/50 italic py-6 text-center">No tasks detected. Try adding more detail.</p>
            ) : (
              <div className="space-y-3">
                {results.map((t, i) => (
                  <ExtractedTaskCard key={i} task={t} onEdit={p => { onEditTask(p); onOpenChange(false); }} />
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
    <CreateTaskModal
      open={editOpen}
      onOpenChange={o => { setEditOpen(o); if (!o) setEditPrefill(null); }}
      prefill={editPrefill ?? undefined}
    />
    </>
  );
}

const AIPage = () => {
  const { users, projects, currentUser } = useAppStore();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [prefill, setPrefill] = useState<TaskPrefill | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const userRefs = users.map(u => ({
    id: u.id, name: u.name,
    job_title: u.jobTitle ?? '',
    current_experience_months: u.currentExperienceMonths ?? 0,
  }));
  const projectRefs = projects.map(p => ({
    id: p.id, name: p.name,
    sections: (p.sections ?? []).map(s => ({ id: s.id, name: s.name })),
  }));

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: DisplayMessage = { role: 'user', content: text.trim() };
    const loadMsg: DisplayMessage = { role: 'assistant', content: '', loading: true };
    setMessages(prev => [...prev, userMsg, loadMsg]);
    setInput('');
    setLoading(true);
    // Clean history: text only (no cards/proposals), max last 6 turns (12 msgs) + current user msg
    const allClean: AIChatMessage[] = [...messages, userMsg]
      .filter(m => !m.loading && m.content.trim().length > 0)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
    const MAX_TURNS = 6;
    const prior = allClean.slice(0, -1).slice(-(MAX_TURNS * 2)); // last 12 history msgs
    const history: AIChatMessage[] = [...prior, allClean[allClean.length - 1]]; // + current user msg
    try {
      const res = await api.aiChat(history, userRefs, projectRefs);
      setMessages(prev => [
        ...prev.slice(0, -1),
        {
          role: 'assistant',
          content: res.message,
          tasks: res.tasks,
          actions: res.actions ?? [],
          proposals: res.proposals ?? [],
          cards: res.cards ?? [],
        },
      ]);
      // Only refresh store if the agent executed something directly (e.g. list tools)
      const agentActedDirectly = (res.actions ?? []).some(a => a.status === 'success');
      if (agentActedDirectly) {
        await useAppStore.getState().bootstrap();
      }
    } catch (err) {
      setMessages(prev => prev.slice(0, -1));
      toast.error('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleEditTask = (p: TaskPrefill) => { setPrefill(p); setCreateOpen(true); };
  const isEmpty = messages.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}
      className="flex flex-col h-[calc(100dvh-4rem)] min-h-0"
    >
      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="flex-1 flex flex-col items-center justify-center px-4">
          <div className="w-full max-w-2xl flex flex-col items-center gap-8">
            <div className="flex flex-col items-center text-center">
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
                What needs to be done?
              </h1>
            </div>

            <div className="w-full space-y-3">
              <ZaniInput value={input} onChange={setInput} onSend={() => void sendMessage(input)} loading={loading} autoFocus />
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s, i) => (
                  <button key={i} onClick={() => void sendMessage(s)}
                    className="px-3 py-1.5 rounded-full border border-border/50 bg-card/60 hover:bg-card hover:border-violet-500/30 text-xs text-muted-foreground hover:text-foreground transition-all">
                    {s.length > 48 ? s.slice(0, 46) + '…' : s}
                  </button>
                ))}
              </div>
              {!users.length && (
                <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  No team members loaded — Zani won't be able to assign tasks.
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground/40 text-center">
              Zani uses AI · please verify results
            </p>
          </div>
        </div>
      )}

      {/* ── Message list ── */}
      {!isEmpty && (
        <div className="flex-1 overflow-auto min-h-0 px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <MessageBubble key={i} msg={msg} onEditTask={handleEditTask} />
              ))}
            </AnimatePresence>
            <div ref={bottomRef} />
          </div>
        </div>
      )}

      {/* ── Input bar (chat mode) ── */}
      {!isEmpty && (
        <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur px-4 py-3">
          <div className="max-w-3xl mx-auto space-y-1.5">
            <ZaniInput value={input} onChange={setInput} onSend={() => void sendMessage(input)} loading={loading} autoFocus />
            <p className="text-center text-[10px] text-muted-foreground/40">
              Zani uses AI · please verify results
            </p>
          </div>
        </div>
      )}

      <CreateTaskModal
        open={createOpen}
        onOpenChange={o => { setCreateOpen(o); if (!o) setPrefill(null); }}
        prefill={prefill ?? undefined}
      />
    </motion.div>
  );
};

export default AIPage;
