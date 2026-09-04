import { describe, expect, it } from 'vitest';
import {
  buildDashTree, filterDashTree, sortDashTree, groupDashNodes, flattenDashNodes,
  EMPTY_DASH_FILTERS,
} from '@/lib/dash-rows';
import type { DashNode } from '@/lib/dash-rows';
import type { Task, UserStory } from '@/types';

const task = (o: Partial<Task>): Task => ({
  id: 't', title: 'T', description: '', projectId: 'p1', sectionId: 's', assignedTo: '',
  assigneeIds: [], assignedBy: '', createdBy: '', dueDate: '', sprint: '', priority: 'Medium',
  status: 'backlog', isStarted: false, approvedByManager: false, timeTracked: 0,
  minLogMinutes: 1, tags: [], createdAt: '', timeLog: {}, ...o,
});
const story = (o: Partial<UserStory>): UserStory => ({
  id: 'us1', projectId: 'p1', title: 'S', description: '', acceptanceCriteria: '',
  priority: 'Medium', status: 'backlog', reporterId: '', createdAt: '', updatedAt: '',
  progressPercent: 0, taskCount: 0, completedTaskCount: 0, subtaskCount: 0,
  completedSubtaskCount: 0, ...o,
});

const cols = [
  { id: 'backlog', label: 'Backlog', color: 'slate' },
  { id: 'in_progress', label: 'In Progress', color: 'violet' },
];
const ctx = { columns: cols, doneColumnId: 'done', users: [{ id: 'u1', name: 'Ann' }] };

describe('dash rows', () => {
  const tasks = [
    task({ id: 't1', userStoryId: 'us1', title: 'Parent', estimatedHours: 4, timeTracked: 3600 }),
    task({ id: 't2', parentTaskId: 't1', userStoryId: 'us1', title: 'Sub', estimatedHours: 2 }),
    task({ id: 't3', title: 'Orphan', status: 'in_progress', priority: 'Urgent' }),
    task({ id: 't4', title: 'Approved', approvedByManager: true }),
  ];
  const stories = [story({ id: 'us1' }), story({ id: 'us2', approvedByManager: true })];

  it('nests subtasks under their parent and drops approved work', () => {
    const tree = buildDashTree(stories, tasks);
    expect(tree.map(n => n.title)).toEqual(['S', 'Orphan']);
    expect(tree[0].children.map(c => c.title)).toEqual(['Parent']);
    expect(tree[0].children[0].children.map(c => c.title)).toEqual(['Sub']);
    expect(tree[0].children[0].type).toBe('task');
    expect(tree[0].children[0].children[0].type).toBe('subtask');
  });

  it('rolls story hours up from the whole subtree', () => {
    const tree = buildDashTree(stories, tasks);
    expect(tree[0].estimatedHours).toBe(6);   // 4 + 2
    expect(tree[0].actualHours).toBe(1);      // 3600s
  });

  it('filters nested tasks too, keeping the parent as context', () => {
    const tree = filterDashTree(buildDashTree(stories, tasks), {
      ...EMPTY_DASH_FILTERS, search: 'sub',
    });
    expect(tree.map(n => n.title)).toEqual(['S']);
    expect(tree[0].children[0].children.map(c => c.title)).toEqual(['Sub']);
  });

  it('groups by status and keeps children with their parent', () => {
    const tree = buildDashTree(stories, tasks);
    const groups = groupDashNodes(tree, 'status', ctx);
    expect(groups.map(g => [g.key, g.nodes.length, g.total])).toEqual([
      ['backlog', 1, 3],       // story + parent + sub
      ['in_progress', 1, 1],
    ]);
  });

  it('sorts inside each parent only', () => {
    const t = buildDashTree([story({ id: 'us1' })], [
      task({ id: 'a', userStoryId: 'us1', title: 'B', dueDate: '2026-01-02' }),
      task({ id: 'b', userStoryId: 'us1', title: 'A', dueDate: '2026-01-01' }),
    ]);
    const sorted = sortDashTree(t, 'due');
    expect(sorted[0].children.map(c => c.title)).toEqual(['A', 'B']);
  });

  it('flattens only through expanded rows', () => {
    const tree = buildDashTree(stories, tasks);
    expect(flattenDashNodes(tree, new Set()).map(r => r.title)).toEqual(['S', 'Orphan']);
    const open = new Set(['story:us1']);
    expect(flattenDashNodes(tree, open).map(r => [r.title, r.depth])).toEqual([
      ['S', 0], ['Parent', 1], ['Orphan', 0],
    ]);
  });
});

