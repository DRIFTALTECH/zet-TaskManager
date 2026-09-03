/**
 * Zani chat cards — proposals, extracted tasks, personal data cards.
 */

import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  User, Calendar, Clock, Tag, Check, Pencil, CheckCircle2, ShieldOff,
  FolderPlus, Layers, UserPlus, Info, BarChart2, Briefcase, TrendingUp,
  ListTodo, AlarmClock, Timer,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { snappy } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type {
  AIChatAction, AIExtractedTask, AIProposal, AICard,
  AICardTaskData, AICardStatData, AICardProjectData, AICardTimesheetData, Priority,
} from '@/types';
import { DATA_TOOLS, TOOL_LABELS } from './constants';

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

const PRIORITY_BADGE: Record<string, string> = {
  Urgent: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/20',
  High: 'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/20',
  Medium: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
  Low: 'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/20',
};

const PRIORITY_DOT: Record<string, string> = {
  Urgent: 'bg-red-400',
  High: 'bg-orange-400',
  Medium: 'bg-yellow-400',
  Low: 'bg-green-400',
};

function typeLabel(type: AIProposal['type']) {
  return {
    create_project: 'New project',
    create_section: 'New section',
    create_task: 'New task',
    add_member: 'Add member',
  }[type] ?? type;
}

function cardTitle(p: AIProposal) {
  if (p.type === 'create_project') return p.name ?? 'Unnamed project';
  if (p.type === 'create_section') return p.section_name ?? 'Unnamed section';
  if (p.type === 'create_task') return p.title ?? 'Unnamed task';
  if (p.type === 'add_member') return `Add ${p.user_name ?? 'user'} to ${p.project_name ?? 'project'}`;
  return '';
}

function cardIcon(type: AIProposal['type']) {
  if (type === 'create_project') return <FolderPlus className="h-3.5 w-3.5" />;
  if (type === 'create_section') return <Layers className="h-3.5 w-3.5" />;
  if (type === 'create_task') return <Clock className="h-3.5 w-3.5" />;
  if (type === 'add_member') return <UserPlus className="h-3.5 w-3.5" />;
  return null;
}

function successMsg(p: AIProposal) {
  if (p.type === 'create_project') return `Project "${p.name}" created!`;
  if (p.type === 'create_section') return `Section "${p.section_name}" created!`;
  if (p.type === 'create_task') return `Task "${p.title}" created!`;
  if (p.type === 'add_member') return `${p.user_name} added to ${p.project_name}!`;
  return 'Done!';
}

