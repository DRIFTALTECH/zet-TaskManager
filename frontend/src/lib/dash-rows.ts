/**
 * One row model for the dashboard.
 *
 * Stories, tasks and subtasks are three different shapes on the wire, but a table
 * can only line its columns up if every row exposes the same fields. So each is
 * normalised into a `DashNode` carrying the columns the table draws, plus a `ref`
 * back to the original entity for the modal and the mutation it needs.
 *
 * The tree is built once, then filtered, sorted, grouped and flattened. Building it
 * once is what fixes the old split pipeline, where story children came straight from
 * the raw task list and so silently escaped every filter.
 */
import type { KanbanColumn, Priority, Task, UserStory } from '@/types';
import {
  childTasksOf,
  isStandaloneTask,
  isStoryConfirmed,
  isTaskConfirmed,
  isTopLevelTask,
  matchesSprintFilter,
  normalizePriority,
  storyAssigneeIds,
  taskAssigneeIds,
  UNASSIGNED_FILTER_ID,
} from '@/lib/task-utils';
import { taskMatchesDueDateRange } from '@/lib/due-date-utils';

export type DashRowType = 'story' | 'task' | 'subtask';

/** How top-level rows are bucketed. Children always follow their parent. */
export type DashGroupBy = 'status' | 'assignee' | 'priority' | 'none';

export type DashSortBy = 'default' | 'due' | 'priority' | 'title';

export interface DashNode {
  /** Unique across types — a story and a task can share an id space. */
  rowId: string;
  entityId: string;
  type: DashRowType;
  projectId: string;
  title: string;
  status: string;
  priority: Priority;
  dueDate: string;
  sprint: string;
  assigneeIds: string[];
  /** Story rows carry rolled-up hours; task rows carry their own. */
  estimatedHours: number | null;
  actualHours: number;
  /** Stories only — null on tasks. */
  progressPercent: number | null;
  /** Drives the description glyph on the row, as in the reference lists. */
  hasDescription: boolean;
  story?: UserStory;
  task?: Task;
  children: DashNode[];
}

/** A node plus its position in the flattened output. */
export interface DashRow extends Omit<DashNode, 'children'> {
  depth: number;
  childCount: number;
  hasChildren: boolean;
}

export interface DashGroup {
  key: string;
  label: string;
  /** Palette key for a status group; undefined for the other groupings. */
  color?: string;
  nodes: DashNode[];
  /** Every node in the group including descendants — what the header count shows. */
  total: number;
}

export interface DashFilters {
  priority: Set<Priority>;
  assignees: Set<string>;
  sprints: Set<string>;
  dateFrom: string;
  dateTo: string;
  search: string;
}

export const EMPTY_DASH_FILTERS: DashFilters = {
  priority: new Set(),
  assignees: new Set(),
  sprints: new Set(),
  dateFrom: '',
  dateTo: '',
  search: '',
};

export function storyRowId(id: string) {
  return `story:${id}`;
}
export function taskRowId(id: string) {
  return `task:${id}`;
}

function hoursFromSeconds(seconds: number | undefined): number {
  return Math.max(0, seconds ?? 0) / 3600;
}

function taskNode(task: Task, allTasks: Task[], type: DashRowType): DashNode {
  const kids = childTasksOf(allTasks, task.id).filter(t => !isTaskConfirmed(t));
  return {
    rowId: taskRowId(task.id),
    entityId: task.id,
    type,
    projectId: task.projectId,
    title: task.title,
    status: task.status,
    priority: normalizePriority(task.priority),
    dueDate: task.dueDate ?? '',
    sprint: task.sprint ?? '',
    assigneeIds: taskAssigneeIds(task),
    estimatedHours: task.estimatedHours ?? null,
    actualHours: hoursFromSeconds(task.timeTracked),
    progressPercent: null,
    hasDescription: !!task.description?.trim(),
    task,
    children: kids.map(k => taskNode(k, allTasks, 'subtask')),
  };
}

function storyNode(story: UserStory, storyTasks: Task[], allTasks: Task[]): DashNode {
  const children = storyTasks.map(t => taskNode(t, allTasks, 'task'));
  // Roll up from the story's own subtree rather than re-scanning every task, so the
  // numbers always match the rows actually shown underneath.
  let estimated = 0;
  let hasEstimate = false;
  let actual = 0;
  const walk = (nodes: DashNode[]) => {
    for (const n of nodes) {
      if (n.estimatedHours != null && n.estimatedHours > 0) {
        estimated += n.estimatedHours;
        hasEstimate = true;
      }
      actual += n.actualHours;
      walk(n.children);
    }
  };
  walk(children);
  return {
    rowId: storyRowId(story.id),
    entityId: story.id,
    type: 'story',
    projectId: story.projectId,
    title: story.title,
    status: story.status || 'backlog',
    priority: normalizePriority(String(story.priority)),
    dueDate: story.dueDate ?? '',
    sprint: story.sprint ?? '',
    assigneeIds: storyAssigneeIds(story),
    estimatedHours: hasEstimate ? estimated : null,
    actualHours: actual,
    progressPercent: story.progressPercent ?? 0,
    hasDescription: !!(story.description?.trim() || story.acceptanceCriteria?.trim()),
    story,
    children,
  };
}

