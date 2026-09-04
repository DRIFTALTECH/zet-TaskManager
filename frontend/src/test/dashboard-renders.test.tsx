/**
 * The dashboard actually puts rows on the screen.
 *
 * Every other test here checks the data pipeline in isolation, which is how a
 * board full of work could still render as an empty page: the tree was right and
 * the page never showed it. This renders the real page against a hydrated store.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryClient, storyKeys } from '@/lib/queryClient';
import { useAppStore } from '@/stores/appStore';
import DashboardPage from '@/pages/DashboardPage';
import type { Project, Task, User } from '@/types';

const superadmin: User = {
  id: 'u1', name: 'Swamy', email: 's@x.com', role: 'superadmin', avatar: '',
  // A superadmin joins no project but sees them all.
  projectIds: [], isActive: true,
} as User;

const project: Project = {
  id: 'p1', name: 'Driftal', description: '', members: ['u1'],
  sections: [{ id: 'sec1', name: 'General', position: 0 }], createdAt: '', createdBy: 'u1',
} as unknown as Project;

const task: Task = {
  id: 't1', title: 'Persist incident records', description: '', projectId: 'p1',
  sectionId: 'sec1', assignedTo: 'u1', assigneeIds: ['u1'], assignedBy: 'u1',
  createdBy: 'u1', dueDate: '', priority: 'High', status: 'backlog',
  isStarted: false, approvedByManager: false, timeTracked: 0, tags: [],
  createdAt: '', timeLog: {},
} as Task;

function renderDashboard() {
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter>
          <DashboardPage />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('the dashboard shows the work it has', () => {
  beforeEach(() => {
    queryClient.setQueryData(storyKeys.all, []);
    useAppStore.setState({
      hydrated: true,
      bootstrapError: null,
      currentUser: superadmin,
      users: [{ id: 'u1', name: 'Swamy', email: 's@x.com', role: 'superadmin', avatar: '', projectIds: [], isActive: true } as User],
      projects: [project],
      tasks: [task],
      selectedProjectId: 'all',
      kanbanColumns: [
        { id: 'backlog', label: 'Backlog' },
        { id: 'in_progress', label: 'In Progress' },
        { id: 'done', label: 'Done' },
      ],
      activeTimers: {},
    });
  });

  it('lists a task a superadmin can see, though they join no project', () => {
    renderDashboard();
    expect(screen.getByText('Persist incident records')).toBeTruthy();
  });

  it('does not fall back to the "Select a project" screen', () => {
    renderDashboard();
    expect(screen.queryByText('Select a project')).toBeNull();
  });
});
