import { User, Project, Task } from '@/types';

export const mockUsers: User[] = [
  { id: 'u1', name: 'Alex Morgan', email: 'manager@demo.com', password: 'demo123', role: 'manager', avatar: 'AM', projectIds: ['p1', 'p2'] },
  { id: 'u2', name: 'Jordan Lee', email: 'jordan@demo.com', password: 'demo123', role: 'employee', avatar: 'JL', projectIds: ['p1', 'p2'] },
  { id: 'u3', name: 'Sam Patel', email: 'sam@demo.com', password: 'demo123', role: 'employee', avatar: 'SP', projectIds: ['p1'] },
  { id: 'u4', name: 'Priya Nair', email: 'priya@demo.com', password: 'demo123', role: 'employee', avatar: 'PN', projectIds: ['p1', 'p2'] },
];

export const mockProjects: Project[] = [
  {
    id: 'p1', name: 'AI Platform', description: 'Next-gen AI platform with ML capabilities',
    createdBy: 'u1', members: ['u1', 'u2', 'u3', 'u4'],
    sections: [
      { id: 's1', name: 'Backend', projectId: 'p1' },
      { id: 's2', name: 'ML Models', projectId: 'p1' },
      { id: 's3', name: 'Frontend', projectId: 'p1' },
      { id: 's4', name: 'DevOps', projectId: 'p1' },
    ],
    createdAt: '2024-01-15',
  },
  {
    id: 'p2', name: 'Mobile App', description: 'Cross-platform mobile application',
    createdBy: 'u1', members: ['u1', 'u2', 'u4'],
    sections: [
      { id: 's5', name: 'Design', projectId: 'p2' },
      { id: 's6', name: 'iOS', projectId: 'p2' },
      { id: 's7', name: 'Android', projectId: 'p2' },
      { id: 's8', name: 'QA', projectId: 'p2' },
    ],
    createdAt: '2024-02-01',
  },
];

const today = new Date();
const d = (offset: number) => {
  const date = new Date(today);
  date.setDate(date.getDate() + offset);
  return date.toISOString().split('T')[0];
};

