import { create } from 'zustand';
import { User, Project, Task, TaskStatus, Priority, KanbanColumn } from '@/types';
import { mockUsers, mockProjects, mockTasks } from '@/data/mockData';

const DEFAULT_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', label: 'Backlog' },
  { id: 'in_progress', label: 'In Progress' },
  { id: 'in_review', label: 'In Review' },
  { id: 'done', label: 'Done' },
];

interface AppState {
  // Auth
  currentUser: User | null;
  login: (email: string, password: string) => User | null;
  logout: () => void;
  updateProfile: (name: string, avatar: string) => void;

  // Theme
  theme: 'dark' | 'light';
  toggleTheme: () => void;

  // Projects
  projects: Project[];
  selectedProjectId: string | null;
  selectProject: (id: string) => void;
  createProject: (name: string, description: string) => void;
  addSection: (projectId: string, name: string) => void;
  addMemberToProject: (projectId: string, userId: string) => void;
  removeMemberFromProject: (projectId: string, userId: string) => void;

  // Users
  users: User[];

  // Tasks
  tasks: Task[];
  createTask: (task: Omit<Task, 'id' | 'createdAt' | 'timeLog' | 'approvedByManager' | 'timeTracked' | 'isStarted' | 'status'>) => void;
  updateTask: (id: string, updates: Partial<Task>) => void;
  startTask: (id: string) => void;
  moveTask: (id: string, status: TaskStatus) => void;
  approveTask: (id: string) => void;
  logTime: (id: string, date: string, seconds: number) => void;

  // Columns
  kanbanColumns: KanbanColumn[];
  addColumn: (label: string) => void;
  removeColumn: (id: string) => boolean;
  renameColumn: (id: string, label: string) => void;
  reorderColumns: (columns: KanbanColumn[]) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  currentUser: null,
  theme: (typeof window !== 'undefined' && localStorage.getItem('theme') as 'dark' | 'light') || 'dark',

  login: (email, password) => {
    const user = get().users.find(u => u.email === email && u.password === password);
    if (user) {
      set({ currentUser: user, selectedProjectId: user.projectIds[0] || null });
      return user;
    }
    return null;
  },
  logout: () => set({ currentUser: null }),
  updateProfile: (name, avatar) => {
    const user = get().currentUser;
    if (!user) return;
    const updated = { ...user, name, avatar };
    set({
      currentUser: updated,
      users: get().users.map(u => u.id === user.id ? updated : u),
    });
  },

  toggleTheme: () => {
    const next = get().theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', next);
    set({ theme: next });
  },

  projects: mockProjects,
  selectedProjectId: null,
  selectProject: (id) => set({ selectedProjectId: id }),

  createProject: (name, description) => {
    const user = get().currentUser;
    if (!user) return;
    const id = 'p' + Date.now();
    const project: Project = {
      id, name, description, createdBy: user.id,
      members: [user.id], sections: [], createdAt: new Date().toISOString().split('T')[0],
    };
    set({
      projects: [...get().projects, project],
      users: get().users.map(u => u.id === user.id ? { ...u, projectIds: [...u.projectIds, id] } : u),
      currentUser: { ...user, projectIds: [...user.projectIds, id] },
    });
  },

  addSection: (projectId, name) => {
    const sectionId = 's' + Date.now();
    set({
      projects: get().projects.map(p =>
        p.id === projectId
          ? { ...p, sections: [...p.sections, { id: sectionId, name, projectId }] }
          : p
      ),
    });
  },

  addMemberToProject: (projectId, userId) => {
    set({
      projects: get().projects.map(p =>
        p.id === projectId && !p.members.includes(userId)
          ? { ...p, members: [...p.members, userId] }
          : p
      ),
      users: get().users.map(u =>
        u.id === userId && !u.projectIds.includes(projectId)
          ? { ...u, projectIds: [...u.projectIds, projectId] }
          : u
      ),
    });
  },

  removeMemberFromProject: (projectId, userId) => {
    set({
      projects: get().projects.map(p =>
        p.id === projectId
          ? { ...p, members: p.members.filter(m => m !== userId) }
          : p
      ),
      users: get().users.map(u =>
        u.id === userId
          ? { ...u, projectIds: u.projectIds.filter(pid => pid !== projectId) }
          : u
      ),
    });
  },

  users: mockUsers,
  tasks: mockTasks,

  createTask: (taskData) => {
    const id = 't' + Date.now();
    const task: Task = {
      ...taskData,
      id,
      status: 'backlog',
      isStarted: false,
      approvedByManager: false,
      timeTracked: 0,
      createdAt: new Date().toISOString().split('T')[0],
      timeLog: {},
    };
    set({ tasks: [...get().tasks, task] });
  },

  updateTask: (id, updates) => {
    set({ tasks: get().tasks.map(t => t.id === id ? { ...t, ...updates } : t) });
  },

  startTask: (id) => {
    set({
      tasks: get().tasks.map(t =>
        t.id === id ? { ...t, isStarted: true, startedAt: new Date().toISOString().split('T')[0], status: 'backlog' as TaskStatus } : t
      ),
    });
  },

  moveTask: (id, status) => {
    set({ tasks: get().tasks.map(t => t.id === id ? { ...t, status } : t) });
  },

  approveTask: (id) => {
    set({
      tasks: get().tasks.map(t =>
        t.id === id ? { ...t, status: 'completed' as TaskStatus, approvedByManager: true, completedAt: new Date().toISOString().split('T')[0] } : t
      ),
    });
  },

  logTime: (id, date, seconds) => {
    set({
      tasks: get().tasks.map(t => {
        if (t.id !== id) return t;
        const newLog = { ...t.timeLog, [date]: (t.timeLog[date] || 0) + seconds };
        const totalTracked = Object.values(newLog).reduce((a, b) => a + b, 0);
        return { ...t, timeLog: newLog, timeTracked: totalTracked };
      }),
    });
  },

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
}));
