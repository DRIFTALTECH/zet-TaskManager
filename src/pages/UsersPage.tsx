import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { Mail, Briefcase, ListTodo } from 'lucide-react';

const UsersPage = () => {
  const { users, tasks, projects } = useAppStore();

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Users</h1>
        <p className="text-sm text-muted-foreground mt-1">All team members</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {users.map((user, i) => {
          const activeTasks = tasks.filter(t => t.assignedTo === user.id && t.status !== 'completed').length;
          const userProjects = projects.filter(p => p.members.includes(user.id));
          return (
            <motion.div key={user.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl border bg-card p-5 card-hover"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl">{user.avatar}</div>
                <div>
                  <h3 className="font-semibold">{user.name}</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${user.role === 'manager' ? 'bg-primary/10 text-primary' : 'bg-secondary/10 text-secondary'}`}>
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
