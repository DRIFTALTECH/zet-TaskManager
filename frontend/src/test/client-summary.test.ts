import { describe, it, expect } from 'vitest';
import { buildClientSummaries, teamMembersForClient } from '@/lib/client-summary';
import type { Client, Project, Task, TimesheetWorkEntry } from '@/types';

const client: Client = { id: 'c1', name: 'Acme', createdAt: '2026-01-01' };
const project = (id: string, clientId: string, members: string[]): Project => ({
  id,
  name: id,
  description: '',
  clientId,
  createdBy: 'u1',
  members,
  sections: [],
  createdAt: '2026-01-01',
});
const entry = (projectId: string, userId: string, seconds: number): TimesheetWorkEntry => ({
  id: `${projectId}-${userId}`,
  userId,
  workDate: '2026-01-02',
  projectId,
  sectionId: 's1',
  description: '',
  timeFrom: '09:00',
  timeTo: '10:00',
  seconds,
  billable: true,
  createdAt: '2026-01-02',
});

describe('buildClientSummaries', () => {
  it('rolls up timesheet hours and team from client projects only', () => {
    const projects = [
      project('p1', 'c1', ['u1']),
      project('p2', 'c2', ['u9']),
    ];
    const tasks = [{ projectId: 'p1', status: 'done' } as Task];
    const entries = [
      entry('p1', 'u2', 3600),
      entry('p2', 'u9', 7200),
    ];
    const [row] = buildClientSummaries([client], projects, tasks, entries);
    expect(row.totalTasks).toBe(1);
    expect(row.seconds).toBe(3600);
    expect(row.teamMemberCount).toBe(2); // member u1 + timesheet u2
    expect(teamMembersForClient(projects, 'c1', entries).sort()).toEqual(['u1', 'u2']);
  });
});
