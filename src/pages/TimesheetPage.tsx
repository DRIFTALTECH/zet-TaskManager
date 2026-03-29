import { useAppStore } from '@/stores/appStore';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';

const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDates(weekOffset: number) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
  return days.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

const TimesheetPage = () => {
  const { currentUser, tasks, projects, logTime } = useAppStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState('');
  const [logHours, setLogHours] = useState('');
  const [logDate, setLogDate] = useState('');

  const weekDates = getWeekDates(weekOffset);

  // Auto-track in_progress tasks
  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().split('T')[0];
      tasks.filter(t => t.assignedTo === currentUser?.id && t.status === 'in_progress').forEach(t => {
        logTime(t.id, today, 60); // Add 1 min every minute
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [tasks, currentUser]);

  if (!currentUser) return null;

  const myTasks = tasks.filter(t => t.assignedTo === currentUser.id && t.isStarted);

  const getHours = (taskId: string, date: string) => {
    const task = tasks.find(t => t.id === taskId);
    return task?.timeLog[date] ? task.timeLog[date] / 3600 : 0;
  };

  const hourColor = (h: number) => {
    if (h === 0) return '';
    if (h <= 4) return 'bg-green-500/10 text-green-500';
    if (h <= 8) return 'bg-yellow-500/10 text-yellow-500';
    return 'bg-red-500/10 text-red-500';
  };

  const handleLogTime = () => {
    if (!logTaskId || !logHours || !logDate) return toast.error('Fill all fields');
    const seconds = parseFloat(logHours) * 3600;
    logTime(logTaskId, logDate, seconds);
    toast.success('Time logged!');
    setLogOpen(false);
    setLogHours(''); setLogTaskId(''); setLogDate('');
  };

  const exportCSV = () => {
    const header = ['Task', 'Project', 'Section', ...days, 'Total'].join(',');
    const rows = myTasks.map(t => {
      const project = projects.find(p => p.id === t.projectId);
      const section = project?.sections.find(s => s.id === t.sectionId);
      const dailyHours = weekDates.map(d => getHours(t.id, d).toFixed(1));
      const total = dailyHours.reduce((a, b) => a + parseFloat(b), 0).toFixed(1);
      return [t.title, project?.name, section?.name, ...dailyHours, total].join(',');
    });
    const csv = [header, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `timesheet_week_${weekDates[0]}.csv`; a.click();
    toast.success('Timesheet exported!');
  };

  const weekLabel = `${weekDates[0]} — ${weekDates[6]}`;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Timesheet</h1>
          <p className="text-sm text-muted-foreground mt-1">Track and log your working hours</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setLogDate(new Date().toISOString().split('T')[0]); setLogOpen(true); }}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm hover:bg-muted/50 transition-colors"
          >
            <Plus className="h-4 w-4" /> Log Time
          </button>
          <button onClick={exportCSV}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Download className="h-4 w-4" /> Export CSV
          </button>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-xl border hover:bg-muted/50 transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium">{weekLabel}</span>
        <button onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-xl border hover:bg-muted/50 transition-colors">
          <ChevronRight className="h-4 w-4" />
        </button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline">Today</button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border bg-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 min-w-[200px]">Task</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-3 py-3">Project</th>
                {days.map((d, i) => (
                  <th key={d} className="text-center text-xs font-semibold text-muted-foreground px-3 py-3 min-w-[60px]">
                    <div>{d}</div>
                    <div className="text-[10px] font-normal">{weekDates[i]?.slice(5)}</div>
                  </th>
                ))}
                <th className="text-center text-xs font-semibold text-muted-foreground px-3 py-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {myTasks.map(task => {
                const project = projects.find(p => p.id === task.projectId);
                const rowTotal = weekDates.reduce((a, d) => a + getHours(task.id, d), 0);
                return (
                  <tr key={task.id} className="border-b last:border-b-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium">{task.title}</td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">{project?.name}</td>
                    {weekDates.map(d => {
                      const h = getHours(task.id, d);
                      return (
                        <td key={d} className="px-3 py-3 text-center">
                          <span className={`text-xs font-medium px-2 py-1 rounded-lg ${hourColor(h)}`}>
                            {h > 0 ? h.toFixed(1) : '—'}
                          </span>
                        </td>
                      );
                    })}
                    <td className="px-3 py-3 text-center text-sm font-semibold">{rowTotal.toFixed(1)}h</td>
                  </tr>
                );
              })}
              {myTasks.length === 0 && (
                <tr><td colSpan={10} className="text-center py-12 text-muted-foreground text-sm">No tasks to track</td></tr>
              )}
              {/* Totals row */}
              {myTasks.length > 0 && (
                <tr className="bg-muted/30 font-semibold">
                  <td className="px-4 py-3 text-sm" colSpan={2}>Daily Total</td>
                  {weekDates.map(d => {
                    const dayTotal = myTasks.reduce((a, t) => a + getHours(t.id, d), 0);
                    return (
                      <td key={d} className="px-3 py-3 text-center text-sm">{dayTotal > 0 ? dayTotal.toFixed(1) : '—'}</td>
                    );
                  })}
                  <td className="px-3 py-3 text-center text-sm">
                    {myTasks.reduce((a, t) => a + weekDates.reduce((b, d) => b + getHours(t.id, d), 0), 0).toFixed(1)}h
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log Time Modal */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="glass sm:max-w-sm">
          <DialogHeader><DialogTitle>Log Time</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <select value={logTaskId} onChange={e => setLogTaskId(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none">
              <option value="">Select Task</option>
              {myTasks.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
            </select>
            <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none" />
            <input type="number" step="0.5" min="0" value={logHours} onChange={e => setLogHours(e.target.value)}
              className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none" placeholder="Hours (e.g. 2.5)" />
            <button onClick={handleLogTime}
              className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-opacity">
              Log Time
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default TimesheetPage;