describe('groupDashNodes status grouping', () => {
  const columns = [
    { id: 'backlog', label: 'Backlog' },
    { id: 'in_progress', label: 'In Progress' },
    { id: 'done', label: 'Done' },
  ];
  const ctx = { columns, doneColumnId: 'done', users: [] };

  function node(id: string, status: string, children: DashNode[] = []): DashNode {
    return {
      rowId: id,
      entityId: id,
      type: 'task',
      projectId: 'p1',
      title: id,
      status,
      priority: 'Medium',
      dueDate: '',
      sprint: '',
      assigneeIds: [],
      estimatedHours: null,
      actualHours: 0,
      progressPercent: null,
      hasDescription: false,
      children,
    } as DashNode;
  }

  it('puts every child in the group its own status names', () => {
    const story = {
      ...node('story', 'in_progress', [node('t1', 'backlog'), node('t2', 'in_progress'), node('t3', 'done')]),
      type: 'story' as const,
    };
    const groups = groupDashNodes([story], 'status', ctx);
    const at = (key: string) => groups.find(g => g.key === key)!;

    expect(at('in_progress').nodes.map(n => n.rowId)).toEqual(['story']);
    expect(at('in_progress').nodes[0].children.map(n => n.rowId)).toEqual(['t2']);
    expect(at('backlog').nodes.map(n => n.rowId)).toEqual(['t1']);
    expect(at('done').nodes.map(n => n.rowId)).toEqual(['t3']);
  });

  it('leaves a lifted row standing on its own', () => {
    const story = { ...node('story', 'backlog', [node('t1', 'done')]), type: 'story' as const };
    const groups = groupDashNodes([story], 'status', ctx);
    expect(groups.find(g => g.key === 'done')!.nodes.map(n => n.rowId)).toEqual(['t1']);
    // The story keeps its own row and simply stops listing that task.
    expect(groups.find(g => g.key === 'backlog')!.nodes[0].children).toEqual([]);
  });

  it('a lifted task keeps the subtasks that share its status', () => {
    const story = {
      ...node('story', 'backlog', [node('t1', 'done', [node('s1', 'done'), node('s2', 'backlog')])]),
      type: 'story' as const,
    };
    const groups = groupDashNodes([story], 'status', ctx);
    const done = groups.find(g => g.key === 'done')!;
    const backlog = groups.find(g => g.key === 'backlog')!;

    expect(done.nodes.map(n => n.rowId)).toEqual(['t1']);
    expect(done.nodes[0].children.map(n => n.rowId)).toEqual(['s1']);
    // The odd one out lands in its own group rather than following its parent.
    expect(backlog.nodes.map(n => n.rowId)).toEqual(['story', 's2']);
  });

  it('treats completed the same as the done column', () => {
    const story = { ...node('story', 'backlog', [node('t1', 'completed')]), type: 'story' as const };
    const groups = groupDashNodes([story], 'status', ctx);
    expect(groups.find(g => g.key === 'done')!.nodes.map(n => n.rowId)).toEqual(['t1']);
    expect(groups.find(g => g.key === 'backlog')!.nodes[0].children).toEqual([]);
  });

  it('keeps a child nested when it shares its parent status', () => {
    const story = { ...node('story', 'in_progress', [node('t1', 'in_progress')]), type: 'story' as const };
    const groups = groupDashNodes([story], 'status', ctx);
    const inProgress = groups.find(g => g.key === 'in_progress')!;

    expect(inProgress.nodes.map(n => n.rowId)).toEqual(['story']);
    expect(inProgress.nodes[0].children.map(n => n.rowId)).toEqual(['t1']);
    expect(inProgress.total).toBe(2);
  });
});

describe('buildDashTree story nesting', () => {
  const story = (o: Partial<UserStory>): UserStory => ({
    id: 's1',
    projectId: 'p1',
    title: 'S',
    description: '',
    acceptanceCriteria: '',
    priority: 'Medium',
    status: 'backlog',
    reporterId: 'u1',
    createdAt: '',
    updatedAt: '',
    ...o,
  } as UserStory);

  it('hangs a sub-story off its parent', () => {
    const nodes = buildDashTree(
      [story({ id: 'epic', title: 'Epic' }), story({ id: 'child', title: 'Child', parentStoryId: 'epic' })],
      [],
    );
    expect(nodes.map(n => n.entityId)).toEqual(['epic']);
    expect(nodes[0].children.map(n => n.entityId)).toEqual(['child']);
  });

  it('keeps a child at the top when its parent is gone', () => {
    const nodes = buildDashTree([story({ id: 'child', parentStoryId: 'missing' })], []);
    expect(nodes.map(n => n.entityId)).toEqual(['child']);
  });

  it('does not lose a story that points at itself', () => {
    const nodes = buildDashTree([story({ id: 'loop', parentStoryId: 'loop' })], []);
    expect(nodes.map(n => n.entityId)).toEqual(['loop']);
  });

  it('still shows both stories when they point at each other', () => {
    const nodes = buildDashTree(
      [story({ id: 'a', parentStoryId: 'b' }), story({ id: 'b', parentStoryId: 'a' })],
      [],
    );
    // A cycle has no root. The loop is broken at the first story, so both are
    // still reachable, each exactly once, and nothing recurses forever.
    const ids = flattenDashNodes(nodes, new Set(['story:a', 'story:b'])).map(r => r.entityId);
    expect(ids.sort()).toEqual(['a', 'b']);
  });
});
