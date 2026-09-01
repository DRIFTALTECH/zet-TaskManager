import type { Client, Project, Task, TimesheetWorkEntry } from '@/types';
import { computeProjectStats, isCompleted } from '@/lib/manage-utils';

export interface ClientProjectRow {
  id: string;
  name: string;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  progress: number;
  memberCount: number;
  seconds: number;
}

export interface ClientSummary {
  id: string;
  name: string;
  projectCount: number;
  totalTasks: number;
  completedTasks: number;
  remainingTasks: number;
  progress: number;
  teamMemberCount: number;
  seconds: number;
  projects: ClientProjectRow[];
}

export type ClientSortKey = 'name' | 'projects' | 'tasks' | 'hours';

/** Group visible projects by client and roll up task / team / timesheet stats. */
export function buildClientSummaries(
  clients: Client[],
  projects: Project[],
  tasks: Task[],
  entries: TimesheetWorkEntry[] = [],
): ClientSummary[] {
  const byClient = new Map<string, Project[]>();
  for (const p of projects) {
    if (!p.clientId) continue;
    const list = byClient.get(p.clientId) ?? [];
    list.push(p);
    byClient.set(p.clientId, list);
  }

  const secondsByProject = new Map<string, number>();
  for (const e of entries) {
    secondsByProject.set(e.projectId, (secondsByProject.get(e.projectId) ?? 0) + e.seconds);
  }

  const summaries: ClientSummary[] = [];

  for (const client of clients) {
    const clientProjects = byClient.get(client.id);
    if (!clientProjects?.length) continue;

    const projectRows: ClientProjectRow[] = clientProjects.map(p => {
      const stats = computeProjectStats(p, tasks);
      return {
        id: p.id,
        name: p.name,
        totalTasks: stats.taskCount,
        completedTasks: stats.completed,
        remainingTasks: stats.active,
        progress: stats.completionPct,
        memberCount: stats.memberCount,
        seconds: secondsByProject.get(p.id) ?? 0,
      };
    });

    const totalTasks = projectRows.reduce((s, r) => s + r.totalTasks, 0);
    const completedTasks = projectRows.reduce((s, r) => s + r.completedTasks, 0);
    const seconds = projectRows.reduce((s, r) => s + r.seconds, 0);
    const clientPids = new Set(clientProjects.map(p => p.id));
    const teamIds = new Set<string>();
    for (const p of clientProjects) {
      for (const uid of p.members) teamIds.add(uid);
    }
    for (const e of entries) {
      if (clientPids.has(e.projectId)) teamIds.add(e.userId);
    }

    summaries.push({
      id: client.id,
      name: client.name,
      projectCount: projectRows.length,
      totalTasks,
      completedTasks,
      remainingTasks: totalTasks - completedTasks,
      progress: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
      teamMemberCount: teamIds.size,
      seconds,
      projects: projectRows.sort((a, b) => a.name.localeCompare(b.name)),
    });
  }

  return summaries;
}

export function sortClientSummaries(
  rows: ClientSummary[],
  key: ClientSortKey,
): ClientSummary[] {
  const copy = [...rows];
  if (key === 'name') {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else if (key === 'projects') {
    copy.sort((a, b) => b.projectCount - a.projectCount || a.name.localeCompare(b.name));
  } else if (key === 'hours') {
    copy.sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => b.totalTasks - a.totalTasks || a.name.localeCompare(b.name));
  }
  return copy;
}

export function getClientSummaryById(
  clients: Client[],
  projects: Project[],
  tasks: Task[],
  clientId: string,
  entries: TimesheetWorkEntry[] = [],
): ClientSummary | null {
  return buildClientSummaries(clients, projects, tasks, entries).find(c => c.id === clientId) ?? null;
}

/** Tasks for all projects under one client. */
export function tasksForClient(
  projects: Project[],
  tasks: Task[],
  clientId: string,
): Task[] {
  const pids = new Set(projects.filter(p => p.clientId === clientId).map(p => p.id));
  return tasks.filter(t => pids.has(t.projectId));
}

export function teamMembersForClient(
  projects: Project[],
  clientId: string,
  entries: TimesheetWorkEntry[] = [],
): string[] {
  const ids = new Set<string>();
  const pids = new Set<string>();
  for (const p of projects) {
    if (p.clientId !== clientId) continue;
    pids.add(p.id);
    for (const uid of p.members) ids.add(uid);
  }
  for (const e of entries) {
    if (pids.has(e.projectId)) ids.add(e.userId);
  }
  return [...ids];
}

export { isCompleted };
