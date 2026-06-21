import { create } from 'zustand';
import { User, Project, Task, TaskStatus, KanbanColumn, Role } from '@/types';
import { api, TOKEN_KEY } from '@/lib/api';
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

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

interface AppState {
  hydrated: boolean;
  bootstrap: () => Promise<void>;

  currentUser: User | null;
  login: (email: string, password: string, rememberMe?: boolean) => Promise<User | null>;
  register: (name: string, email: string, password: string, role?: Role) => Promise<User | null>;
  loginWithMicrosoft: (idToken: string, rememberMe?: boolean, role?: Role, jobTitle?: string, experienceMonths?: number) => Promise<User | null>;
  logout: () => void;
  updateProfile: (name: string, avatar: string) => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;

  theme: 'dark' | 'light';
  toggleTheme: () => void;

  projects: Project[];
  selectedProjectId: string | null;
  selectProject: (id: string | null) => void;
  createProject: (name: string, description: string) => Promise<void>;
  addSection: (projectId: string, name: string) => Promise<void>;
  setProjectAppearance: (projectId: string, body: { backgroundImage?: string; accentColor?: string; projectImage?: string }) => Promise<void>;
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
      assigneeIds: string[];
      assignedBy: string;
      createdBy: string;
    },
  ) => Promise<void>;
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
}

async function refetchUsersProjects(get: () => AppState, set: (p: Partial<AppState>) => void) {
  const [users, projects] = await Promise.all([api.getUsers(), api.getProjects()]);
  const cu = get().currentUser;
  set({
    users,
    projects,
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
        tasks: [],
        kanbanColumns: DEFAULT_COLUMNS,
        selectedProjectId: null,
      });
      return;
    }
    try {
      const me = await api.getMe();
      const [users, projects, tasks, kanbanColumns, activeTimerRows] = await Promise.all([
        api.getUsers(),
        api.getProjects(),
        api.getTasks(),
        api.getKanbanColumns(),
        api.getActiveTimers().catch(() => []),
      ]);
      set({
        hydrated: true,
        currentUser: me,
        users,
        projects,
        tasks,
        kanbanColumns,
        selectedProjectId: defaultSelectedProjectIdForUser(projects, me.projectIds),
        activeTimers: timersToMap(activeTimerRows),
      });
    } catch {
      localStorage.removeItem(TOKEN_KEY);
      set({
        hydrated: true,
        currentUser: null,
        users: [],
        projects: [],
        tasks: [],
        kanbanColumns: DEFAULT_COLUMNS,
        selectedProjectId: null,
      });
    }
  },

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

  register: async (name, email, password, role = 'employee') => {
    // Let registration errors (e.g. duplicate email) propagate to the caller
    const { access_token, user } = await api.register(name, email, password, role);
    localStorage.setItem(TOKEN_KEY, access_token);
    try {
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
    } catch {
      // Data loading failed but account was created — set minimal state
      set({ currentUser: user, hydrated: true });
    }
    return user;
  },

  loginWithMicrosoft: async (idToken, rememberMe = false, role, jobTitle, experienceMonths) => {
    const { access_token, user } = await api.loginMicrosoft(idToken, rememberMe, role, jobTitle, experienceMonths);
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

  projects: [],
  selectedProjectId: null,
  selectProject: id => set({ selectedProjectId: id && id.length > 0 ? id : null }),

  createProject: async (name, description) => {
    const p = await api.createProject(name, description);
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
      priority: taskData.priority,
      tags: taskData.tags,
    });
    set({ tasks: [...get().tasks, t] });
  },

  updateTask: async (id, updates) => {
    const patch: Parameters<typeof api.patchTask>[1] = {};
    if (updates.title !== undefined) patch.title = updates.title;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.priority !== undefined) patch.priority = updates.priority;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.sectionId !== undefined) patch.sectionId = updates.sectionId;
    if (updates.assigneeIds !== undefined) patch.assigneeIds = updates.assigneeIds;
    if (updates.customFields !== undefined) patch.customFields = updates.customFields;
    if (updates.dueDate !== undefined) patch.dueDate = updates.dueDate;
    const t = await api.patchTask(id, patch);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
  },

  startTask: async id => {
    const t = await api.startTask(id);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
  },

  moveTask: async (id, status) => {
    const t = await api.moveTask(id, status);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
  },

  approveTask: async id => {
    const t = await api.approveTask(id);
    set({ tasks: get().tasks.map(x => (x.id === id ? t : x)) });
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
}));