export function ProposalCard({
  proposal,
  onEditTask,
  onExecuted,
}: {
  proposal: AIProposal;
  onEditTask: (p: TaskPrefill) => void;
  onExecuted: () => void;
}) {
  const { createClient, createProject, addSection, addMemberToProject } = useAppStore();
  const [accepted, setAccepted] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(proposal.name ?? '');
  const [editDesc, setEditDesc] = useState(proposal.description ?? '');
  const [editSectionName, setEditSectionName] = useState(proposal.section_name ?? '');

  const handleAccept = async (overrides?: Partial<AIProposal>) => {
    setAccepting(true);
    const p = { ...proposal, ...overrides };
    try {
      switch (p.type) {
        case 'create_project': {
          const client = await createClient('General');
          await createProject(p.name!, p.description ?? '', client.id);
          break;
        }
        case 'create_section':
          await addSection(p.project_id!, p.section_name!);
          break;
        case 'create_task':
          onEditTask({
            title: p.title ?? undefined,
            description: p.description ?? undefined,
            priority: (p.priority as Priority) ?? undefined,
            dueDate: p.due_date ?? undefined,
            assigneeId: p.assignee_id ?? undefined,
            projectId: p.project_id ?? undefined,
            sectionId: p.section_id ?? undefined,
            tags: p.tags,
          });
          return;
        case 'add_member':
          await addMemberToProject(p.project_id!, p.user_id!);
          break;
      }
      await useAppStore.getState().bootstrap();
      setAccepted(true);
      onExecuted();
      toast.success(successMsg(p));
    } catch {
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
        className="rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.06] px-4 py-3 flex items-center gap-3"
      >
        <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
        <span className="text-sm font-medium text-foreground truncate">{cardTitle(proposal)}</span>
      </motion.div>
    );
  }

  if (editing) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-violet-500/25 bg-card/80 backdrop-blur p-4 space-y-3 shadow-lg shadow-violet-500/5"
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-violet-600 dark:text-violet-400">
          {cardIcon(proposal.type)}
          Edit {typeLabel(proposal.type)}
        </div>
        {proposal.type === 'create_project' && (
          <>
            <input autoFocus value={editName} onChange={e => setEditName(e.target.value)} placeholder="Project name"
              className="w-full px-3 py-2 text-sm rounded-xl border border-border/60 bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
            <textarea value={editDesc} onChange={e => setEditDesc(e.target.value)} placeholder="Description" rows={2}
              className="w-full px-3 py-2 text-sm rounded-xl border border-border/60 bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none" />
          </>
        )}
        {proposal.type === 'create_section' && (
          <input autoFocus value={editSectionName} onChange={e => setEditSectionName(e.target.value)} placeholder="Section name"
            className="w-full px-3 py-2 text-sm rounded-xl border border-border/60 bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" onClick={() => {
            if (proposal.type === 'create_project') void handleAccept({ name: editName, description: editDesc });
            else if (proposal.type === 'create_section') void handleAccept({ section_name: editSectionName });
            else void handleAccept();
            setEditing(false);
          }} disabled={accepting}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 disabled:opacity-50">
            <Check className="h-3.5 w-3.5" /> Confirm
          </button>
          <button type="button" onClick={() => setEditing(false)}
            className="px-3.5 py-1.5 rounded-xl border border-border/60 text-xs font-medium hover:bg-muted/50">
            Cancel
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-violet-500/20 bg-card/70 backdrop-blur-md p-4 space-y-3 shadow-lg shadow-violet-500/[0.07]"
    >
      <div className="flex items-center gap-2">
        <span className="p-1.5 rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">{cardIcon(proposal.type)}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-violet-500/70">{typeLabel(proposal.type)}</span>
        {proposal.type === 'create_task' && proposal.priority && (
          <span className={cn('ml-auto text-[10px] px-2 py-0.5 rounded-full font-semibold border', PRIORITY_BADGE[proposal.priority] ?? PRIORITY_BADGE.Medium)}>
            {proposal.priority}
          </span>
        )}
      </div>
      <p className="text-sm font-semibold leading-snug">{cardTitle(proposal)}</p>
      {proposal.description && <p className="text-xs text-muted-foreground leading-relaxed">{proposal.description}</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {proposal.type === 'create_section' && proposal.project_name && (
          <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {proposal.project_name}</span>
        )}
        {proposal.type === 'create_task' && (
          <>
            {proposal.assignee_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {proposal.assignee_name}</span>}
            {proposal.project_name && (
              <span className="flex items-center gap-1">
                <Tag className="h-3 w-3" /> {proposal.project_name}
                {proposal.section_name && <span className="opacity-60"> / {proposal.section_name}</span>}
              </span>
            )}
            {proposal.due_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {proposal.due_date}</span>}
          </>
        )}
        {proposal.type === 'add_member' && (
          <>
            <span className="flex items-center gap-1"><User className="h-3 w-3" /> {proposal.user_name}</span>
            <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {proposal.project_name}</span>
          </>
        )}
      </div>
      <div className="flex gap-2 pt-1 border-t border-border/30">
        <button type="button" onClick={() => {
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
          } else setEditing(true);
        }} disabled={accepting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-border/60 text-xs font-medium hover:bg-muted/40">
          <Pencil className="h-3 w-3" /> Edit
        </button>
        <button type="button" onClick={() => void handleAccept()} disabled={accepting}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-semibold hover:bg-violet-500 disabled:opacity-50">
          <Check className="h-3.5 w-3.5" /> {accepting ? 'Creating…' : 'Accept'}
        </button>
      </div>
    </motion.div>
  );
}

export function ExtractedTaskCard({ task, onEdit }: { task: AIExtractedTask; onEdit: (p: TaskPrefill) => void }) {
  const { users, projects, currentUser } = useAppStore();
  const assignee = task.assignee_id ? users.find(u => u.id === task.assignee_id) : null;
  const project = task.project_id ? projects.find(p => p.id === task.project_id) : null;
  const section = task.section_id ? project?.sections?.find(s => s.id === task.section_id) ?? null : null;
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

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-violet-500/20 bg-card/70 backdrop-blur p-4 space-y-3">
      <div className="flex items-start gap-2">
        {task.priority && (
          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-semibold border shrink-0', PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.Medium)}>
            {task.priority}
          </span>
        )}
        <span className="text-sm font-semibold">{task.title}</span>
      </div>
      {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
        {assignee && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {assignee.name}</span>}
        {project && <span className="flex items-center gap-1"><Tag className="h-3 w-3" /> {project.name}{section && ` / ${section.name}`}</span>}
        {task.due_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {task.due_date}</span>}
      </div>
      <div className="flex gap-2 pt-1 border-t border-border/30">
        <button type="button" onClick={() => { if (currentUser) onEdit(prefill); }}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 text-white text-xs font-semibold">
          <Check className="h-3.5 w-3.5" /> Accept
        </button>
        <button type="button" onClick={() => onEdit(prefill)}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-border/60 text-xs font-medium">
          <Pencil className="h-3 w-3" /> Edit
        </button>
      </div>
    </motion.div>
  );
}

function AgentTaskCard({ data }: { data: AICardTaskData }) {
  return (
    <div className={cn('rounded-2xl border p-3 space-y-1.5 bg-card/60 backdrop-blur', data.is_overdue ? 'border-red-500/25' : 'border-border/40')}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 w-2 h-2 rounded-full shrink-0', PRIORITY_DOT[data.priority] ?? 'bg-muted-foreground')} />
        <p className="text-sm font-semibold flex-1">{data.title}</p>
        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-semibold', PRIORITY_BADGE[data.priority] ?? PRIORITY_BADGE.Medium)}>{data.priority}</span>
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground pl-4">
        <span>{data.is_overdue ? '⚠ Overdue' : data.status}</span>
        {data.due_date && <span><Calendar className="inline h-3 w-3 mr-1" />{data.due_date}</span>}
        {data.project_name && <span><Tag className="inline h-3 w-3 mr-1" />{data.project_name}</span>}
      </div>
    </div>
  );
}

function AgentStatCard({ data }: { data: AICardStatData }) {
  const stats = [
    { label: 'Assigned', value: data.assigned_total, icon: ListTodo, tone: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
    { label: 'In progress', value: data.in_progress, icon: Timer, tone: 'text-blue-600 dark:text-blue-400 bg-blue-500/10' },
    { label: 'Done this week', value: data.completed_this_week, icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' },
    { label: 'Overdue', value: data.overdue, icon: AlarmClock, tone: data.overdue > 0 ? 'text-red-600 dark:text-red-400 bg-red-500/10' : 'text-muted-foreground bg-muted/30' },
  ];
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur p-4">
      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3 flex items-center gap-1.5">
        <BarChart2 className="h-3.5 w-3.5" /> My stats
      </p>
      <div className="grid grid-cols-2 gap-2">
        {stats.map(s => (
          <div key={s.label} className={cn('rounded-xl px-3 py-2.5 flex items-center gap-2', s.tone)}>
            <s.icon className="h-4 w-4 shrink-0" />
            <div>
              <p className="text-xl font-bold tabular-nums leading-none">{s.value}</p>
              <p className="text-[10px] opacity-70 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentProjectCard({ data }: { data: AICardProjectData }) {
  const pct = data.total_tasks > 0 ? Math.round((data.completed_tasks / data.total_tasks) * 100) : 0;
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-violet-500" />
        <p className="text-sm font-semibold truncate flex-1">{data.name}</p>
        <span className="text-[10px] text-muted-foreground">{data.section_count} sections</span>
      </div>
      {data.total_tasks > 0 && (
        <div className="space-y-1">
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{data.completed_tasks}/{data.total_tasks} done</span><span>{pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function AgentTimesheetCard({ data }: { data: AICardTimesheetData }) {
  const maxH = Math.max(...data.by_project.map(p => p.hours), 1);
  return (
    <div className="rounded-2xl border border-border/40 bg-card/60 backdrop-blur p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> This week
        </p>
        <p className="text-lg font-bold tabular-nums">{data.total_hours}h</p>
      </div>
      {data.by_project.map(p => (
        <div key={p.project_name} className="space-y-0.5">
          <div className="flex justify-between text-[11px]">
            <span className="truncate">{p.project_name}</span>
            <span className="tabular-nums text-muted-foreground">{p.hours}h</span>
          </div>
          <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
            <div className="h-full bg-violet-500/70 rounded-full" style={{ width: `${(p.hours / maxH) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentCardRenderer({ card }: { card: AICard }) {
  if (card.type === 'task') return <AgentTaskCard data={card.data as unknown as AICardTaskData} />;
  if (card.type === 'stat') return <AgentStatCard data={card.data as unknown as AICardStatData} />;
  if (card.type === 'project') return <AgentProjectCard data={card.data as unknown as AICardProjectData} />;
  if (card.type === 'timesheet_summary') return <AgentTimesheetCard data={card.data as unknown as AICardTimesheetData} />;
  return null;
}

function ActionBadge({ action }: { action: AIChatAction }) {
  const label = TOOL_LABELS[action.tool] ?? action.tool;
  if (action.status === 'proposed' || action.status === 'error') return null;
  const tone =
    action.status === 'already_exists' ? 'bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400'
      : action.status === 'denied' ? 'bg-amber-500/10 border-amber-500/20 text-amber-600 dark:text-amber-400'
        : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400';
  const Icon = action.status === 'already_exists' ? Info : action.status === 'denied' ? ShieldOff : CheckCircle2;
  return (
    <div className={cn('flex items-start gap-2 text-xs px-3 py-2 rounded-xl border', tone)}>
      <Icon className="h-3.5 w-3.5 shrink-0 mt-0.5" />
      <span><span className="font-semibold">{label}:</span> {action.summary}</span>
    </div>
  );
}

export function ZaniMessageAttachments({
  actions,
  proposals,
  cards,
  tasks,
  onEditTask,
}: {
  actions?: AIChatAction[];
  proposals?: AIProposal[];
  cards?: AICard[];
  tasks?: AIExtractedTask[];
  onEditTask: (p: TaskPrefill) => void;
}) {
  const [executed, setExecuted] = useState<Set<number>>(new Set());
  const visibleActions = (actions ?? []).filter(
    a => a.status !== 'error'
      && !((['list_projects', 'list_users'].includes(a.tool) && ['success', 'proposed'].includes(a.status))
      || (DATA_TOOLS.has(a.tool) && a.status === 'data')),
  );

  return (
    <div className="w-full space-y-2 mt-2">
      {visibleActions.map((action, i) => <ActionBadge key={i} action={action} />)}
      {proposals?.map((p, i) => !executed.has(i) && (
        <ProposalCard key={i} proposal={p} onEditTask={onEditTask} onExecuted={() => setExecuted(prev => new Set([...prev, i]))} />
      ))}
      {cards?.map((card, i) => <AgentCardRenderer key={i} card={card} />)}
      {tasks?.map((task, i) => <ExtractedTaskCard key={i} task={task} onEdit={onEditTask} />)}
    </div>
  );
}
