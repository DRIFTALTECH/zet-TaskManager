import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { Mail, Briefcase, ListTodo, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { snappy, pageEnter } from '@/lib/motion';
import { isTaskAssignedTo } from '@/lib/task-utils';

const UsersPage = () => {
  const { users, tasks, projects } = useAppStore();
  const navigate = useNavigate();
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const filteredUsers = selectedProjectId
    ? users.filter(u => {
        const project = projects.find(p => p.id === selectedProjectId);
        return project?.members.includes(u.id);
      })
    : users;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={pageEnter} className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Users</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filteredUsers.length} team member{filteredUsers.length !== 1 ? 's' : ''}
            {selectedProjectId ? ` in ${projects.find(p => p.id === selectedProjectId)?.name}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedProjectId}
            onChange={e => setSelectedProjectId(e.target.value)}
            className="rounded-xl border bg-muted/50 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 transition-colors duration-100"
          >
            <option value="">All Projects</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {filteredUsers.map((user, i) => {
          const activeTasks = tasks.filter(t => isTaskAssignedTo(t, user.id) && t.status !== 'completed').length;
          const userProjects = projects.filter(p => p.members.includes(user.id));
          return (
            <motion.div
              key={user.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/users/${user.id}`)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  navigate(`/users/${user.id}`);
                }
              }}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: 'tween', duration: 0.15, ease: 'easeOut', delay: i * 0.02 }}
              whileHover={{
                scale: 1.01,
                y: -2,
                boxShadow: '0 12px 40px -8px hsl(var(--foreground) / 0.1)',
                transition: snappy,
              }}
              className="rounded-2xl border bg-card p-5 transition-shadow duration-100 cursor-pointer text-left"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-bold text-primary">{user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}</span>
                </div>
                <div>
                  <h3 className="font-semibold">{user.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${user.role === 'manager' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {user.role}
                  </span>
                </div>
              </div>
              <div className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {user.email}</div>
                <div className="flex items-center gap-2"><ListTodo className="h-3.5 w-3.5" /> {activeTasks} active tasks</div>
                <div className="flex items-center gap-2"><Briefcase className="h-3.5 w-3.5" /> {userProjects.map(p => p.name).join(', ') || 'No projects'}</div>
              </div>
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default UsersPage;