export const mockTasks: Task[] = [
  // AI Platform tasks
  { id: 't1', title: 'Setup RAG Pipeline', description: 'Build a Retrieval-Augmented Generation pipeline from scratch. Load documents, create embeddings, store them in a vector database.', projectId: 'p1', sectionId: 's2', assignedTo: 'u2', assignedBy: 'u1', createdBy: 'u1', dueDate: d(3), priority: 'High', status: 'in_progress', isStarted: true, startedAt: d(-2), approvedByManager: false, timeTracked: 7200, tags: ['LangChain', 'Embeddings', 'Vector DB'], createdAt: d(-5), timeLog: { [d(-2)]: 3600, [d(-1)]: 3600 } },
  { id: 't2', title: 'API Authentication Layer', description: 'Implement JWT-based authentication with refresh tokens for the REST API endpoints.', projectId: 'p1', sectionId: 's1', assignedTo: 'u3', assignedBy: 'u1', createdBy: 'u1', dueDate: d(5), priority: 'Urgent', status: 'in_review', isStarted: true, startedAt: d(-4), approvedByManager: false, timeTracked: 14400, tags: ['JWT', 'Security', 'API'], createdAt: d(-7), timeLog: { [d(-4)]: 5400, [d(-3)]: 5400, [d(-2)]: 3600 } },
  { id: 't3', title: 'Dashboard UI Components', description: 'Create reusable chart components and data visualization widgets for the analytics dashboard.', projectId: 'p1', sectionId: 's3', assignedTo: 'u4', assignedBy: 'u1', createdBy: 'u1', dueDate: d(7), priority: 'Medium', status: 'backlog', isStarted: true, startedAt: d(-1), approvedByManager: false, timeTracked: 1800, tags: ['React', 'Charts', 'UI'], createdAt: d(-3), timeLog: { [d(-1)]: 1800 } },
  { id: 't4', title: 'Model Training Pipeline', description: 'Set up automated model training with hyperparameter tuning and experiment tracking.', projectId: 'p1', sectionId: 's2', assignedTo: 'u2', assignedBy: 'u1', createdBy: 'u1', dueDate: d(10), priority: 'High', status: 'backlog', isStarted: false, approvedByManager: false, timeTracked: 0, tags: ['MLOps', 'Python', 'Training'], createdAt: d(-2), timeLog: {} },
  { id: 't5', title: 'CI/CD Pipeline Setup', description: 'Configure GitHub Actions for automated testing, building, and deployment.', projectId: 'p1', sectionId: 's4', assignedTo: 'u3', assignedBy: 'u1', createdBy: 'u1', dueDate: d(-1), priority: 'Low', status: 'done', isStarted: true, startedAt: d(-6), approvedByManager: false, timeTracked: 10800, tags: ['GitHub Actions', 'Docker', 'CI/CD'], createdAt: d(-8), timeLog: { [d(-6)]: 3600, [d(-5)]: 3600, [d(-4)]: 3600 } },
  { id: 't6', title: 'Data Preprocessing Module', description: 'Build data cleaning, normalization, and feature extraction pipeline for ML models.', projectId: 'p1', sectionId: 's2', assignedTo: 'u4', assignedBy: 'u1', createdBy: 'u1', dueDate: d(14), priority: 'Medium', status: 'backlog', isStarted: false, approvedByManager: false, timeTracked: 0, tags: ['NumPy', 'Pandas', 'ETL'], createdAt: d(-1), timeLog: {} },
  // Mobile App tasks
  { id: 't7', title: 'Onboarding Flow Design', description: 'Design the complete onboarding experience with illustrations and micro-animations.', projectId: 'p2', sectionId: 's5', assignedTo: 'u4', assignedBy: 'u1', createdBy: 'u1', dueDate: d(4), priority: 'High', status: 'in_progress', isStarted: true, startedAt: d(-3), approvedByManager: false, timeTracked: 5400, tags: ['Figma', 'UX', 'Animation'], createdAt: d(-5), timeLog: { [d(-3)]: 2700, [d(-2)]: 2700 } },
  { id: 't8', title: 'Push Notifications', description: 'Implement push notification service for iOS and Android with deep linking support.', projectId: 'p2', sectionId: 's6', assignedTo: 'u2', assignedBy: 'u1', createdBy: 'u1', dueDate: d(6), priority: 'Medium', status: 'backlog', isStarted: false, approvedByManager: false, timeTracked: 0, tags: ['Firebase', 'APNs', 'Deep Links'], createdAt: d(-3), timeLog: {} },
  { id: 't9', title: 'E2E Test Suite', description: 'Write comprehensive end-to-end tests for critical user flows using Detox.', projectId: 'p2', sectionId: 's8', assignedTo: 'u2', assignedBy: 'u1', createdBy: 'u1', dueDate: d(8), priority: 'Low', status: 'backlog', isStarted: true, startedAt: d(-1), approvedByManager: false, timeTracked: 900, tags: ['Detox', 'Testing', 'QA'], createdAt: d(-2), timeLog: { [d(-1)]: 900 } },
  { id: 't10', title: 'Android Material Design', description: 'Implement Material Design 3 components and theme system for Android.', projectId: 'p2', sectionId: 's7', assignedTo: 'u4', assignedBy: 'u1', createdBy: 'u1', dueDate: d(12), priority: 'Medium', status: 'backlog', isStarted: false, approvedByManager: false, timeTracked: 0, tags: ['Material', 'Kotlin', 'Compose'], createdAt: d(-1), timeLog: {} },
  { id: 't11', title: 'Payment Integration', description: 'Integrate Stripe payment gateway with support for cards, Apple Pay, and Google Pay.', projectId: 'p2', sectionId: 's6', assignedTo: 'u2', assignedBy: 'u1', createdBy: 'u1', dueDate: d(2), priority: 'Urgent', status: 'in_progress', isStarted: true, startedAt: d(-2), approvedByManager: false, timeTracked: 9000, tags: ['Stripe', 'Payments', 'iOS'], createdAt: d(-4), timeLog: { [d(-2)]: 4500, [d(-1)]: 4500 } },
  { id: 't12', title: 'Offline Mode Support', description: 'Implement local data caching and sync mechanism for offline usage.', projectId: 'p1', sectionId: 's1', assignedTo: 'u3', assignedBy: 'u1', createdBy: 'u1', dueDate: d(15), priority: 'Low', status: 'backlog', isStarted: false, approvedByManager: false, timeTracked: 0, tags: ['SQLite', 'Sync', 'Cache'], createdAt: d(0), timeLog: {} },
];
