import { create } from 'zustand';
import { User, Project, Task, TaskStatus, KanbanColumn, Role, Client, Skill } from '@/types';
import { api, isAuthError, isPendingApproval, TOKEN_KEY } from '@/lib/api';
import { defaultSelectedProjectIdForUser } from '@/lib/project-utils';

/** Map server timer rows → { taskId: epochMs } for the running-timer UI. */
function timersToMap(rows: { taskId: string; startedAt: string }[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const r of rows) {
    const ms = Date.parse(r.startedAt);
    if (!Number.isNaN(ms)) m[r.taskId] = ms;
  }
  return m;
}

// Transient mascot-animation event kinds.
export type AgentEventKind =
  | 'task_created' | 'task_assigned' | 'task_approved' | 'task_moved'
  | 'timer_started' | 'timer_stopped';

// Monotonic counter so repeated agent events always change identity (re-trigger animation).
let agentEventSeq = 0;

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'testing', label: 'Testing' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

interface AppState {
  hydrated: boolean;
  /** Set when startup failed for a NON-auth reason; the session is still valid. */
  bootstrapError: string | null;
  bootstrap: () => Promise<void>;

  currentUser: User | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User | null>;
  /** Resolves with the pending-approval message; no session is created. */
  register: (name: string, email: string, password: string) => Promise<string>;
  /** Returns the signed-in user, or a pending-approval message for a new account. */
  loginWithMicrosoft: (idToken: string, rememberMe?: boolean, jobTitle?: string, experienceMonths?: number) => Promise<User | { pending: string }>;
  logout: () => void;
  updateProfile: (name: string, avatar: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;

  theme: 'dark' | 'light';
  toggleTheme: () => void;

  mascotsEnabled: boolean;
  toggleMascots: () => void;

  // Transient agent-animation trigger (consumed by the mascot overlay).
  agentEvent: { kind: AgentEventKind; seq: number } | null;
  emitAgentEvent: (kind: AgentEventKind) => void;

  // Drag-onto-mascot bus: the kanban board (DashboardPage) owns the DndContext,
  // the mascot (Companion) lives outside it — they coordinate through the store.
  mascotDrag: { active: boolean; over: boolean };
  setMascotDrag: (active: boolean, over: boolean) => void;
  // A task just dropped on the mascot → Companion opens its quick-action menu.
  mascotDropTaskId: string | null;
  setMascotDropTask: (taskId: string | null) => void;

  projects: Project[];
  selectedProjectId: string | null;
  selectProject: (id: string | null) => void;
  clients: Client[];
  loadClients: () => Promise<void>;
  createClient: (name: string) => Promise<Client>;
  skills: Skill[];
  loadSkills: () => Promise<void>;
  createSkill: (name: string) => Promise<Skill>;
  updateUserSkills: (userId: string, skillIds: string[]) => Promise<void>;
  createProject: (name: string, description: string, clientId: string) => Promise<void>;
  addSection: (projectId: string, name: string) => Promise<void>;
  setProjectAppearance: (projectId: string, body: { backgroundImage?: string; accentColor?: string; projectImage?: string }) => Promise<void>;
  updateProjectClient: (projectId: string, clientId: string | null) => Promise<void>;
  uploadProjectMedia: (projectId: string, kind: 'background' | 'project', file: Blob, accentColor?: string) => Promise<void>;
  removeSection: (projectId: string, sectionId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  addMemberToProject: (projectId: string, userId: string) => Promise<void>;
  removeMemberFromProject: (projectId: string, userId: string) => Promise<void>;

  users: User[];

  tasks: Task[];
  syncTasks: () => Promise<void>;
  syncProjectsAndUsers: () => Promise<void>;
  createTask: (
    task: Pick<Task, 'title' | 'description' | 'projectId' | 'sectionId' | 'dueDate' | 'priority' | 'tags'> & {
      sprint?: string;
      status?: string;
      assigneeIds: string[];
      assignedBy: string;
      createdBy: string;
      userStoryId: string;
    },
  ) => Promise<Task>;
  updateTask: (id: string, updates: Partial<Task>) => Promise<void>;
  startTask: (id: string) => Promise<void>;
  moveTask: (id: string, status: TaskStatus) => Promise<void>;
  approveTask: (id: string) => Promise<void>;
  reopenTaskToBacklog: (id: string) => Promise<void>;
  logTime: (id: string, date: string, seconds: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;

  kanbanColumns: KanbanColumn[];
  addColumn: (label: string) => Promise<void>;
  removeColumn: (id: string) => Promise<boolean>;
  renameColumn: (id: string, label: string) => Promise<void>;
  reorderColumns: (columns: KanbanColumn[]) => Promise<void>;

  activeTimers: Record<string, number>; // taskId -> epoch ms when timer started
  startTimer: (taskId: string) => Promise<void>;
  stopTimer: (taskId: string) => Promise<void>;

  searchQuery: string;
  setSearchQuery: (q: string) => void;

  /** Bumped when server-side timesheet rows change outside this page (e.g. meeting notes). */
  timesheetEpoch: number;
  invalidateTimesheets: () => void;
}

async function refetchUsersProjects(get: () => AppState, set: (p: Partial<AppState>) => void) {
  const cu = get().currentUser;
  const isManager = cu?.role === 'manager' || cu?.role === 'superadmin';
  const [users, projects, clients] = await Promise.all([
    api.getUsers(),
    api.getProjects(),
    isManager ? api.getClients().catch(() => [] as Client[]) : Promise.resolve([] as Client[]),
  ]);
  set({
    users,
    projects,
    clients,
    currentUser: cu ? users.find(u => u.id === cu.id) ?? cu : null,
  });
}

export const useAppStore = create<AppState>((set, get) => ({
  hydrated: false,

  bootstrap: async () => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      set({
        hydrated: true,
        currentUser: null,
        users: [],
        projects: [],
        clients: [],
        skills: [],
        tasks: [],
        kanbanColumns: DEFAULT_COLUMNS,
        selectedProjectId: null,
      });
      return;
    }
    try {
      const me = await api.getMe();
      const isManager = me.role === 'manager' || me.role === 'superadmin';
      const [users, projects, tasks, kanbanColumns, activeTimerRows, clients] = await Promise.all([
        api.getUsers(),
        api.getProjects(),
        api.getTasks(),
        api.getKanbanColumns(),
        api.getActiveTimers().catch(() => []),
        isManager ? api.getClients().catch(() => [] as Client[]) : Promise.resolve([] as Client[]),
      ]);
      set({
        hydrated: true,
        bootstrapError: null,
        currentUser: me,
        users,
        projects,
        clients,
        tasks,
        kanbanColumns,
        selectedProjectId: defaultSelectedProjectIdForUser(projects, me.projectIds),
        activeTimers: timersToMap(activeTimerRows),
      });
    } catch (e) {
      // Only an actual 401/403 means the session is over. Anything else — server
      // down, 500, DNS, CORS, a dropped request on a hard refresh — must KEEP the
      // token, or a momentary blip silently logs the user out.
      if (isAuthError(e)) {
        localStorage.removeItem(TOKEN_KEY);
        set({
          hydrated: true,
          bootstrapError: null,
          currentUser: null,
          users: [],
          projects: [],
          clients: [],
          skills: [],
          tasks: [],
          kanbanColumns: DEFAULT_COLUMNS,
          selectedProjectId: null,
        });
        return;
      }
      set({
        hydrated: true,
        bootstrapError: e instanceof Error ? e.message : 'Could not reach the server',
      });
    }
  },

  bootstrapError: null,
  currentUser: null,
  theme: (typeof window !== 'undefined' && localStorage.getItem('theme') as 'dark' | 'light') || 'dark',

  login: async (email, password, rememberMe = false) => {
    try {
      const { access_token, user } = await api.login(email, password, rememberMe);
      localStorage.setItem(TOKEN_KEY, access_token);
      const [users, projects, tasks, kanbanColumns, activeTimerRows] = await Promise.all([
        api.getUsers(),
        api.getProjects(),
        api.getTasks(),
        api.getKanbanColumns(),
        api.getActiveTimers().catch(() => []),
      ]);
      set({
        currentUser: user,
        users,
        projects,
        tasks,
        kanbanColumns,
        selectedProjectId: defaultSelectedProjectIdForUser(projects, user.projectIds),
        activeTimers: timersToMap(activeTimerRows),
        hydrated: true,
      });
      return user;
    } catch {
      return null;
    }
  },

  register: async (name, email, password) => {
    // Sign-up creates an inactive account and issues no token, so there is
    // nothing to hydrate — the caller just shows the waiting-for-approval screen.
    // Errors (duplicate email, weak password) propagate to the caller.
    const r = await api.register(name, email, password);
    return r.message;
  },

  loginWithMicrosoft: async (idToken, rememberMe = false, jobTitle, experienceMonths) => {
    const res = await api.loginMicrosoft(idToken, rememberMe, jobTitle, experienceMonths);
    if (isPendingApproval(res)) return { pending: res.message };
    const { access_token, user } = res;
    localStorage.setItem(TOKEN_KEY, access_token);
    const [users, projects, tasks, kanbanColumns] = await Promise.all([
      api.getUsers(),
      api.getProjects(),
      api.getTasks(),
      api.getKanbanColumns(),
    ]);
    set({
      currentUser: user,
      users,
      projects,
      tasks,
      kanbanColumns,
      selectedProjectId: defaultSelectedProjectIdForUser(projects, user.projectIds),
      hydrated: true,
    });
    return user;
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({
      currentUser: null,
      users: [],
      projects: [],
      tasks: [],
      kanbanColumns: DEFAULT_COLUMNS,
      selectedProjectId: null,
      activeTimers: {},
    });
  },

  updateProfile: async (name, avatar) => {
    const user = await api.patchProfile(name, avatar);
    set({
      currentUser: user,
      users: get().users.map(u => (u.id === user.id ? user : u)),
    });
  },

  changePassword: async (currentPassword, newPassword) => {
    await api.changePassword(currentPassword, newPassword);
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    set({ theme: next });
  },

  mascotsEnabled: (typeof window !== 'undefined' && localStorage.getItem('mascots')) !== 'off',
  toggleMascots: () => {
    const next = !get().mascotsEnabled;
    localStorage.setItem('mascots', next ? 'on' : 'off');
    set({ mascotsEnabled: next });
  },

  agentEvent: null,
  emitAgentEvent: kind => set({ agentEvent: { kind, seq: ++agentEventSeq } }),

  mascotDrag: { active: false, over: false },
  setMascotDrag: (active, over) => set({ mascotDrag: { active, over } }),
  mascotDropTaskId: null,
  setMascotDropTask: taskId => set({ mascotDropTaskId: taskId }),

  projects: [],
  selectedProjectId: null,
  selectProject: id => set({ selectedProjectId: id && id.length > 0 ? id : null }),

  clients: [],
  loadClients: async () => {
    const cu = get().currentUser;
    if (!cu || (cu.role !== 'manager' && cu.role !== 'superadmin')) {
      set({ clients: [] });
      return;
    }
    try {
      set({ clients: await api.getClients() });
    } catch {
      // keep existing list on transient failure
    }
  },

  createClient: async (name) => {
    const client = await api.createClient(name);
    set({
      clients: [...get().clients.filter(c => c.id !== client.id), client]
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
    return client;
  },

  skills: [],
  loadSkills: async () => {
    const cu = get().currentUser;
    if (!cu || (cu.role !== 'manager' && cu.role !== 'superadmin')) {
      set({ skills: [] });
      return;
    }
    try {
      set({ skills: await api.getSkills() });
    } catch {
      // keep existing list on transient failure
    }
  },

  createSkill: async (name) => {
    const skill = await api.createSkill(name);
    set({
      skills: [...get().skills.filter(s => s.id !== skill.id), skill]
        .sort((a, b) => a.name.localeCompare(b.name)),
    });
    return skill;
  },

  updateUserSkills: async (userId, skillIds) => {
    const updated = await api.updateUserSkills(userId, skillIds);
    set({
      users: get().users.map(u => (u.id === userId ? updated : u)),
    });
  },

  createProject: async (name, description, clientId) => {
    const p = await api.createProject(name, description, clientId);
    await refetchUsersProjects(get, set);
    set({ selectedProjectId: p.id });
  },

  addSection: async (projectId, name) => {
    const updated = await api.addSection(projectId, name);
    set({
      projects: get().projects.map(pr => (pr.id === projectId ? updated : pr)),
    });
  },

  setProjectAppearance: async (projectId, body) => {
    const updated = await api.setProjectAppearance(projectId, body);
    set({
      projects: get().projects.map(pr => (pr.id === projectId ? updated : pr)),
    });
  },

  updateProjectClient: async (projectId, clientId) => {
    const updated = await api.updateProjectClient(projectId, clientId);
    set({
      projects: get().projects.map(pr => (pr.id === projectId ? updated : pr)),
    });
  },

  uploadProjectMedia: async (projectId, kind, file, accentColor) => {
    const updated = await api.uploadProjectMedia(projectId, kind, file, accentColor);
    set({
      projects: get().projects.map(pr => (pr.id === projectId ? updated : pr)),
    });
  },

  removeSection: async (projectId, sectionId) => {
    const updated = await api.deleteProjectSection(projectId, sectionId);
    set({
      projects: get().projects.map(pr => (pr.id === projectId ? updated : pr)),
    });
  },

  deleteProject: async (projectId) => {
    await api.deleteProject(projectId);
    set({
      projects: get().projects.filter(pr => pr.id !== projectId),
      tasks: get().tasks.filter(t => t.projectId !== projectId),
    });
  },

  addMemberToProject: async (projectId, userId) => {
    await api.addProjectMember(projectId, userId);
    await refetchUsersProjects(get, set);
  },

  removeMemberFromProject: async (projectId, userId) => {
    await api.removeProjectMember(projectId, userId);
    await refetchUsersProjects(get, set);
  },

  users: [],
  tasks: [],

  // Background re-sync of the task list (used by smart polling). Authoritative
  // refetch — replaces local task state with the server's current view.
  syncTasks: async () => {
    if (!get().currentUser) return;
    try {
      const tasks = await api.getTasks();
      set({ tasks });
    } catch {
      // transient network error — next poll will retry
    }
  },

  // Background re-sync of users + projects (used by smart polling) — picks up
  // new members, projects, sections, role changes, etc. from other clients.
  syncProjectsAndUsers: async () => {
    if (!get().currentUser) return;
    try {
      await refetchUsersProjects(get, set);
    } catch {
      // transient network error — next poll will retry
    }
  },

  createTask: async taskData => {
    const t = await api.createTask({
      title: taskData.title,
      description: taskData.description,
      projectId: taskData.projectId,
      sectionId: taskData.sectionId,
      assigneeIds: taskData.assigneeIds,
      assignedBy: taskData.assignedBy,
      createdBy: taskData.createdBy,
      dueDate: taskData.dueDate,
      sprint: taskData.sprint ?? '',
      priority: taskData.priority,
      status: taskData.status,
      tags: taskData.tags,
      userStoryId: taskData.userStoryId,
    });
    set({ tasks: [...get().tasks, t] });
    get().emitAgentEvent('task_created');
    return t;
  },

  updateTask: async (id, updates) => {
    const prevTask = get().tasks.find(x => x.id === id);
    const prevAssignees = prevTask?.assigneeIds ?? [];
    const patch: Parameters<typeof api.patchTask>[1] = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.projectId !== undefined) patch.projectId = updates.projectId;
    if (updates.sectionId !== undefined) patch.sectionId = updates.sectionId;
    if (updates.assigneeIds !== undefined) patch.assigneeIds = updates.assigneeIds;
    if (updates.customFields !== undefined) patch.customFields = updates.customFields;
    if (updates.dueDate !== undefined) patch.dueDate = updates.dueDate;
    if (updates.sprint !== undefined) patch.sprint = updates.sprint;
    if (updates.tags !== undefined) patch.tags = updates.tags;
    if (updates.startedAt !== undefined) patch.startedAt = updates.startedAt ?? null;
    if (updates.completedAt !== undefined) patch.completedAt = updates.completedAt ?? null;
    if (updates.minLogMinutes !== undefined) patch.minLogMinutes = updates.minLogMinutes;
    if (updates.userStoryId !== undefined) patch.userStoryId = updates.userStoryId;
    const t = await api.patchTask(id, patch);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
    // Moved to a new section → Tasker "moved" animation.
    if (updates.sectionId !== undefined && prevTask && t.sectionId !== prevTask.sectionId) {
      get().emitAgentEvent('task_moved');
    } else if (updates.assigneeIds !== undefined && t.assigneeIds.some(a => !prevAssignees.includes(a))) {
      // Newly-added assignee → Tasker "assigned" animation.
      get().emitAgentEvent('task_assigned');
    }
  },

  startTask: async id => {
    const t = await api.startTask(id);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
  },

  moveTask: async (id, status) => {
    const t = await api.moveTask(id, status);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
    get().emitAgentEvent('task_moved');
  },

  approveTask: async id => {
    const t = await api.approveTask(id);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
    get().emitAgentEvent('task_approved');
  },

  reopenTaskToBacklog: async id => {
    const t = await api.reopenTaskToBacklog(id);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
  },

  logTime: async (id, date, seconds) => {
    const t = await api.logTime(id, date, seconds);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
  },

  deleteTask: async id => {
    await api.deleteTask(id);
    set({ tasks: get().tasks.filter(t => t.id !== id) });
  },

  activeTimers: {},

  // Running state lives in the backend DB. We start/stop there and mirror the
  // returned start time locally; elapsed + time logging happen server-side.
  startTimer: async taskId => {
    const run = await api.startTimer(taskId);
    const ms = Date.parse(run.startedAt);
    set({ activeTimers: { ...get().activeTimers, [taskId]: Number.isNaN(ms) ? Date.now() : ms } });
    get().emitAgentEvent('timer_started');
    // The task is now marked started server-side — refresh it so the UI reflects that.
    try {
      const tasks = await api.getTasks();
      set({ tasks });
    } catch { /* non-critical */ }
  },

  stopTimer: async taskId => {
    const timers = get().activeTimers;
    if (!(taskId in timers)) return;
    // Optimistically clear the running indicator.
    const newTimers = { ...timers };
    delete newTimers[taskId];
    set({ activeTimers: newTimers });
    // Server computes elapsed from the stored start time and logs it (+ timesheet row).
    const updatedTask = await api.stopTimer(taskId, new Date().getTimezoneOffset());
    set({ tasks: get().tasks.map(x => (x.id === taskId ? updatedTask : x)) });
    get().emitAgentEvent('timer_stopped');
  },

  kanbanColumns: DEFAULT_COLUMNS,

  addColumn: async label => {
    const cols = await api.addKanbanColumn(label);
    set({ kanbanColumns: cols });
  },

  removeColumn: async id => {
    try {
      const cols = await api.deleteKanbanColumn(id);
      set({ kanbanColumns: cols });
      return true;
    } catch {
      return false;
    }
  },

  renameColumn: async (id, label) => {
    const cols = await api.renameKanbanColumn(id, label);
    set({ kanbanColumns: cols });
  },

  reorderColumns: async columns => {
    const cols = await api.reorderKanbanColumns(columns.map(c => c.id));
    set({ kanbanColumns: cols });
  },

  searchQuery: '',
  setSearchQuery: q => set({ searchQuery: q }),

  timesheetEpoch: 0,
  invalidateTimesheets: () => {
    set(s => ({ timesheetEpoch: s.timesheetEpoch + 1 }));
    void get().syncProjectsAndUsers();
  },
}));