/**
 * Story → its tasks → their subtasks, plus standalone tasks as siblings of stories.
 * Confirmed (manager-approved) work is dropped at every level, as it was before.
 */
export function buildDashTree(stories: UserStory[], tasks: Task[]): DashNode[] {
  const openStories = stories.filter(s => !isStoryConfirmed(s));
  const storyIds = new Set(openStories.map(s => s.id));

  const byStory = new Map<string, Task[]>();
  for (const t of tasks) {
    if (!t.userStoryId || !isTopLevelTask(t) || isTaskConfirmed(t)) continue;
    const list = byStory.get(t.userStoryId);
    if (list) list.push(t);
    else byStory.set(t.userStoryId, [t]);
  }

  // Sub-stories hang off their parent; a parent that is filtered out or missing
  // leaves its children at the top rather than dropping them from the board.
  const childStories = new Map<string, UserStory[]>();
  for (const s of openStories) {
    const parentId = s.parentStoryId ?? '';
    if (!parentId || !storyIds.has(parentId) || parentId === s.id) continue;
    const list = childStories.get(parentId);
    if (list) list.push(s);
    else childStories.set(parentId, [s]);
  }

  const seen = new Set<string>();
  const buildStory = (s: UserStory): DashNode => {
    seen.add(s.id);
    const node = storyNode(s, byStory.get(s.id) ?? [], tasks);
    const kids = (childStories.get(s.id) ?? []).filter(c => !seen.has(c.id));
    // Sub-stories come first: they own work of their own, tasks are the leaves.
    return { ...node, children: [...kids.map(buildStory), ...node.children] };
  };

  const nodes: DashNode[] = openStories
    .filter(s => {
      const parentId = s.parentStoryId ?? '';
      return !parentId || !storyIds.has(parentId) || parentId === s.id;
    })
    .map(buildStory);

  // A cycle leaves stories with no root to hang from. Show them at the top
  // rather than dropping them off the board entirely.
  for (const s of openStories) {
    if (!seen.has(s.id)) nodes.push(buildStory(s));
  }

  for (const t of tasks) {
    if (!isTopLevelTask(t) || isTaskConfirmed(t)) continue;
    if (!isStandaloneTask(t, storyIds)) continue;
    nodes.push(taskNode(t, tasks, 'task'));
  }
  return nodes;
}

function nodeMatchesAssignees(node: DashNode, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  if (selected.has(UNASSIGNED_FILTER_ID) && node.assigneeIds.length === 0) return true;
  return node.assigneeIds.some(id => selected.has(id));
}

function nodeMatches(node: DashNode, f: DashFilters): boolean {
  if (f.priority.size > 0 && !f.priority.has(node.priority)) return false;
  if (!matchesSprintFilter(node.sprint, f.sprints)) return false;
  if (!nodeMatchesAssignees(node, f.assignees)) return false;
  if (!taskMatchesDueDateRange({ dueDate: node.dueDate } as Task, f.dateFrom, f.dateTo)) {
    return false;
  }
  const q = f.search.trim().toLowerCase();
  if (q && !node.title.toLowerCase().includes(q)) return false;
  return true;
}

/**
 * Keep a node when it matches, or when any descendant does — dropping a matching
 * task just because its story does not match would hide the work you filtered for.
 */
export function filterDashTree(nodes: DashNode[], f: DashFilters): DashNode[] {
  const out: DashNode[] = [];
  for (const node of nodes) {
    const children = filterDashTree(node.children, f);
    if (children.length > 0 || nodeMatches(node, f)) {
      out.push({ ...node, children });
    }
  }
  return out;
}

const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

function compareNodes(a: DashNode, b: DashNode, sortBy: DashSortBy): number {
  switch (sortBy) {
    case 'due': {
      // Undated work sorts last rather than pretending to be due in 1970.
      const av = a.dueDate?.trim() || '9999-12-31';
      const bv = b.dueDate?.trim() || '9999-12-31';
      return av.localeCompare(bv);
    }
    case 'priority':
      return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
    case 'title':
      return a.title.localeCompare(b.title);
    default:
      return 0;
  }
}

