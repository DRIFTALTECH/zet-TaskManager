import { useAppStore } from '@/stores/appStore';
import { projectPickerLabel } from '@/lib/project-utils';
import { Task, Priority, KanbanColumn } from '@/types';
import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  pointerWithin,
  rectIntersection,
  type CollisionDetection,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Plus, GripVertical,
  MoreHorizontal, Pencil, Trash2, Flag, Check, CheckCircle, ChevronRight,
  List, Columns, BookOpen, UserPlus2, Palette,
} from 'lucide-react';
import { KanbanBoardPan } from '@/components/KanbanBoardPan';
import TaskDetailModal from '@/components/TaskDetailModal';
import StoryDetailModal from '@/components/StoryDetailModal';
import CreateTaskModal from '@/components/CreateTaskModal';
import { CreateUserStoryDialog } from '@/components/CreateUserStoryDialog';
import { AddWorkMenu } from '@/components/AddWorkMenu';
import { SortableTaskCard, TaskCard, BoardCardMetaPills } from '@/components/TaskCard';
import { toast } from 'sonner';
import { confirmAction } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { pageEnter } from '@/lib/motion';
import { priorityTextClass } from '@/lib/priority-styles';
import { columnColorTokens, COLUMN_COLOR_KEYS, DEFAULT_COLUMN_COLOR } from '@/lib/column-colors';
import DashTable, { type DashDraft, type DashRowPatch } from '@/components/dash/DashTable';
import DashToolbar from '@/components/dash/DashToolbar';
import {
  buildDashTree,
  filterDashTree,
  groupDashNodes,
  sortDashTree,
  type DashGroupBy,
  type DashNode,
  type DashRow,
  type DashSortBy,
} from '@/lib/dash-rows';
import { UNASSIGNED_FILTER_ID, isTopLevelTask, isTaskConfirmed, isStoryConfirmed, storyAssigneeIds, normalizePriority, rollupStoryHours, isDoneBoardStatus } from '@/lib/task-utils';
import UserAvatar from '@/components/UserAvatar';
import { Hint } from '@/components/ui/hint';
import { Loader2 } from 'lucide-react';
import { useBusyIds } from '@/hooks/useBusyIds';
import { AssigneeCell, DueDateCell, PriorityCell, type DashUser } from '@/components/dash/DashCells';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { promptActualHours } from '@/components/ActualHoursDialog';
import { useQuery } from '@tanstack/react-query';
import { removeUserStory, storyKeys, STORY_STALE_TIME, upsertUserStory } from '@/lib/queryClient';
import type { UserStory } from '@/types';

const PROTECTED_IDS = new Set(['backlog', 'in_progress', 'in_review', 'done']);
const DONE_COL_KEY = 'tm_done_col';
const VIEW_KEY = 'tm_dash_view';
const GROUP_KEY = 'tm_dash_group';
const STORY_DRAG_PREFIX = 'story:';
type DashView = 'list' | 'board';
type ActiveDrag = 'task' | 'column' | 'story';

function storyDragId(id: string) {
  return `${STORY_DRAG_PREFIX}${id}`;
}
function parseStoryDragId(id: string) {
  return id.startsWith(STORY_DRAG_PREFIX) ? id.slice(STORY_DRAG_PREFIX.length) : null;
}
function statusColId(status: string, columns: KanbanColumn[], doneColumnId: string) {
  const id = status === 'completed' ? doneColumnId : (status || 'backlog');
  if (columns.some(c => c.id === id)) return id;
  // Never point at a column that is not on the board: a card whose column does
  // not exist is rendered by nobody and simply disappears.
  return columns.some(c => c.id === 'backlog') ? 'backlog' : (columns[0]?.id ?? 'backlog');
}
const CARD_SHADOW =
  'shadow-[0_1px_4px_rgba(0,0,0,0.10)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.14)] dark:shadow-[0_1px_4px_rgba(255,255,255,0.14)] dark:hover:shadow-[0_2px_8px_rgba(255,255,255,0.22)]';

/** A task rendered as its own card. `storyTitle` marks one pulled out of its story. */
interface BoardTaskCard {
  task: Task;
  storyTitle?: string;
}

