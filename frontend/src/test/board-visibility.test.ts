/**
 * Work finished by a drag stays on the board.
 *
 * The board hides *confirmed* work — status `completed`, or anything a manager
 * has approved — so that finished-but-unapproved cards stay visible for someone
 * to approve. A cascade that stamped `approvedByManager` while moving a block
 * to Done therefore deleted every card inside it from the board: the story
 * landed in Done and its tasks were simply gone.
 *
 * These pin the visibility rule itself, which is the layer the status-level
 * tests could not see.
 */
import { describe, expect, it } from 'vitest';
import { buildDashTree } from '@/lib/dash-rows';
import type { Task, UserStory } from '@/types';

const t = (over: Partial<Task>): Task => ({
  id: 'x', title: 'x', description: '', projectId: 'p1', sectionId: 's1',
  assignedTo: '', assigneeIds: [], assignedBy: '', createdBy: '', dueDate: '',
  priority: 'Medium', status: 'backlog', isStarted: false,
  approvedByManager: false, timeTracked: 0, tags: [], createdAt: '', timeLog: {},
  ...over,
} as Task);

const st = (over: Partial<UserStory>): UserStory => ({
  id: 'x', title: 'x', projectId: 'p1', status: 'backlog', priority: 'Medium',
  ...over,
} as UserStory);

/** Every task id the board would actually draw. */
function taskIds(stories: UserStory[], tasks: Task[]): string[] {
  const out: string[] = [];
  const walk = (nodes: ReturnType<typeof buildDashTree>) => {
    for (const n of nodes) {
      if (n.type !== 'story') out.push(n.entityId);
      walk(n.children);
    }
  };
  walk(buildDashTree(stories, tasks));
  return out;
}

describe('a block dragged to Done stays on the board', () => {
  const story = st({ id: 'us1', status: 'done' });
  const child = st({ id: 'us2', status: 'done', parentStoryId: 'us1' });

  it('keeps done-but-unapproved tasks visible', () => {
    const tasks = [
      t({ id: 't1', status: 'done', userStoryId: 'us1' }),
      t({ id: 't2', status: 'done', userStoryId: 'us2' }),
    ];
    expect(taskIds([story, child], tasks).sort()).toEqual(['t1', 't2']);
  });

  it('hides them the moment they are approved — the bug', () => {
    const tasks = [
      t({ id: 't1', status: 'done', userStoryId: 'us1', approvedByManager: true }),
      t({ id: 't2', status: 'done', userStoryId: 'us2', approvedByManager: true }),
    ];
    // Proves the mechanism: approving is what emptied the cards, not the move.
    expect(taskIds([story, child], tasks)).toEqual([]);
  });

  it('keeps the sub-story itself visible at done', () => {
    const ids = buildDashTree([story, child], []).flatMap(function f(n): string[] {
      return [n.entityId, ...n.children.flatMap(f)];
    });
    expect(ids).toContain('us2');
  });

  it('still hides genuinely completed work, which is the intended rule', () => {
    const done = st({ id: 'us1', status: 'completed' });
    const tasks = [t({ id: 't1', status: 'completed', userStoryId: 'us1' })];
    expect(taskIds([done], tasks)).toEqual([]);
  });
});
