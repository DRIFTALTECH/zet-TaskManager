import { describe, it, expect, beforeEach } from 'vitest';
import { cacheFullTask, dropFullTask, invalidateTaskDetails, queryClient, taskKeys, seedUserStoriesCache, upsertUserStory, storyKeys, projectKeys } from '@/lib/queryClient';
import type { Task, UserStory } from '@/types';

const task = (id: string, description: string): Task => ({
  id,
  title: id,
  description,
  projectId: 'p1',
  sectionId: 's1',
  assignedTo: 'u1',
  assigneeIds: ['u1'],
  assignedBy: 'u1',
  createdBy: 'u1',
  dueDate: '2026-07-01',
  sprint: '',
  priority: 'Medium',
  status: 'backlog',
  isStarted: false,
  approvedByManager: false,
  timeTracked: 0,
  minLogMinutes: 1,
  tags: [],
  createdAt: '2026-01-01',
  timeLog: {},
});

describe('task detail cache', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('keeps a full task until a live update invalidates it', () => {
    cacheFullTask(task('t1', 'full body'));
    expect(queryClient.getQueryData(taskKeys.detail('t1'))).toMatchObject({ description: 'full body' });
    invalidateTaskDetails();
    const state = queryClient.getQueryState(taskKeys.detail('t1'));
    expect(state?.isInvalidated).toBe(true);
    dropFullTask('t1');
    expect(queryClient.getQueryData(taskKeys.detail('t1'))).toBeUndefined();
  });

  it('keeps nested task resources on separate keys', () => {
    queryClient.setQueryData(taskKeys.feedback('t1'), [{ id: 'f1' }]);
    queryClient.setQueryData(taskKeys.feedback('t2'), [{ id: 'f2' }]);
    queryClient.setQueryData(taskKeys.attachments('t1'), [{ id: 'a1' }]);
    expect(queryClient.getQueryData(taskKeys.feedback('t1'))).toEqual([{ id: 'f1' }]);
    expect(queryClient.getQueryData(taskKeys.feedback('t2'))).toEqual([{ id: 'f2' }]);
    expect(queryClient.getQueryData(taskKeys.attachments('t2'))).toBeUndefined();
    invalidateTaskDetails();
    expect(queryClient.getQueryState(taskKeys.feedback('t1'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(taskKeys.attachments('t1'))?.isInvalidated).toBe(true);
  });
});

const story = (id: string, projectId: string, title: string): UserStory => ({
  id,
  projectId,
  title,
  description: '',
  acceptanceCriteria: '',
  priority: 'Medium',
  status: 'backlog',
  reporterId: 'u1',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  progressPercent: 0,
  taskCount: 0,
  completedTaskCount: 0,
  subtaskCount: 0,
  completedSubtaskCount: 0,
  sprint: 'Sprint 1',
  approvedByManager: false,
  tags: [],
});

describe('user story cache', () => {
  beforeEach(() => {
    queryClient.clear();
  });

  it('seeds all + per-project keys and upserts without dropping siblings', () => {
    seedUserStoriesCache([story('us1', 'p1', 'A'), story('us2', 'p2', 'B')], ['p1', 'p2', 'p3']);
    expect(queryClient.getQueryData(storyKeys.all)).toHaveLength(2);
    expect(queryClient.getQueryData(projectKeys.userStories('p1'))).toHaveLength(1);
    expect(queryClient.getQueryData(projectKeys.userStories('p3'))).toEqual([]);
    upsertUserStory(story('us3', 'p1', 'C'));
    expect(queryClient.getQueryData<UserStory[]>(storyKeys.all)?.map(s => s.id)).toEqual(['us3', 'us1', 'us2']);
    expect(queryClient.getQueryData<UserStory[]>(projectKeys.userStories('p1'))?.map(s => s.id)).toEqual(['us3', 'us1']);
  });
});
