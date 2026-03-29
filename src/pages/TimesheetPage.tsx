import { useAppStore } from '@/stores/appStore';
import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Download, Plus, Bell, Send, X } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const dayShort = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekDates(weekOffset: number) {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + weekOffset * 7);
  return dayShort.map((_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d.toISOString().split('T')[0];
  });
}

const TimesheetPage = () => {
  const { currentUser, tasks, projects, users, logTime } = useAppStore();
  const [weekOffset, setWeekOffset] = useState(0);
  const [logOpen, setLogOpen] = useState(false);
  const [logTaskId, setLogTaskId] = useState('');
  const [logHours, setLogHours] = useState('');
  const [logDate, setLogDate] = useState('');
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyRecipient, setNotifyRecipient] = useState('');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

  const weekDates = getWeekDates(weekOffset);

  // Auto-track in_progress tasks
  useEffect(() => {
    const interval = setInterval(() => {
      const today = new Date().toISOString().split('T')[0];
      tasks.filter(t => t.assignedTo === currentUser?.id && t.status === 'in_progress').forEach(t => {
        logTime(t.id, today, 60);
      });
    }, 60000);
    return () => clearInterval(interval);
  }, [tasks, currentUser]);

  if (!currentUser) return null;

  const myTasks = tasks.filter(t => t.assignedTo === currentUser.id && t.isStarted);
  const managers = users.filter(u => u.role === 'manager');

  const getHours = (taskId: string, date: string) => {
    const task = tasks.find(t => t.id === taskId);
    return task?.timeLog[date] ? task.timeLog[date] / 3600 : 0;
  };

  const formatHours = (h: number) => {
    if (h === 0) return '—';
    const hrs = Math.floor(h);
    const mins = Math.round((h - hrs) * 60);
    return hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  };

  // Build day-based view
  const dayView = weekDates.map((date, idx) => {
    const tasksForDay = myTasks.filter(t => t.timeLog[date] && t.timeLog[date] > 0).map(t => {
      const project = projects.find(p => p.id === t.projectId);
      const section = project?.sections.find(s => s.id === t.sectionId);
      return { task: t, project, section, hours: getHours(t.id, date) };
    });
    const totalHours = tasksForDay.reduce((a, b) => a + b.hours, 0);
    return { date, dayName: dayNames[idx], dayShortName: dayShort[idx], tasksForDay, totalHours };
  });

  const handleLogTime = () => {
    if (!logTaskId || !logHours || !logDate) return toast.error('Fill all fields');
    logTime(logTaskId, logDate, parseFloat(logHours) * 3600);
    toast.success('Time logged!');
    setLogOpen(false);
    setLogHours(''); setLogTaskId(''); setLogDate('');
  };

  const exportCSV = () => {
    const header = ['Task', 'Project', 'Section', ...dayShort, 'Total'].join(',');
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

  const toggleDay = (date: string) => {
    setSelectedDays(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date]);
  };

  const handleNotify = () => {
    if (!notifyRecipient) return toast.error('Select a recipient');
    if (selectedDays.length === 0) return toast.error('Select at least one day');
    toast.success(`Schedule sent to ${users.find(u => u.id === notifyRecipient)?.name || 'recipient'}!`);
    setNotifyOpen(false);
    setSelectedDays([]);
    setNotifyRecipient('');
  };

  // Build schedule summary for selected days
  const scheduleSummary = selectedDays.sort().map(date => {
    const dv = dayView.find(d => d.date === date);
    return dv;
  }).filter(Boolean);

  const weekLabel = `${weekDates[0]} — ${weekDates[6]}`;

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Timesheet</h1>
          <p className="text-sm text-muted-foreground mt-1">Track your daily work</p>
        </div>
        <div className="flex items-center gap-2">
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={() => { setLogDate(new Date().toISOString().split('T')[0]); setLogOpen(true); }}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm hover:bg-muted/50 transition-all duration-200"
          >
            <Plus className="h-4 w-4" /> Log Time
          </motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={() => { setSelectedDays(weekDates.filter(d => dayView.find(dv => dv.date === d)?.totalHours! > 0)); setNotifyOpen(true); }}
            className="flex items-center gap-2 rounded-xl border px-4 py-2 text-sm hover:bg-muted/50 transition-all duration-200"
          >
            <Bell className="h-4 w-4" /> Notify
          </motion.button>
          <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={exportCSV}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90 transition-all duration-200"
          >
            <Download className="h-4 w-4" /> Export
          </motion.button>
        </div>
      </div>

      {/* Week navigation */}
      <div className="flex items-center gap-4 mb-6">
        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
          onClick={() => setWeekOffset(w => w - 1)} className="p-2 rounded-xl border hover:bg-muted/50 transition-all duration-200">
          <ChevronLeft className="h-4 w-4" />
        </motion.button>
        <span className="text-sm font-medium">{weekLabel}</span>
        <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
          onClick={() => setWeekOffset(w => w + 1)} className="p-2 rounded-xl border hover:bg-muted/50 transition-all duration-200">
          <ChevronRight className="h-4 w-4" />
        </motion.button>
        {weekOffset !== 0 && (
          <button onClick={() => setWeekOffset(0)} className="text-xs text-primary hover:underline">Today</button>
        )}
      </div>

      {/* Day-based view */}
      <div className="space-y-4">
        {dayView.map((day, idx) => (
          <motion.div
            key={day.date}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
            className="rounded-2xl border bg-card overflow-hidden"
          >
            <div className="flex items-center justify-between px-5 py-3 bg-muted/30 border-b">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold">{day.dayName}</span>
                <span className="text-xs text-muted-foreground font-mono">{day.date}</span>
              </div>
              <span className={`text-sm font-semibold ${day.totalHours > 0 ? 'text-foreground' : 'text-muted-foreground/40'}`}>
                {day.totalHours > 0 ? formatHours(day.totalHours) : 'No activity'}
              </span>
            </div>

            {day.tasksForDay.length > 0 ? (
              <div className="divide-y divide-border/50">
                {day.tasksForDay.map(({ task, project, section, hours }) => (
                  <motion.div
                    key={task.id}
                    whileHover={{ backgroundColor: 'hsl(var(--muted) / 0.3)', x: 4 }}
                    className="flex items-center justify-between px-5 py-3 transition-all duration-200"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium">{task.title}</span>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                          <span>{project?.name}</span>
                          {section && <><span>·</span><span>{section.name}</span></>}
                        </div>
                      </div>
                    </div>
                    <span className="text-sm font-semibold font-mono">{formatHours(hours)}</span>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="px-5 py-4 text-sm text-muted-foreground/50">No logged time</div>
            )}
          </motion.div>
        ))}
      </div>

      {/* Log Time Modal */}
      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-md">
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

      {/* Notify Modal */}
      <Dialog open={notifyOpen} onOpenChange={setNotifyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Notify Schedule</DialogTitle></DialogHeader>

          <div className="space-y-4">
            {/* Day selection */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-2 block">Select Days</label>
              <div className="flex flex-wrap gap-2">
                {weekDates.map((date, idx) => (
                  <motion.button
                    key={date}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => toggleDay(date)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all duration-200 ${
                      selectedDays.includes(date)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/50 hover:bg-muted border-border'
                    }`}
                  >
                    {dayShort[idx]} {date.slice(5)}
                  </motion.button>
                ))}
              </div>
            </div>

            {/* Recipient */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground mb-2 block">Send To</label>
              <select
                value={notifyRecipient}
                onChange={e => setNotifyRecipient(e.target.value)}
                className="w-full rounded-xl border bg-muted/50 px-3 py-2 text-sm focus:outline-none"
              >
                <option value="">Select recipient...</option>
                {users.filter(u => u.id !== currentUser.id).map(u => (
                  <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                ))}
              </select>
            </div>

            {/* Schedule Preview */}
            {scheduleSummary.length > 0 && (
              <div className="rounded-xl border bg-muted/30 p-4 max-h-[280px] overflow-y-auto space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Schedule Preview</h4>
                {scheduleSummary.map(day => day && (
                  <div key={day.date} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold">{day.dayName} <span className="text-xs font-normal text-muted-foreground">{day.date}</span></span>
                      <span className="text-xs font-semibold">{formatHours(day.totalHours)}</span>
                    </div>
                    {day.tasksForDay.length > 0 ? (
                      day.tasksForDay.map(({ task, project, section, hours }) => (
                        <div key={task.id} className="flex items-center justify-between pl-4 text-xs text-muted-foreground">
                          <span>{task.title} · {project?.name}{section ? ` · ${section.name}` : ''}</span>
                          <span className="font-mono">{formatHours(hours)}</span>
                        </div>
                      ))
                    ) : (
                      <p className="pl-4 text-xs text-muted-foreground/50">No activity</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setNotifyOpen(false)}>Cancel</Button>
            <Button onClick={handleNotify} disabled={!notifyRecipient || selectedDays.length === 0} className="gap-2">
              <Send className="h-3.5 w-3.5" /> Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
};

export default TimesheetPage;