function StoryBoardCard({
  story, tasks, totalTasks, childStories = [], renderChildStory, onEdit, onEditTask, subtasksOf, expandedTaskIds, onToggleTaskExpand, members = [], busy = false, busyIds, expanded, onToggleExpand, onClick, onTaskClick, onAddTask, users,
  showProjectPill, isManager, doneColumnId,
  dragRef, dragStyle, dragAttributes, dragListeners, isDragging,
}: {
  story: UserStory;
  /** Children sitting in the story's own column; the rest are cards elsewhere. */
  tasks: Task[];
  /** Every child, wherever it currently sits — what the "N tasks" toggle counts. */
  totalTasks: number;
  /** Sub-stories sitting in this story's column, drawn above its tasks. */
  childStories?: UserStory[];
  /** Draws one sub-story; the panel passes its own renderer so nesting recurses. */
  renderChildStory?: (story: UserStory) => ReactNode;
  /** Given, the card's cells edit in place, exactly as the list rows do. */
  onEdit?: (patch: DashRowPatch) => void;
  /** Same for the tasks drawn inside this card. */
  onEditTask?: (task: Task, patch: DashRowPatch) => void;
  /** Subtasks of a task drawn inside this card, and which of them are open. */
  subtasksOf?: (taskId: string) => Task[];
  expandedTaskIds?: Set<string>;
  onToggleTaskExpand?: (taskId: string) => void;
  /** People assignable to this story's project. */
  members?: DashUser[];
  /** A request for this story is in flight. */
  busy?: boolean;
  /** Ids in flight, for the tasks drawn inside this card. */
  busyIds?: Set<string>;
  expanded: boolean;
  onToggleExpand: () => void;
  onClick: () => void;
  onTaskClick: (t: Task) => void;
  onAddTask?: () => void;
  users: { id: string; name: string; avatar: string }[];
  showProjectPill?: boolean;
  isManager?: boolean;
  doneColumnId?: string;
  dragRef?: (node: HTMLElement | null) => void;
  dragStyle?: CSSProperties;
  dragAttributes?: HTMLAttributes<HTMLElement>;
  dragListeners?: HTMLAttributes<HTMLElement>;
  isDragging?: boolean;
}) {
  const allTasks = useAppStore(s => s.tasks);
  const aids = storyAssigneeIds(story);
  const priority = normalizePriority(String(story.priority));
  const assignees = aids.map(id => users.find(x => x.id === id)).filter(Boolean) as typeof users;
  const hours = rollupStoryHours(allTasks, story.id);
  return (
    <div
      ref={dragRef}
      style={{ ...dragStyle, opacity: isDragging ? 0 : 1 }}
      className="touch-none select-none"
    >
      <div
        className={`relative rounded-xl border border-border/70 bg-card p-3 flex flex-col transition-shadow ${CARD_SHADOW} ${
          busy ? 'pointer-events-none' : ''
        }`}
      >
        {busy && (
          <span className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-card/70">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </span>
        )}
        <div
          {...dragAttributes}
          {...dragListeners}
          role="button"
          tabIndex={0}
          onClick={onClick}
          onKeyDown={e => { if (e.key === 'Enter') onClick(); }}
          className="cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/60">
              <BookOpen className="h-3 w-3 text-primary" /> Story
            </span>
            {onEdit ? (
              <span className="shrink-0" onClick={e => e.stopPropagation()}>
                <PriorityCell priority={priority} onChange={p => onEdit({ priority: p })} />
              </span>
            ) : (
              <span className={`text-[10px] font-semibold ${priorityTextClass[priority]}`}>{priority}</span>
            )}
          </div>
          <h4 className="text-[13px] font-semibold leading-snug text-foreground line-clamp-2 break-words">{story.title}</h4>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <BoardCardMetaPills
              projectId={story.projectId}
              sprint={story.sprint}
              estimatedHours={hours.estimatedHours}
              actualHours={hours.actualHours}
            />
          </div>
          <div className="mt-1.5 flex items-end justify-between gap-2">
            {onEdit ? (
              <span className="group shrink-0" onClick={e => e.stopPropagation()}>
                <AssigneeCell
                  assigneeIds={aids}
                  members={members}
                  onChange={ids => onEdit({ assigneeIds: ids })}
                />
              </span>
            ) : (
              <div className="flex -space-x-1.5 shrink-0">
                {assignees.slice(0, 3).map(u => (
                  <UserAvatar key={u.id} name={u.name} avatar={u.avatar} size="xs" className="ring-2 ring-card" />
                ))}
                {assignees.length === 0 && (
                  <UserPlus2 className="h-3.5 w-3.5 text-muted-foreground/40" />
                )}
              </div>
            )}
            {onEdit ? (
              <span className="group shrink-0" onClick={e => e.stopPropagation()}>
                <DueDateCell
                  dueDate={story.dueDate ?? ''}
                  isDone={false}
                  onChange={iso => onEdit({ dueDate: iso })}
                />
              </span>
            ) : story.dueDate?.trim() ? (
              <span className="text-[11px] font-mono text-muted-foreground/75 shrink-0">{listDate(story.dueDate)}</span>
            ) : null}
          </div>
        </div>
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            onClick={e => { e.stopPropagation(); onToggleExpand(); }}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
            {totalTasks} {totalTasks === 1 ? 'item' : 'items'}
          </button>
          {onAddTask && (
            <Hint label="Add task">
              <button
                type="button"
                aria-label="Add task"
                className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground"
                onClick={e => { e.stopPropagation(); onAddTask(); }}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </Hint>
          )}
        </div>
      </div>
      {expanded && (
        <div className="mt-1.5 ml-2 space-y-1.5 border-l-2 border-border/60 pl-2">
          {childStories.map(child => renderChildStory?.(child))}
          {tasks.length === 0 && childStories.length === 0 ? (
            <p className="py-1.5 text-xs text-muted-foreground">No tasks yet.</p>
          ) : tasks.map(t => (
            <SortableTaskCard
              key={t.id}
              task={t}
              onClick={() => onTaskClick(t)}
              showProjectPill={showProjectPill}
              onEdit={onEditTask ? patch => onEditTask(t, patch) : undefined}
              members={members}
              busy={busyIds?.has(t.id)}
              subtasks={subtasksOf?.(t.id) ?? []}
              expanded={!!expandedTaskIds?.has(t.id)}
              onToggleExpand={() => onToggleTaskExpand?.(t.id)}
              onSubtaskClick={onTaskClick}
              renderSubtask={st => (
                <SortableTaskCard
                  key={st.id}
                  task={st}
                  onClick={() => onTaskClick(st)}
                  showProjectPill={showProjectPill}
                  onEdit={onEditTask ? patch => onEditTask(st, patch) : undefined}
                  members={members}
                />
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SortableStoryCard(props: Omit<Parameters<typeof StoryBoardCard>[0], 'dragRef' | 'dragStyle' | 'dragAttributes' | 'dragListeners' | 'isDragging'>) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: storyDragId(props.story.id),
    data: { type: 'story' as const, storyId: props.story.id },
  });
  return (
    <StoryBoardCard
      {...props}
      dragRef={setNodeRef}
      dragStyle={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined }}
      dragAttributes={attributes as HTMLAttributes<HTMLElement>}
      dragListeners={listeners as HTMLAttributes<HTMLElement>}
      isDragging={isDragging}
    />
  );
}

function KanbanColumnPanel({
  column, taskCards, stories, storyTasksById, storyTaskTotals, childStoriesById,
  subtasksByTask, expandedTaskIds, onToggleTaskExpand, busyIds,
  onEditStory, onEditTask, membersForProject,
  onTaskClick, onStoryClick, onStoryTaskClick,
  expandedStoryIds, onToggleStoryExpand, onNewTask, onNewStory, onAddStoryTask, isDropTarget, isManager,
  isDoneColumn, onSetDoneColumn, onRenameColumn, onDeleteColumn, onSetColor, showProjectPill,
  users, columns, doneColumnId,
}: {
  column: KanbanColumn;
  /** Task cards in this column. `storyTitle` is set for one pulled out of a story. */
  taskCards: BoardTaskCard[];
  stories: UserStory[];
  /** Per story: the children that sit in the story's own column. */
  storyTasksById: Record<string, Task[]>;
  /** Per story: how many children exist in total, across every column. */
  storyTaskTotals: Record<string, number>;
  /** Sub-stories per parent, already scoped to the stories in view. */
  childStoriesById: Record<string, UserStory[]>;
  /** Entity ids with a request in flight. */
  busyIds?: Set<string>;
  /** Subtasks per task, and which cards are open. */
  subtasksByTask: Record<string, Task[]>;
  expandedTaskIds: Set<string>;
  onToggleTaskExpand: (taskId: string) => void;
  /** One-click cell edits, the same ones the list rows offer. */
  onEditStory: (story: UserStory, patch: DashRowPatch) => void;
  onEditTask: (task: Task, patch: DashRowPatch) => void;
  membersForProject: (projectId: string) => DashUser[];
  onTaskClick: (t: Task) => void;
  onStoryClick: (s: UserStory) => void;
  onStoryTaskClick: (t: Task) => void;
  expandedStoryIds: Set<string>;
  onToggleStoryExpand: (id: string) => void;
  onNewTask: () => void;
  onNewStory: () => void;
  onAddStoryTask?: (s: UserStory) => void;
  isDropTarget: boolean; isManager: boolean;
  isDoneColumn: boolean; onSetDoneColumn: () => void;
  onRenameColumn: () => void; onDeleteColumn: () => void;
  onSetColor: (color: string) => void;
  showProjectPill?: boolean;
  users: { id: string; name: string; avatar: string }[];
  columns: KanbanColumn[];
  doneColumnId: string;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({
    id: column.id, data: { type: 'column' as const },
  });
  const isProtected = PROTECTED_IDS.has(column.id);
  const colorTokens = columnColorTokens(column.color);

  /** Sub-stories of `id` whose own status keeps them in this column. */
  const childStoriesInColumn = (id: string) =>
    (childStoriesById[id] ?? []).filter(
      c => statusColId(c.status, columns, doneColumnId) === column.id,
    );

  /**
   * Every draggable id this column actually renders, once each.
   *
   * A sortable id may appear in one context only: registering the whole board's
   * subtasks in every column made dnd-kit resolve drags against the wrong node,
   * which showed up as cards refusing to move and rows going missing.
   */
  const sortableIds = () => {
    const ids: string[] = [];
    const walkStory = (story: UserStory) => {
      ids.push(storyDragId(story.id));
      for (const t of storyTasksById[story.id] ?? []) {
        ids.push(t.id);
        for (const st of subtasksByTask[t.id] ?? []) ids.push(st.id);
      }
      childStoriesInColumn(story.id).forEach(walkStory);
    };
    stories.forEach(walkStory);
    for (const card of taskCards) {
      ids.push(card.task.id);
      for (const st of subtasksByTask[card.task.id] ?? []) ids.push(st.id);
    }
    return [...new Set(ids)];
  };

  /**
   * Draws a story and, under it, the sub-stories and tasks that share its
   * column. A sub-story whose status moved on is a card of its own elsewhere,
   * exactly like a task that moved on — the board and the list agree.
   */
  const renderStory = (story: UserStory): ReactNode => {
    const kids = childStoriesInColumn(story.id);
    return (
      <SortableStoryCard
        key={story.id}
        story={story}
        tasks={storyTasksById[story.id] ?? []}
        totalTasks={(storyTaskTotals[story.id] ?? 0) + kids.length}
        childStories={kids}
        renderChildStory={renderStory}
        onEdit={patch => onEditStory(story, patch)}
        busy={busyIds?.has(story.id)}
        busyIds={busyIds}
        onEditTask={onEditTask}
        subtasksOf={id => subtasksByTask[id] ?? []}
        expandedTaskIds={expandedTaskIds}
        onToggleTaskExpand={onToggleTaskExpand}
        members={membersForProject(story.projectId)}
        expanded={expandedStoryIds.has(story.id)}
        onToggleExpand={() => onToggleStoryExpand(story.id)}
        onClick={() => onStoryClick(story)}
        onTaskClick={onStoryTaskClick}
        onAddTask={() => onAddStoryTask?.(story)}
        users={users}
        showProjectPill={showProjectPill}
        isManager={isManager}
        doneColumnId={doneColumnId}
      />
    );
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: transition ?? undefined, opacity: isDragging ? 0.4 : 1 }}
      className={`min-w-[300px] w-[85vw] shrink-0 sm:min-w-[340px] sm:w-[340px] lg:w-auto lg:min-w-0 lg:flex-1 lg:basis-0 lg:shrink flex flex-col rounded-2xl transition-[box-shadow,background-color] duration-150 ease-out ${isDropTarget ? 'ring-2 ring-blue-500/50 bg-blue-500/5' : ''}`}
    >
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2">
          <button {...attributes} {...listeners} onClick={e => e.stopPropagation()}
            className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors touch-none p-0.5 rounded">
            <GripVertical className="h-4 w-4" />
          </button>
          <h3 className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${colorTokens.pill}`}>
            {column.label}
          </h3>
          <span className="text-[11px] font-medium text-muted-foreground">{stories.length + taskCards.length}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <AddWorkMenu
            hint="Add a story or task"
            onTask={onNewTask}
            onStory={onNewStory}
            trigger={
              <button
                type="button"
                aria-label="Add a story or task"
                className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors"
              >
                <Plus className="h-4 w-4" />
              </button>
            }
          />
          <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-lg hover:bg-muted/60 text-muted-foreground/50 hover:text-muted-foreground transition-colors">
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onSetDoneColumn} className="gap-2">
              <Flag className="h-3.5 w-3.5" />
              {isDoneColumn ? 'Unset as Done column' : 'Set as Done column'}
              {isDoneColumn && <Check className="h-3.5 w-3.5 ml-auto text-green-500" />}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRenameColumn} className="gap-2">
              <Pencil className="h-3.5 w-3.5" />
              Rename column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <div className="px-2 py-1.5">
              <p className="mb-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <Palette className="h-3.5 w-3.5" /> Colour
              </p>
              <div className="grid grid-cols-5 gap-1.5">
                {COLUMN_COLOR_KEYS.map(key => (
                  <button
                    key={key}
                    type="button"
                    title={key}
                    aria-label={key}
                    onClick={e => { e.preventDefault(); onSetColor(key); }}
                    className={`h-5 w-5 rounded-full ${columnColorTokens(key).dot} ${
                      (column.color ?? DEFAULT_COLUMN_COLOR) === key
                        ? 'ring-2 ring-foreground/60 ring-offset-1 ring-offset-background'
                        : ''
                    }`}
                  />
                ))}
              </div>
            </div>
            {!isProtected && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onDeleteColumn} className="gap-2 text-destructive focus:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete column
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        </div>
      </div>

      <div className={`space-y-2 flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl px-1.5 pt-2 pb-2 ${colorTokens.surface}`}>
        <SortableContext
          items={sortableIds()}
          strategy={verticalListSortingStrategy}
        >
          {stories.map(story => renderStory(story))}
          {taskCards.map(({ task, storyTitle }) => (
            <SortableTaskCard
              key={task.id}
              task={task}
              userStoryTitle={storyTitle}
              onClick={() => onTaskClick(task)}
              showProjectPill={showProjectPill}
              onEdit={patch => onEditTask(task, patch)}
              members={membersForProject(task.projectId)}
              busy={busyIds?.has(task.id)}
              subtasks={subtasksByTask[task.id] ?? []}
              expanded={expandedTaskIds.has(task.id)}
              onToggleExpand={() => onToggleTaskExpand(task.id)}
              onSubtaskClick={onTaskClick}
              renderSubtask={st => (
                <SortableTaskCard
                  key={st.id}
                  task={st}
                  onClick={() => onTaskClick(st)}
                  showProjectPill={showProjectPill}
                  onEdit={patch => onEditTask(st, patch)}
                  members={membersForProject(st.projectId)}
                />
              )}
            />
          ))}
        </SortableContext>
        <AddWorkMenu
          onTask={onNewTask}
          onStory={onNewStory}
          trigger={
            <button
              type="button"
              className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium hover:bg-background/60 ${colorTokens.accent}`}
            >
              <Plus className="h-3.5 w-3.5" /> Add task
            </button>
          }
        />
      </div>
    </div>
  );
}

/**
 * Invisible droppable that sits over the fixed Tasker mascot (bottom-right). It
 * lives inside the board's DndContext so dnd-kit can detect a card dropped on the
 * mascot; the mascot itself (Companion) is rendered in AppLayout, outside this
 * context, and reacts via the store drag-bus.
 */
function MascotDropZone() {
  const { setNodeRef } = useDroppable({ id: 'tasker-dropzone' });
  return (
    <div
      ref={setNodeRef}
      aria-hidden
      className="pointer-events-none fixed bottom-2 right-2 z-30 h-[120px] w-[88px]"
    />
  );
}

function listDate(iso: string) {
  if (!iso?.trim()) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

const DashboardPage = () => {
  const currentUser = useAppStore(s => s.currentUser);
  const projects = useAppStore(s => s.projects);
  const selectProject = useAppStore(s => s.selectProject);
  const tasks = useAppStore(s => s.tasks);
  const selectedProjectId = useAppStore(s => s.selectedProjectId);
  const users = useAppStore(s => s.users);
  const moveTask = useAppStore(s => s.moveTask);
  const kanbanColumns = useAppStore(s => s.kanbanColumns);
  const syncTasks = useAppStore(s => s.syncTasks);
  const activeTimers = useAppStore(s => s.activeTimers);
  const stopTimer = useAppStore(s => s.stopTimer);
  const addColumn = useAppStore(s => s.addColumn);
  const renameColumn = useAppStore(s => s.renameColumn);
  const removeColumn = useAppStore(s => s.removeColumn);
  const reorderColumns = useAppStore(s => s.reorderColumns);
  const setColumnColor = useAppStore(s => s.setColumnColor);
  const updateTask = useAppStore(s => s.updateTask);
  const createTask = useAppStore(s => s.createTask);
  const deleteTask = useAppStore(s => s.deleteTask);
  const mascotsEnabled = useAppStore(s => s.mascotsEnabled);
  const setMascotDrag = useAppStore(s => s.setMascotDrag);
  const setMascotDropTask = useAppStore(s => s.setMascotDropTask);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedStory, setSelectedStory] = useState<UserStory | null>(null);

  useEffect(() => {
    function handle(e: Event) {
      const taskId = (e as CustomEvent<{ taskId: string }>).detail?.taskId;
      if (!taskId) return;
      const found = tasks.find(t => t.id === taskId);
      if (found) setSelectedTask(found);
    }
    window.addEventListener('zet:open-task', handle);
    return () => window.removeEventListener('zet:open-task', handle);
  }, [tasks]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeType, setActiveType] = useState<ActiveDrag | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createStatus, setCreateStatus] = useState<string | undefined>();

  // Done column selection (persisted)
  const [doneColumnId, setDoneColumnId] = useState<string>(() => localStorage.getItem(DONE_COL_KEY) ?? 'done');

  // Add column modal
  const [addColOpen, setAddColOpen] = useState(false);
  const [newColName, setNewColName] = useState('');
  const addColInputRef = useRef<HTMLInputElement>(null);

  // Rename column modal
  const [renameColOpen, setRenameColOpen] = useState(false);
  const [renamingCol, setRenamingCol] = useState<KanbanColumn | null>(null);
  const [renameColName, setRenameColName] = useState('');
  const renameColInputRef = useRef<HTMLInputElement>(null);

  const boardColumns = useMemo(() => kanbanColumns.length > 0 ? kanbanColumns
    : [{ id: 'backlog', label: 'Backlog' }, { id: 'in_progress', label: 'In Progress' }, { id: 'in_review', label: 'In Review' }, { id: 'done', label: 'Done' }],
  [kanbanColumns]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const { busyIds, withBusy, busy } = useBusyIds();

  const collisionDetection = useCallback<CollisionDetection>(args => {
    const pointer = pointerWithin(args);
    if (pointer.length > 0) return pointer;
    return rectIntersection(args);
  }, []);

  /**
   * Projects this person works in.
   *
   * A superadmin sees everything by design but is not a member of anything, so
   * scoping strictly by membership left them with no projects — and therefore
   * no tasks, no stories, an empty dashboard on a database full of work.
   */
  const userProjects = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'superadmin') return projects;
    return projects.filter(p => currentUser.projectIds.includes(p.id));
  }, [currentUser, projects]);
  const isManager = currentUser?.role === 'manager' || currentUser?.role === 'superadmin';
  const isAllProjects = selectedProjectId === 'all';
  const projectSelected = isAllProjects || (!!selectedProjectId && userProjects.some(p => p.id === selectedProjectId));
  /**
   * Every task in scope, subtasks included.
   *
   * The tree needs the whole set: it promotes only top-level tasks to rows of
   * their own and reads the rest as children. Filtering subtasks out here left
   * `childTasksOf` nothing to find, so a task with subtasks showed no expander
   * in the list and nothing on its board card.
   */
  const scopedTasks = useMemo(() => {
    if (!projectSelected) return [];
    return isAllProjects
      ? tasks.filter(t => userProjects.some(p => p.id === t.projectId))
      : tasks.filter(t => t.projectId === selectedProjectId);
  }, [projectSelected, isAllProjects, tasks, userProjects, selectedProjectId]);

  const [dashPriorityFilter, setDashPriorityFilter] = useState<Set<Priority>>(() => new Set());
  const [dashDateFrom, setDashDateFrom] = useState('');
  const [dashDateTo, setDashDateTo] = useState('');
  const [dashAssigneeFilter, setDashAssigneeFilter] = useState<Set<string>>(() => new Set());
  const [dashSprintFilter, setDashSprintFilter] = useState<Set<string>>(() => new Set());
  const { data: allStories = [] } = useQuery({
    queryKey: storyKeys.all,
    queryFn: () => api.listUserStories(),
    staleTime: STORY_STALE_TIME,
    enabled: !!currentUser,
  });
  const dashStories = useMemo(() => {
    if (!selectedProjectId) return [];
    if (selectedProjectId === 'all') {
      const ids = new Set(userProjects.map(p => p.id));
      return allStories.filter(s => ids.has(s.projectId));
    }
    return allStories.filter(s => s.projectId === selectedProjectId);
  }, [allStories, selectedProjectId, userProjects]);
  const [dashView, setDashView] = useState<DashView>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    return saved === 'board' || saved === 'list' ? saved : 'list';
  });
  const [expandedStoryIds, setExpandedStoryIds] = useState<Set<string>>(() => new Set());
  /** Board cards showing their subtasks. */
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(() => new Set());
  const toggleTaskExpanded = useCallback((taskId: string) => {
    setExpandedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);
  // List view: one expansion set for every depth (story, task, subtask) and one
  // collapse set covering both project bands and groups. The board keeps its own
  // story expansion because a card expands in place there.
  const [expandedRowIds, setExpandedRowIds] = useState<Set<string>>(() => new Set());
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [dashSearch, setDashSearch] = useState('');
  const [dashGroupBy, setDashGroupBy] = useState<DashGroupBy>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(GROUP_KEY) : null;
    return saved === 'status' || saved === 'assignee' || saved === 'priority' || saved === 'none'
      ? saved
      : 'status';
  });
  const [dashSortBy, setDashSortBy] = useState<DashSortBy>('default');
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  const [lockCreateStory, setLockCreateStory] = useState<UserStory | null>(null);
  const [lockCreateProjectId, setLockCreateProjectId] = useState<string | null>(null);
  const [createStoryOpen, setCreateStoryOpen] = useState(false);
  const [createStoryProjectId, setCreateStoryProjectId] = useState<string | undefined>();
  const [createStoryStatus, setCreateStoryStatus] = useState('backlog');

  useEffect(() => {
    function handle(e: Event) {
      const storyId = (e as CustomEvent<{ storyId: string }>).detail?.storyId;
      if (!storyId) return;
      const found = dashStories.find(s => s.id === storyId);
      if (found) {
        setSelectedStory(found);
        return;
      }
      void api.getUserStory(storyId).then(s => {
        setSelectedStory(s);
        upsertUserStory(s);
      }).catch(() => {});
    }
    window.addEventListener('zet:open-story', handle);
    return () => window.removeEventListener('zet:open-story', handle);
  }, [dashStories]);

  const projectTasks = scopedTasks;

  const scopedProjectId = selectedProjectId && selectedProjectId !== 'all' ? selectedProjectId : undefined;

  const openCreateStory = (status?: string, projectId?: string) => {
    setCreateStoryProjectId(projectId ?? scopedProjectId);
    setCreateStoryStatus(status || 'backlog');
    setCreateStoryOpen(true);
  };

  const openCreateForStory = (story: UserStory | null, status?: string, projectId?: string) => {
    setLockCreateStory(story);
    setLockCreateProjectId(story ? null : (projectId ?? scopedProjectId ?? null));
    setCreateStatus(status);
    setCreateOpen(true);
  };

  const toggleDashSprint = useCallback((value: string) => {
    setDashSprintFilter(prev => {
      const n = new Set(prev);
      if (n.has(value)) n.delete(value);
      else n.add(value);
      return n;
    });
  }, []);

  const dashSprintOptions = useMemo(() => {
    const names = new Set<string>();
    let hasBlank = false;
    for (const t of scopedTasks) {
      const s = (t.sprint ?? '').trim();
      if (s) names.add(s);
      else hasBlank = true;
    }
    for (const st of dashStories) {
      const s = (st.sprint ?? '').trim();
      if (s) names.add(s);
      else hasBlank = true;
    }
    return { names: [...names].sort((a, b) => a.localeCompare(b)), hasBlank };
  }, [scopedTasks, dashStories]);

  const toggleDashPriority = useCallback((p: Priority) => {
    setDashPriorityFilter(prev => {
      const n = new Set(prev);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });
  }, []);

  const toggleDashAssignee = useCallback((userId: string) => {
    setDashAssigneeFilter(prev => {
      const n = new Set(prev);
      if (n.has(userId)) n.delete(userId);
      else n.add(userId);
      return n;
    });
  }, []);

  const dashFilterableMembers = useMemo(() => {
    const memberIds = new Set<string>();
    if (isAllProjects) {
      for (const p of userProjects) {
        for (const id of p.members) memberIds.add(id);
      }
    } else if (selectedProjectId) {
      const p = userProjects.find(pr => pr.id === selectedProjectId);
      if (p) for (const id of p.members) memberIds.add(id);
    }
    return users
      .filter(u => memberIds.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [users, userProjects, isAllProjects, selectedProjectId]);

  /**
   * One filtered, sorted tree feeds BOTH views. The old pipeline filtered
   * top-level work but pulled story children straight from the raw task list, so
   * a filter silently did not apply to anything nested under a story.
   */
  const dashFilters = useMemo(
    () => ({
      priority: dashPriorityFilter,
      assignees: dashAssigneeFilter,
      sprints: dashSprintFilter,
      dateFrom: dashDateFrom,
      dateTo: dashDateTo,
      search: dashSearch,
    }),
    [dashPriorityFilter, dashAssigneeFilter, dashSprintFilter, dashDateFrom, dashDateTo, dashSearch],
  );

  const dashTree = useMemo(
    () => sortDashTree(filterDashTree(buildDashTree(dashStories, projectTasks), dashFilters), dashSortBy),
    [dashStories, projectTasks, dashFilters, dashSortBy],
  );

  /**
   * Every story in view, nested ones included.
   *
   * The tree hangs a sub-story off its parent, so reading only the top level
   * lost them — and their tasks with them — from the board.
   */
  const storyNodes = useMemo(() => {
    const out: DashNode[] = [];
    const walk = (nodes: DashNode[]) => {
      for (const n of nodes) {
        if (n.type !== 'story') continue;
        out.push(n);
        walk(n.children);
      }
    };
    walk(dashTree);
    return out;
  }, [dashTree]);
  const filteredStories = useMemo(
    () => storyNodes.map(n => n.story!).filter(Boolean),
    [storyNodes],
  );
  const orphanTasks = useMemo(
    () => dashTree.filter(n => n.type === 'task').map(n => n.task!).filter(Boolean),
    [dashTree],
  );
  const storyTasksById = useMemo(() => {
    const m: Record<string, Task[]> = {};
    // `children` mixes sub-stories and tasks; only the tasks belong here.
    for (const node of storyNodes) {
      m[node.entityId] = node.children.filter(c => c.type !== 'story').map(c => c.task!).filter(Boolean);
    }
    return m;
  }, [storyNodes]);

  /**
   * Subtasks per task, from anywhere in the tree.
   *
   * The board only ever read the top two levels, so a task's subtasks were
   * invisible there — the card said nothing and they had no card of their own.
   */
  const subtasksByTask = useMemo(() => {
    const m: Record<string, Task[]> = {};
    const walk = (nodes: DashNode[]) => {
      for (const n of nodes) {
        if (n.type !== 'story') {
          const kids = n.children.map(c => c.task!).filter(Boolean);
          if (kids.length > 0) m[n.entityId] = kids;
        }
        walk(n.children);
      }
    };
    walk(dashTree);
    return m;
  }, [dashTree]);

  const dashGroups = useMemo(
    () => groupDashNodes(dashTree, dashGroupBy, { columns: boardColumns, doneColumnId, users }),
    [dashTree, dashGroupBy, boardColumns, doneColumnId, users],
  );

  /** Assignee popover offers the row's own project members, not every user. */
  const membersByProject = useMemo(() => {
    const m: Record<string, { id: string; name: string; avatar: string }[]> = {};
    for (const p of userProjects) {
      m[p.id] = users
        .filter(u => p.members.includes(u.id))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return m;
  }, [userProjects, users]);
  const membersForProject = useCallback(
    (projectId: string) => membersByProject[projectId] ?? [],
    [membersByProject],
  );

  /** Project the inline composer writes into: the scoped one, else the first. */
  const composerProject = useMemo(
    () => userProjects.find(p => p.id === scopedProjectId) ?? userProjects[0],
    [userProjects, scopedProjectId],
  );

  /** Row chips name the project; only worth showing when several are in view. */
  const projectNames = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of userProjects) m[p.id] = projectPickerLabel(p);
    return m;
  }, [userProjects]);

  /**
   * Board placement.
   *
   * A column IS a status, so a card can only live in the column matching its own
   * status. A story's task therefore nests under the story only while the two
   * agree; drag it elsewhere and it becomes its own card in that column, carrying
   * the story's name. Without this a task dragged out of a story would change
   * status and then not move, which reads as a broken drag.
   *
   * Every task lands in exactly one place — nested or standalone, never both.
   */
  const colOf = useCallback(
    (status: string) => statusColId(status, boardColumns, doneColumnId),
    [boardColumns, doneColumnId],
  );

  const storyColumnById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const st of filteredStories) m[st.id] = colOf(st.status);
    return m;
  }, [filteredStories, colOf]);

  /** Children whose status has taken them out of their story's column. */
  const awayTaskIds = useMemo(() => {
    const out = new Set<string>();
    for (const [sid, kids] of Object.entries(storyTasksById)) {
      for (const t of kids) {
        if (colOf(t.status) !== storyColumnById[sid]) out.add(t.id);
      }
    }
    return out;
  }, [storyTasksById, storyColumnById, colOf]);

  /**
   * A story card lists the children still in its column. One that moved on is a
   * card of its own in the column its status names, and belongs to nobody there.
   */
  const nestedStoryTasks = useMemo(() => {
    const m: Record<string, Task[]> = {};
    for (const [sid, kids] of Object.entries(storyTasksById)) {
      m[sid] = kids.filter(t => !awayTaskIds.has(t.id));
    }
    return m;
  }, [storyTasksById, awayTaskIds]);

  const storyTaskTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [sid, kids] of Object.entries(nestedStoryTasks)) m[sid] = kids.length;
    return m;
  }, [nestedStoryTasks]);

  /**
   * Cards of their own: tasks belonging to no story, plus story children whose
   * status has moved them out of their story's column. A task's status is its
   * own, so it sits in that column and the story card lists it as a reference.
   */
  const boardTaskCards = useMemo<BoardTaskCard[]>(() => {
    const out: BoardTaskCard[] = orphanTasks.map(task => ({ task }));
    const titleOf = new Map(filteredStories.map(st => [st.id, st.title]));
    for (const [sid, kids] of Object.entries(storyTasksById)) {
      for (const task of kids) {
        if (awayTaskIds.has(task.id)) out.push({ task, storyTitle: titleOf.get(sid) });
      }
    }
    return out;
    // A subtask never gets a card of its own here: it is drawn on its task's
    // card, so listing it again would show the same work twice.
  }, [orphanTasks, storyTasksById, awayTaskIds, filteredStories]);

  const taskCardsForColumn = (colId: string) =>
    boardTaskCards.filter(c => colOf(c.task.status) === colId);
  /** Sub-stories grouped under their parent, scoped to what is in view. */
  const childStoriesById = useMemo(() => {
    const visible = new Set(filteredStories.map(s => s.id));
    const m: Record<string, UserStory[]> = {};
    for (const s of filteredStories) {
      const parentId = s.parentStoryId ?? '';
      if (!parentId || parentId === s.id || !visible.has(parentId)) continue;
      (m[parentId] ??= []).push(s);
    }
    return m;
  }, [filteredStories]);

  /**
   * Cards at the top of a column: stories with no parent in view, plus any whose
   * parent sits in a different column — nested only where the parent can hold it.
   */
  const storiesForColumn = (colId: string) => {
    const visible = new Set(filteredStories.map(s => s.id));
    const columnOf = new Map(filteredStories.map(s => [s.id, colOf(s.status)]));
    return filteredStories.filter(st => {
      if (colOf(st.status) !== colId) return false;
      const parentId = st.parentStoryId ?? '';
      if (!parentId || parentId === st.id || !visible.has(parentId)) return true;
      return columnOf.get(parentId) !== colId;
    });
  };

  const handleSetDoneColumn = (colId: string) => {
    const next = doneColumnId === colId ? 'done' : colId;
    setDoneColumnId(next);
    localStorage.setItem(DONE_COL_KEY, next);
  };

  const openRename = (col: KanbanColumn) => {
    setRenamingCol(col);
    setRenameColName(col.label);
    setRenameColOpen(true);
  };

  const resolveOverCol = (overId: string): string | null => {
    if (boardColumns.some(c => c.id === overId)) return overId;
    const overStoryId = parseStoryDragId(overId);
    if (overStoryId) {
      const s = dashStories.find(x => x.id === overStoryId);
      return s ? statusColId(s.status, boardColumns, doneColumnId) : null;
    }
    const task = tasks.find(t => t.id === overId);
    // Normalise like the story branch: a raw status can be "completed" or a
    // column that no longer exists, neither of which is a droppable column.
    return task ? statusColId(task.status, boardColumns, doneColumnId) : null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type as ActiveDrag | undefined;
    const id = event.active.id as string;
    setActiveId(id);
    const next: ActiveDrag = type === 'column' ? 'column' : (type === 'story' || parseStoryDragId(id) ? 'story' : 'task');
    setActiveType(next);
    if (mascotsEnabled && next === 'task') setMascotDrag(true, false);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    const type = active.data.current?.type as ActiveDrag | undefined;
    if (mascotsEnabled && type === 'task') setMascotDrag(true, over?.id === 'tasker-dropzone');
    if (!over || type === 'column') { setOverColumnId(null); return; }
    const overId = over.id as string;
    if (overId === 'tasker-dropzone') { setOverColumnId(null); return; }
    setOverColumnId(resolveOverCol(overId));
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null); setActiveType(null); setOverColumnId(null);
    setMascotDrag(false, false);
    // Whatever this drag turns out to be, the card it touches is working until
    // the request settles.
    const activeEntityId = parseStoryDragId(String(active.id)) ?? String(active.id);
    await withBusy(activeEntityId, async () => {
    if (!over) return;
    const dragType = (active.data.current?.type as ActiveDrag | undefined)
      ?? (parseStoryDragId(active.id as string) ? 'story' : 'task');
    const activeIdStr = active.id as string;
    const overIdStr = over.id as string;

    if (overIdStr === 'tasker-dropzone') {
      if (dragType === 'task') setMascotDropTask(activeIdStr);
      return;
    }

    if (dragType === 'column') {
      const oldIdx = boardColumns.findIndex(c => c.id === activeIdStr);
      const newIdx = boardColumns.findIndex(c => c.id === overIdStr);
      if (oldIdx !== -1 && newIdx !== -1 && oldIdx !== newIdx) {
        try { await reorderColumns(arrayMove(boardColumns, oldIdx, newIdx)); }
        catch { toast.error('Could not reorder columns'); }
      }
      return;
    }

    const targetCol = resolveOverCol(overIdStr);
    if (!targetCol) return;

    if (dragType === 'story') {
      const sid = parseStoryDragId(activeIdStr) ?? (active.data.current?.storyId as string | undefined);
      if (!sid) return;
      const story = dashStories.find(s => s.id === sid);
      if (!story) return;

      // Dropped on another story's card: nest it there.
      const hostId = parseStoryDragId(overIdStr);
      if (hostId && hostId !== sid) {
        const host = dashStories.find(x => x.id === hostId);
        if (!host) return;
        if (host.projectId !== story.projectId) {
          toast.error('Move it to the same project first');
          return;
        }
        try {
          const updated = await api.patchUserStory(sid, { parentStoryId: hostId });
          upsertUserStory(updated);
          toast.success(`Moved into "${host.title}"`);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'Could not move that story');
        }
        return;
      }

      // Dropped on a column: outside every story, so it stops being a sub-story.
      const leftParent = !!story.parentStoryId;
      const sameColumn = statusColId(story.status, boardColumns, doneColumnId) === targetCol;
      if (sameColumn && !leftParent) return;
      try {
        const updated = await api.patchUserStory(sid, {
          ...(sameColumn ? {} : { status: targetCol }),
          ...(leftParent ? { parentStoryId: '' } : {}),
        });
        if (leftParent) toast.success('Moved out on its own');
        upsertUserStory(updated);
        setSelectedStory(prev => (prev?.id === updated.id ? updated : prev));
        if (updated.status === 'completed' || updated.status === 'done' || updated.status === doneColumnId) {
          await syncTasks();
        }
      } catch {
        toast.error('Could not move story');
      }
      return;
    }

    try {
      const dragged = tasks.find(t => t.id === activeIdStr);
      if (!dragged) return;

      // Dropped on a story card: that is how a task joins a story, and the only
      // way it ever does.
      const dropStoryId = parseStoryDragId(overIdStr);
      if (dropStoryId) {
        if (dragged.userStoryId === dropStoryId) return;
        const host = dashStories.find(x => x.id === dropStoryId);
        if (!host) return;
        if (host.projectId !== dragged.projectId) {
          toast.error('Move it to the same project first');
          return;
        }
        await updateTask(activeIdStr, { userStoryId: dropStoryId, parentTaskId: null });
        toast.success(`Moved into "${host.title}"`);
        return;
      }

      // Dropped on a column instead: that is outside every story, so the task
      // leaves the one it was in rather than staying a member somewhere else.
      const leftStory = !!(dragged.userStoryId || dragged.parentTaskId);
      const sameColumn = statusColId(dragged.status, boardColumns, doneColumnId) === targetCol;
      if (sameColumn && !leftStory) return;

      const enteringDone =
        isDoneBoardStatus(targetCol, doneColumnId)
        && !isDoneBoardStatus(dragged.status, doneColumnId);
      let hours: number | undefined;
      if (enteringDone) {
        const answer = await promptActualHours(dragged, 'done');
        // Cancelled — leave everything exactly as it was, timer included.
        if (answer === null) return;
        hours = answer;
      }
      // Stop the clock only once the move is definitely going ahead. Doing it
      // first meant cancelling the prompt left the timer stopped and the task
      // sitting in its old column.
      if (isDoneBoardStatus(targetCol, doneColumnId) && activeTimers[activeIdStr]) {
        await stopTimer(activeIdStr);
      }
      if (leftStory) {
        await updateTask(activeIdStr, { userStoryId: null, parentTaskId: null });
      }
      if (!sameColumn) await moveTask(activeIdStr, targetCol, hours);
      if (leftStory) toast.success('Moved out on its own');
    } catch { toast.error('Could not move task'); }
    });
  };

  const handleDragCancel = () => {
    setActiveId(null); setActiveType(null); setOverColumnId(null);
    setMascotDrag(false, false);
  };

  const handleAddColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newColName.trim();
    if (!name) return;
    try {
      await addColumn(name);
      toast.success(`Column "${name}" added`);
      setNewColName(''); setAddColOpen(false);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not add column'); }
  };

  const handleRenameColumn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renamingCol || !renameColName.trim()) return;
    try {
      await renameColumn(renamingCol.id, renameColName.trim());
      toast.success('Column renamed');
      setRenameColOpen(false); setRenamingCol(null);
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not rename column'); }
  };

  const handleSetColumnColor = async (colId: string, color: string) => {
    try {
      await setColumnColor(colId, color);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the colour');
    }
  };

  const handleDeleteColumn = async (colId: string) => {
    const ok = await confirmAction({
      title: 'Delete this column?',
      description: 'Tasks inside will move to Backlog.',
      confirmLabel: 'Delete column',
      destructive: true,
    });
    if (!ok) return;
    try {
      await removeColumn(colId);
      if (doneColumnId === colId) { setDoneColumnId('done'); localStorage.setItem(DONE_COL_KEY, 'done'); }
      toast.success('Column deleted');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Could not delete column'); }
  };

  const activeTask = activeId && activeType === 'task' ? tasks.find(t => t.id === activeId) : null;
  const activeStory = activeId && activeType === 'story'
    ? dashStories.find(s => s.id === (parseStoryDragId(activeId) ?? activeId))
    : null;
  const activeColumn = activeId && activeType === 'column' ? boardColumns.find(c => c.id === activeId) : null;

  if (!currentUser) return null;

  if (userProjects.length === 0) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}
        className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center">
        <h1 className="text-2xl font-semibold text-foreground">No project yet</h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">
          {isManager ? 'Create a project first, then pick it in the header to open your dashboard.' : 'You are not in any project yet. Ask a manager to add you to one.'}
        </p>
        {isManager && <Button asChild className="mt-8 rounded-xl"><Link to="/manage">Manage projects</Link></Button>}
      </motion.div>
    );
  }

  if (!projectSelected) {
    return (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter}
        className="p-6 flex flex-col items-center justify-center min-h-[calc(100vh-8rem)] text-center">
        <h1 className="text-2xl font-semibold text-foreground">Select a project</h1>
        <p className="text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">Choose a project from the menu at the top, or pick one here.</p>
        <select value={selectedProjectId || ''} onChange={e => selectProject(e.target.value || null)}
          className="mt-8 rounded-xl border bg-muted/50 px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[240px]">
          <option value="">Choose a project…</option>
          <option value="all">All projects</option>
          {userProjects.map(p => <option key={p.id} value={p.id}>{projectPickerLabel(p)}</option>)}
        </select>
      </motion.div>
    );
  }

  const selectedProjectName = isAllProjects
    ? 'All projects'
    : (() => {
        const p = userProjects.find(pr => pr.id === selectedProjectId);
        return p ? projectPickerLabel(p) : 'Dashboard';
      })();

  const setView = (v: DashView) => {
    setDashView(v);
    localStorage.setItem(VIEW_KEY, v);
  };
  const setGroupBy = (v: DashGroupBy) => {
    setDashGroupBy(v);
    localStorage.setItem(GROUP_KEY, v);
  };
  const toggleStoryExpanded = (id: string) => {
    setExpandedStoryIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleRowExpanded = (rowId: string) => {
    setExpandedRowIds(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };
  const toggleGroupCollapsed = (key: string) => {
    setCollapsedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const handleRowClick = (row: DashRow) => {
    if (row.story) setSelectedStory(row.story);
    else if (row.task) setSelectedTask(row.task);
  };
  const handleAddChild = (row: DashRow) => {
    if (row.story) openCreateForStory(row.story);
  };
  /**
   * A single-cell edit from the list. Stories and tasks persist through different
   * endpoints, and moving a task into Done still asks for actual hours — the same
   * prompt dragging a card onto the Done column shows.
   */
  const handleDeleteRow = async (row: DashRow) => {
    const isStory = row.type === 'story';
    const label = isStory ? 'story' : row.type === 'subtask' ? 'subtask' : 'task';
    const note = isStory
      ? 'This cannot be undone. Tasks under it stay in the project.'
      : 'This cannot be undone.';
    const ok = await confirmAction({
      title: `Delete this ${label}?`,
      description: note,
      confirmLabel: `Delete ${label}`,
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isStory) {
        await api.deleteUserStory(row.entityId);
        removeUserStory(row.entityId, row.projectId);
        setSelectedStory(prev => (prev?.id === row.entityId ? null : prev));
      } else {
        await deleteTask(row.entityId);
        setSelectedTask(prev => (prev?.id === row.entityId ? null : prev));
      }
      toast.success(`${label[0].toUpperCase()}${label.slice(1)} deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Could not delete ${label}`);
    }
  };

  /** Drop a row on another row: file it under that parent. */
  const handleReparentRow = async (row: DashRow, parent: DashRow) => {
    if (row.projectId !== parent.projectId) {
      toast.error('Move it to the same project first');
      return;
    }
    try {
      if (row.type === 'story') {
        // A story nests only under another story. The server refuses a cycle, a
        // cross-project parent, or a chain deeper than it allows.
        if (parent.type !== 'story' || parent.entityId === row.entityId) return;
        const updated = await api.patchUserStory(row.entityId, { parentStoryId: parent.entityId });
        upsertUserStory(updated);
        setSelectedStory(prev => (prev?.id === updated.id ? updated : prev));
      } else if (parent.type === 'story') {
        await updateTask(row.entityId, { userStoryId: parent.entityId, parentTaskId: null });
      } else if (parent.type === 'task') {
        if (parent.entityId === row.entityId) return;
        await updateTask(row.entityId, { parentTaskId: parent.entityId });
      } else {
        return; // a subtask cannot take children
      }
      toast.success(`Moved under "${parent.title}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move that item');
    }
  };

  /** Story ⇄ task. The server carries what both sides hold and re-homes children. */
  const handleConvertRow = async (row: DashRow) => {
    const toStory = row.type !== 'story';
    const ok = await confirmAction({
      title: toStory ? 'Turn this task into a story?' : 'Turn this story into a task?',
      description: toStory
        ? 'Its subtasks become the new story\u2019s tasks. Tracked time cannot come along, so a task with logged time has to keep its time first.'
        : 'Its tasks become subtasks of the new task. Story points and acceptance criteria are not kept.',
      confirmLabel: toStory ? 'Turn into a story' : 'Turn into a task',
    });
    if (!ok) return;
    try {
      if (toStory) {
        const story = await api.convertTaskToStory(row.entityId);
        upsertUserStory(story);
        setSelectedTask(prev => (prev?.id === row.entityId ? null : prev));
      } else {
        await api.convertStoryToTask(row.entityId);
        removeUserStory(row.entityId, row.projectId);
        setSelectedStory(prev => (prev?.id === row.entityId ? null : prev));
      }
      await syncTasks();
      toast.success(toStory ? 'Now a story' : 'Now a task');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not convert that item');
    }
  };

  const handleDeleteRows = async (rows: DashRow[]) => {
    if (rows.length === 0) return;
    const ok = await confirmAction({
      title: `Delete ${rows.length} ${rows.length === 1 ? 'item' : 'items'}?`,
      description: 'This cannot be undone. Tasks under a deleted story stay in the project.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    let failed = 0;
    for (const row of rows) {
      try {
        if (row.type === 'story') {
          await api.deleteUserStory(row.entityId);
          removeUserStory(row.entityId, row.projectId);
        } else {
          await deleteTask(row.entityId);
        }
      } catch {
        failed += 1;
      }
    }
    const deleted = rows.length - failed;
    if (deleted) toast.success(`Deleted ${deleted} ${deleted === 1 ? 'item' : 'items'}`);
    if (failed) toast.error(`Could not delete ${failed} of them`);
  };

  /** Board cards edit through the same path the list rows do. */
  const editTaskCell = (task: Task, patch: DashRowPatch) => {
    void handleEditRow(
      { entityId: task.id, type: 'task', projectId: task.projectId, task } as DashRow,
      patch,
    );
  };
  const editStoryCell = (story: UserStory, patch: DashRowPatch) => {
    void handleEditRow(
      { entityId: story.id, type: 'story', projectId: story.projectId, story } as DashRow,
      patch,
    );
  };

  const handleEditRow = async (row: DashRow, patch: DashRowPatch) => {
    await withBusy(row.entityId, async () => {
    try {
      if (row.story) {
        // A story only ever belongs to another story, so detaching means going
        // back to the top level.
        const leavingParent = patch.detach && !!row.story.parentStoryId;
        const updated = await api.patchUserStory(row.entityId, {
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.assigneeIds !== undefined ? { assigneeIds: patch.assigneeIds } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate || null } : {}),
          ...(leavingParent ? { parentStoryId: '' } : {}),
        });
        if (leavingParent) toast.success('Moved out on its own');
        upsertUserStory(updated);
        setSelectedStory(prev => (prev?.id === updated.id ? updated : prev));
        if (patch.status !== undefined && isDoneBoardStatus(updated.status, doneColumnId)) {
          await syncTasks();
        }
        return;
      }
      if (!row.task) return;
      // A task belongs to a story, or sits under another task, only because
      // someone put it there. Dropped outside, it keeps neither.
      const leftParent = !!patch.detach && !!(row.task.userStoryId || row.task.parentTaskId);
      if (leftParent) {
        await updateTask(row.entityId, { userStoryId: null, parentTaskId: null });
      }
      if (patch.status !== undefined) {
        const next = patch.status;
        if (isDoneBoardStatus(next, doneColumnId) && !isDoneBoardStatus(row.task.status, doneColumnId)) {
          const hours = await promptActualHours(row.task, 'done');
          if (hours === null) return;
          if (activeTimers[row.entityId]) await stopTimer(row.entityId);
          await moveTask(row.entityId, next, hours);
          if (leftParent) toast.success('Moved out on its own');
          return;
        }
        await moveTask(row.entityId, next);
        if (leftParent) toast.success('Moved out on its own');
        return;
      }
      const rest = {
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.assigneeIds !== undefined ? { assigneeIds: patch.assigneeIds } : {}),
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.dueDate !== undefined ? { dueDate: patch.dueDate } : {}),
      };
      if (Object.keys(rest).length > 0) await updateTask(row.entityId, rest);
      if (leftParent) toast.success('Moved out on its own');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save that change');
    }
    });
  };
  /**
   * Inline create from the list: title plus whatever the group implies, and
   * sensible defaults for the rest. Anything more goes through the full form.
   */
  /**
   * Inline create from the list.
   *
   * A group's own "+" makes a story — stories are the top level of a group — and
   * a story's "+" makes a task inside it. The group's value always wins over the
   * composer's default for whichever field the grouping represents: adding into
   * a High group and then saving "Medium" would be a lie.
   */
  const handleCreateItem = async (
    groupKey: string,
    draft: DashDraft,
    opts: { kind: 'story' | 'task'; storyId?: string },
  ) => {
    const projectId = scopedProjectId ?? userProjects[0]?.id;
    const project = userProjects.find(p => p.id === projectId);
    if (!project || !currentUser) {
      toast.error('Pick a project first');
      return;
    }
    const status = dashGroupBy === 'status' && groupKey ? groupKey : 'backlog';
    const priority =
      dashGroupBy === 'priority' && groupKey ? (groupKey as Priority) : draft.priority;
    const assigneeIds =
      dashGroupBy === 'assignee' && groupKey && groupKey !== UNASSIGNED_FILTER_ID
        ? [groupKey]
        : draft.assigneeIds;

    try {
      if (opts.kind === 'story') {
        const created = await api.createUserStory({
          projectId: project.id,
          sectionId: draft.sectionId || project.sections[0]?.id || null,
          title: draft.title,
          status,
          priority,
          assigneeIds,
          dueDate: draft.dueDate || null,
        });
        upsertUserStory(created);
        return;
      }
      await createTask({
        title: draft.title,
        description: '',
        projectId: project.id,
        sectionId: draft.sectionId || project.sections[0]?.id || '',
        assigneeIds,
        assignedBy: currentUser.id,
        createdBy: currentUser.id,
        dueDate: draft.dueDate,
        priority,
        status,
        tags: [],
        userStoryId: opts.storyId ?? null,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create that');
    }
  };

  /**
   * Dropping a row on a group applies whatever that grouping represents, so the
   * gesture means the same thing in every grouping instead of only in Status.
   */
  /**
   * Dropping on a group is dropping outside every parent, so it also breaks the
   * item free: a task that leaves its story is an independent task, and a
   * sub-story dropped on a group goes back to the top level. Membership is only
   * ever what someone put there on purpose.
   */
  const handleDropRow = (row: DashRow, groupKey: string) => {
    const detach = true;
    if (dashGroupBy === 'status') {
      void handleEditRow(row, { status: groupKey, detach });
      return;
    }
    if (dashGroupBy === 'priority') {
      void handleEditRow(row, { priority: groupKey as Priority, detach });
      return;
    }
    if (dashGroupBy === 'assignee') {
      const ids = groupKey === UNASSIGNED_FILTER_ID ? [] : [groupKey];
      void handleEditRow(row, { assigneeIds: ids, detach });
      return;
    }
    void handleEditRow(row, { detach });
  };

  const clearDashFilters = () => {
    setDashPriorityFilter(new Set());
    setDashAssigneeFilter(new Set());
    setDashSprintFilter(new Set());
    setDashDateFrom('');
    setDashDateTo('');
    setDashSearch('');
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="relative p-3 sm:p-4 h-full flex flex-col overflow-hidden">
      {/* One line across the top while anything is saving. A move on a slow
          connection is otherwise indistinguishable from a click that missed. */}
      {busy && (
        <span className="pointer-events-none absolute inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-primary/20">
          <span className="block h-full w-1/3 animate-dash-progress bg-primary" />
        </span>
      )}
      <div className="mb-3 shrink-0 flex flex-col gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">{selectedProjectName}</h1>
          <div className="inline-flex h-8 shrink-0 rounded-lg border border-border/70 bg-card/70 p-0.5">
            <button
              type="button"
              onClick={() => setView('list')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${dashView === 'list' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="h-3.5 w-3.5" /> List
            </button>
            <button
              type="button"
              onClick={() => setView('board')}
              className={`inline-flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium ${dashView === 'board' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <Columns className="h-3.5 w-3.5" /> Board
            </button>
          </div>
        </div>
        <DashToolbar
          groupBy={dashGroupBy}
          onGroupBy={setGroupBy}
          sortBy={dashSortBy}
          onSortBy={setDashSortBy}
          showGrouping={dashView === 'list'}
          search={dashSearch}
          onSearch={setDashSearch}
          sprintOptions={dashSprintOptions}
          sprintFilter={dashSprintFilter}
          onToggleSprint={toggleDashSprint}
          onClearSprints={() => setDashSprintFilter(new Set())}
          members={dashFilterableMembers}
          assigneeFilter={dashAssigneeFilter}
          onToggleAssignee={toggleDashAssignee}
          onClearAssignees={() => setDashAssigneeFilter(new Set())}
          priorityFilter={dashPriorityFilter}
          onTogglePriority={toggleDashPriority}
          onClearPriorities={() => setDashPriorityFilter(new Set())}
          dateFrom={dashDateFrom}
          dateTo={dashDateTo}
          onDateRange={(f, t) => { setDashDateFrom(f); setDashDateTo(t); }}
          openFilter={openFilter}
          onOpenFilter={setOpenFilter}
          onClearAll={clearDashFilters}
          trailing={
            dashView === 'list' ? (
              <AddWorkMenu
                onTask={() => openCreateForStory(null)}
                onStory={() => openCreateStory()}
                trigger={
                  <Button type="button" size="sm" className="h-8 gap-1 text-xs">
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                }
              />
            ) : null
          }
        />
      </div>

      {dashView === 'list' ? (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="min-w-[46rem]">
            <DashTable
              groups={dashGroups}
              columns={boardColumns}
              doneColumnId={doneColumnId}
              membersForProject={membersForProject}
              projectNames={projectNames}
              showProjectNames={isAllProjects}
              expandedRowIds={expandedRowIds}
              onToggleRow={toggleRowExpanded}
              collapsedKeys={collapsedKeys}
              onToggleGroup={toggleGroupCollapsed}
              onRowClick={handleRowClick}
              onAddChild={handleAddChild}
              onDeleteRow={row => { void handleDeleteRow(row); }}
              onEditRow={(row, patch) => { void handleEditRow(row, patch); }}
              onAddTask={groupKey => openCreateForStory(null, groupKey || undefined)}
              onCreateItem={handleCreateItem}
              composerProjectId={composerProject?.id ?? ''}
              composerSections={composerProject?.sections ?? []}
              onDropRow={handleDropRow}
              onReparentRow={(row, parent) => { void handleReparentRow(row, parent); }}
              onDeleteRows={rows => { void handleDeleteRows(rows); }}
              onConvertRow={row => { void handleConvertRow(row); }}
              busyIds={busyIds}
              onAddStory={groupKey => openCreateStory(groupKey || undefined)}
              groupKeyIsStatus={dashGroupBy === 'status'}
            />
          </div>
        </div>
      ) : (
      <DndContext sensors={sensors} collisionDetection={collisionDetection}
        onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}>
        <SortableContext items={boardColumns.map(c => c.id)} strategy={horizontalListSortingStrategy}>
          <KanbanBoardPan className="flex gap-4 lg:gap-3 flex-1 min-h-0 pb-4">
            {boardColumns.map(col => (
              <KanbanColumnPanel
                key={col.id} column={col}
                taskCards={taskCardsForColumn(col.id)}
                stories={storiesForColumn(col.id)}
                storyTasksById={nestedStoryTasks}
                storyTaskTotals={storyTaskTotals}
                childStoriesById={childStoriesById}
                subtasksByTask={subtasksByTask}
                busyIds={busyIds}
                expandedTaskIds={expandedTaskIds}
                onToggleTaskExpand={toggleTaskExpanded}
                onEditStory={editStoryCell}
                onEditTask={editTaskCell}
                membersForProject={membersForProject}
                onTaskClick={setSelectedTask}
                onStoryClick={setSelectedStory}
                onStoryTaskClick={setSelectedTask}
                expandedStoryIds={expandedStoryIds}
                onToggleStoryExpand={toggleStoryExpanded}
                onNewTask={() => openCreateForStory(null, col.id)}
                onNewStory={() => openCreateStory(col.id)}
                onAddStoryTask={s => openCreateForStory(s, col.id)}
                isDropTarget={overColumnId === col.id}
                isManager={!!isManager}
                isDoneColumn={col.id === doneColumnId}
                onSetDoneColumn={() => handleSetDoneColumn(col.id)}
                onRenameColumn={() => openRename(col)}
                onDeleteColumn={() => { void handleDeleteColumn(col.id); }}
                onSetColor={color => { void handleSetColumnColor(col.id, color); }}
                showProjectPill={isAllProjects}
                users={users}
                columns={boardColumns}
                doneColumnId={doneColumnId}
              />
            ))}
          </KanbanBoardPan>
        </SortableContext>

        <DragOverlay dropAnimation={null}>
          {activeTask && (
            <div className="w-[280px] sm:w-[320px] cursor-grabbing rotate-1 scale-[1.02] pointer-events-none">
              <TaskCard task={activeTask} onClick={() => {}} showProjectPill={isAllProjects} />
            </div>
          )}
          {activeStory && (
            <div className="w-[280px] sm:w-[320px] cursor-grabbing rotate-1 scale-[1.02] pointer-events-none">
              <StoryBoardCard
                story={activeStory}
                tasks={nestedStoryTasks[activeStory.id] ?? []}
                totalTasks={storyTaskTotals[activeStory.id] ?? 0}
                expanded={false}
                onToggleExpand={() => {}}
                onClick={() => {}}
                onTaskClick={() => {}}
                users={users}
              />
            </div>
          )}
          {activeColumn && (
            <div className="rounded-2xl border-2 border-primary/30 bg-card/95 backdrop-blur-sm p-4 shadow-2xl w-[280px] sm:w-[320px] cursor-grabbing rotate-1 opacity-90">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{activeColumn.label}</span>
              </div>
            </div>
          )}
        </DragOverlay>

        {mascotsEnabled && <MascotDropZone />}
      </DndContext>
      )}

      {/* Add Column Modal */}
      <Dialog open={addColOpen} onOpenChange={setAddColOpen}>
        <DialogContent className="sm:w-[75vw]" onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => addColInputRef.current?.focus(), 50); }}>
          <DialogHeader><DialogTitle>Add Column</DialogTitle></DialogHeader>
          <form onSubmit={e => { void handleAddColumn(e); }} className="space-y-4 pt-1">
            <input
              ref={addColInputRef}
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              placeholder="Column name…"
              className="w-full rounded-xl border bg-muted/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setAddColOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!newColName.trim()}>Add Column</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Rename Column Modal */}
      <Dialog open={renameColOpen} onOpenChange={setRenameColOpen}>
        <DialogContent className="sm:w-[75vw]" onOpenAutoFocus={e => { e.preventDefault(); setTimeout(() => renameColInputRef.current?.focus(), 50); }}>
          <DialogHeader><DialogTitle>Rename Column</DialogTitle></DialogHeader>
          <form onSubmit={e => { void handleRenameColumn(e); }} className="space-y-4 pt-1">
            <input
              ref={renameColInputRef}
              value={renameColName}
              onChange={e => setRenameColName(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setRenameColOpen(false)}>Cancel</Button>
              <Button type="submit" size="sm" disabled={!renameColName.trim()}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <TaskDetailModal
        task={selectedTask}
        open={!!selectedTask}
        onOpenChange={o => !o && setSelectedTask(null)}
        onConvert={id => {
          const row = { entityId: id, type: 'task', projectId: selectedTask?.projectId ?? '' } as DashRow;
          void handleConvertRow(row);
        }}
      />
      <StoryDetailModal
        story={selectedStory ? (dashStories.find(s => s.id === selectedStory.id) ?? selectedStory) : null}
        open={!!selectedStory}
        onOpenChange={o => { if (!o) setSelectedStory(null); }}
        tasks={selectedStory ? tasks.filter(t => t.userStoryId === selectedStory.id && isTopLevelTask(t)) : []}
        columns={boardColumns}
        doneColumnId={doneColumnId}
        isManager={!!isManager}
        onUpdated={s => setSelectedStory(s)}
        onConvert={id => {
          const row = { entityId: id, type: 'story', projectId: selectedStory?.projectId ?? '' } as DashRow;
          void handleConvertRow(row);
        }}
        onTaskClick={t => { setSelectedStory(null); setSelectedTask(t); }}
        onAddTask={() => {
          if (!selectedStory) return;
          const s = selectedStory;
          setSelectedStory(null);
          openCreateForStory(s, 'backlog');
        }}
      />
      <CreateTaskModal
        open={createOpen}
        initialStatus={createStatus}
        lockStory={lockCreateStory}
        lockProjectId={lockCreateProjectId}
        onOpenChange={o => {
          setCreateOpen(o);
          if (!o) {
            setLockCreateStory(null);
            setLockCreateProjectId(null);
          }
        }}
      />
      <CreateUserStoryDialog
        open={createStoryOpen}
        projectId={createStoryProjectId}
        initialStatus={createStoryStatus}
        onOpenChange={setCreateStoryOpen}
        onCreated={story => {
          upsertUserStory(story);
          setCreateStoryOpen(false);
        }}
      />
    </motion.div>
  );
};

export default DashboardPage;
