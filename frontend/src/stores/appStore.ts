import { create } from 'zustand';
import { User, Project, Task, TaskStatus, KanbanColumn, Role } from '@/types';
import { api, TOKEN_KEY } from '@/lib/api';
import { defaultSelectedProjectIdForUser } from '@/lib/project-utils';

const ACTIVE_TIMERS_KEY = 'tm_active_timers';
function loadTimers(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(ACTIVE_TIMERS_KEY) || '{}'); } catch { return {}; }
}
function saveTimers(t: Record<string, number>) { localStorage.setItem(ACTIVE_TIMERS_KEY, JSON.stringify(t)); }

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
  removeSection: (projectId: string, sectionId: string) => Promise<void>;
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
      const [users, projects, tasks, kanbanColumns] = await Promise.all([
        api.getUsers(),
        api.getProjects(),
        api.getTasks(),
        api.getKanbanColumns(),
      ]);
      set({
        hydrated: true,
        currentUser: me,
        users,
        projects,
        tasks,
        kanbanColumns,
        selectedProjectId: defaultSelectedProjectIdForUser(projects, me.projectIds),
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
    } catch {
      return null;
    }
  },

  register: async (name, email, password, role = 'employee') => {
    // Let registration errors (e.g. duplicate email) propagate to the caller
    const { access_token, user } = await api.register(name, email, password, role);
    localStorage.setItem(TOKEN_KEY, access_token);
    try {
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

  removeSection: async (projectId, sectionId) => {
    const updated = await api.deleteProjectSection(projectId, sectionId);
    set({
      projects: get().projects.map(pr => (pr.id === projectId ? updated : pr)),
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

  activeTimers: loadTimers(),

  startTimer: async taskId => {
    const task = get().tasks.find(t => t.id === taskId);
    if (!task) return;
    const timers = { ...get().activeTimers, [taskId]: Date.now() };
    saveTimers(timers);
    set({ activeTimers: timers });
    // Mark task as started on the backend (only if not already started)
    if (!task.isStarted) {
      try {
        const updated = await api.startTask(taskId);
        set({ tasks: get().tasks.map(x => (x.id === taskId ? updated : x)) });
      } catch {
        // non-critical — timer still runs
      }
    }
  },

  stopTimer: async taskId => {
    const timers = get().activeTimers;
    const startMs = timers[taskId];
    if (!startMs) return;

    const endMs = Date.now();
    const elapsedSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));

    const startDate = new Date(startMs);
    const endDate = new Date(endMs);
    const workDate = startDate.toISOString().split('T')[0];
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeFrom = `${pad(startDate.getHours())}:${pad(startDate.getMinutes())}`;
    let timeTo = `${pad(endDate.getHours())}:${pad(endDate.getMinutes())}`;
    // Timesheet requires timeTo > timeFrom; add 1 min if same
    if (timeTo === timeFrom) {
      const adjusted = new Date(endMs + 60_000);
      timeTo = `${pad(adjusted.getHours())}:${pad(adjusted.getMinutes())}`;
    }

    const task = get().tasks.find(t => t.id === taskId);

    // Remove timer immediately (optimistic)
    const newTimers = { ...timers };
    delete newTimers[taskId];
    saveTimers(newTimers);
    set({ activeTimers: newTimers });

    if (!task) return;

    // Only persist when the session ran longer than 1 minute (no task log or timesheet row otherwise)
    if (elapsedSeconds <= 60) return;

    const updatedTask = await api.logTime(taskId, workDate, elapsedSeconds);
    set({ tasks: get().tasks.map(x => (x.id === taskId ? updatedTask : x)) });

    try {
      await api.createTimesheetWorkEntry({
        workDate,
        projectId: task.projectId,
        sectionId: task.sectionId,
        description: task.title,
        timeFrom,
        timeTo,
      });
    } catch {
      /* best-effort */
    }
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