/** Sorts within each parent, so children never leave their story. */
export function sortDashTree(nodes: DashNode[], sortBy: DashSortBy): DashNode[] {
  if (sortBy === 'default') return nodes;
  return [...nodes]
    .sort((a, b) => compareNodes(a, b, sortBy))
    .map(n => ({ ...n, children: sortDashTree(n.children, sortBy) }));
}

function countNodes(nodes: DashNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

interface GroupContext {
  columns: KanbanColumn[];
  doneColumnId: string;
  users: { id: string; name: string }[];
}

/** Board column a status belongs to, falling back to Backlog for unknown values. */
export function statusColumnId(
  status: string,
  columns: KanbanColumn[],
  doneColumnId: string,
): string {
  const id = status === 'completed' ? doneColumnId : status || 'backlog';
  if (columns.some(c => c.id === id)) return id;
  // Fall back to a column that exists. Returning a hard-coded 'backlog' hid the
  // card entirely on a board whose columns were renamed or replaced: it matched
  // no column, so nothing rendered it anywhere.
  return columns.some(c => c.id === 'backlog') ? 'backlog' : (columns[0]?.id ?? 'backlog');
}

/**
 * Buckets top-level nodes. Children stay under the parent they belong to.
 *
 * A story keeps the work inside it whatever status each piece holds — the row
 * says its own status instead. Sorting children into groups by status emptied
 * their parents, which is why stories and tasks had nothing left to expand.
 * Dragging something out of its parent is what makes it a row of its own, and
 * that clears the link, which lands it here as a top-level node.
 */
export function groupDashNodes(
  nodes: DashNode[],
  groupBy: DashGroupBy,
  ctx: GroupContext,
): DashGroup[] {
  if (groupBy === 'none') {
    return nodes.length === 0
      ? []
      : [{ key: 'all', label: 'All work', nodes, total: countNodes(nodes) }];
  }

  if (groupBy === 'status') {
    // Every column gets a group, empty ones included — an empty status is
    // information, and it gives you somewhere to add the first item.
    const buckets = new Map<string, DashNode[]>(ctx.columns.map(c => [c.id, []]));
    const fallback = ctx.columns[0]?.id;
    for (const node of nodes) {
      const id = statusColumnId(node.status, ctx.columns, ctx.doneColumnId);
      const bucket = buckets.get(id) ?? (fallback ? buckets.get(fallback) : undefined);
      bucket?.push(node);
    }
    return ctx.columns.map(c => {
      const group = buckets.get(c.id) ?? [];
      return {
        key: c.id,
        label: c.label,
        color: c.color,
        nodes: group,
        total: countNodes(group),
      };
    });
  }

  if (groupBy === 'priority') {
    const order: Priority[] = ['Urgent', 'High', 'Medium', 'Low'];
    return order
      .map(p => {
        const group = nodes.filter(n => n.priority === p);
        return { key: p, label: p, nodes: group, total: countNodes(group) };
      })
      .filter(g => g.nodes.length > 0);
  }

  // assignee — a node with several assignees shows up under each of them.
  const byUser = new Map<string, DashNode[]>();
  const unassigned: DashNode[] = [];
  for (const node of nodes) {
    if (node.assigneeIds.length === 0) {
      unassigned.push(node);
      continue;
    }
    for (const id of node.assigneeIds) {
      const list = byUser.get(id);
      if (list) list.push(node);
      else byUser.set(id, [node]);
    }
  }
  const groups: DashGroup[] = [...byUser.entries()]
    .map(([id, group]) => ({
      key: id,
      label: ctx.users.find(u => u.id === id)?.name ?? 'Unknown',
      nodes: group,
      total: countNodes(group),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (unassigned.length > 0) {
    groups.push({
      key: UNASSIGNED_FILTER_ID,
      label: 'Unassigned',
      nodes: unassigned,
      total: countNodes(unassigned),
    });
  }
  return groups;
}

/** Depth-first walk into table rows, stopping at any collapsed parent. */
export function flattenDashNodes(
  nodes: DashNode[],
  expanded: Set<string>,
  depth = 0,
): DashRow[] {
  const rows: DashRow[] = [];
  for (const node of nodes) {
    const { children, ...rest } = node;
    rows.push({
      ...rest,
      depth,
      childCount: children.length,
      hasChildren: children.length > 0,
    });
    if (children.length > 0 && expanded.has(node.rowId)) {
      rows.push(...flattenDashNodes(children, expanded, depth + 1));
    }
  }
  return rows;
}
