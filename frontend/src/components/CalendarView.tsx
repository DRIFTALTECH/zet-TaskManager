import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Task, Priority } from '@/types';

const PRIORITY_PILL: Record<Priority, string> = {
  Urgent: 'bg-red-500/20 text-red-400 border-red-500/30',
  High:   'bg-orange-500/20 text-orange-400 border-orange-500/30',
  Medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  Low:    'bg-green-500/20 text-green-400 border-green-500/30',
};
const PRIORITY_DOT: Record<Priority, string> = {
  Urgent: 'bg-red-400',
  High:   'bg-orange-400',
  Medium: 'bg-yellow-400',
  Low:    'bg-green-400',
};

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function datesInMonth(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  // Pad to complete the last row
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Props {
  tasks: Task[];
  onTaskClick: (task: Task) => void;
  /** Drag a task to another day → reschedule its due date (YYYY-MM-DD). */
  onTaskDrop?: (taskId: string, newDate: string) => void;
}

export default function CalendarView({ tasks, onTaskClick, onTaskDrop }: Props) {
  const [viewDate, setViewDate] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const cells = useMemo(
    () => datesInMonth(viewDate.year, viewDate.month),
    [viewDate],
  );

  const tasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) {
      const key = t.dueDate?.slice(0, 10);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [tasks]);

  const todayStr = toDateStr(new Date());

  const prevMonth = () =>
    setViewDate(({ year, month }) =>
      month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 },
    );
  const nextMonth = () =>
    setViewDate(({ year, month }) =>
      month === 11 ? { year: year + 1, month: 0 } : { year, month: month + 1 },
    );

  const monthLabel = new Date(viewDate.year, viewDate.month, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Month navigator */}
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={prevMonth}
          className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="font-semibold text-sm min-w-[140px] text-center">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          onClick={() => setViewDate({ year: new Date().getFullYear(), month: new Date().getMonth() })}
          className="ml-1 text-xs px-2.5 py-1 rounded-lg border border-border/40 hover:bg-muted/40 text-muted-foreground transition-colors"
        >
          Today
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 gap-px flex-1 min-h-0">
        {cells.map((date, idx) => {
          if (!date) {
            return <div key={`empty-${idx}`} className="rounded-lg bg-muted/5 min-h-[80px]" />;
          }
          const key = toDateStr(date);
          const dayTasks = tasksByDate.get(key) ?? [];
          const isToday = key === todayStr;
          const maxVisible = 3;
          const overflow = dayTasks.length - maxVisible;

          return (
            <motion.div
              key={key}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15, delay: (idx % 7) * 0.02 }}
              onDragOver={onTaskDrop ? (e => { e.preventDefault(); setDragOverKey(key); }) : undefined}
              onDragLeave={onTaskDrop ? (() => setDragOverKey(k => (k === key ? null : k))) : undefined}
              onDrop={onTaskDrop ? (e => {
                e.preventDefault();
                setDragOverKey(null);
                const id = e.dataTransfer.getData('text/task-id');
                if (id) onTaskDrop(id, key);
              }) : undefined}
              className={`rounded-lg p-1.5 min-h-[80px] flex flex-col gap-0.5 border transition-colors ${
                dragOverKey === key
                  ? 'border-primary ring-2 ring-primary/40 bg-primary/10'
                  : isToday
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border/20 bg-muted/5 hover:bg-muted/10'
              }`}
            >
              {/* Day number */}
              <span className={`text-xs font-semibold self-end px-1 ${isToday ? 'text-primary' : 'text-muted-foreground/60'}`}>
                {date.getDate()}
              </span>

              {/* Task pills */}
              {dayTasks.slice(0, maxVisible).map(task => (
                <button
                  key={task.id}
                  draggable={!!onTaskDrop}
                  onDragStart={onTaskDrop ? (e => { e.dataTransfer.setData('text/task-id', task.id); e.dataTransfer.effectAllowed = 'move'; }) : undefined}
                  onClick={() => onTaskClick(task)}
                  title={onTaskDrop ? `${task.title} — drag to reschedule` : task.title}
                  className={`w-full flex items-center gap-1 px-1.5 py-0.5 rounded-md text-left border text-[10px] font-medium truncate leading-tight hover:opacity-80 transition-opacity ${onTaskDrop ? 'cursor-grab active:cursor-grabbing' : ''} ${PRIORITY_PILL[task.priority]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${PRIORITY_DOT[task.priority]}`} />
                  <span className="truncate">{task.title}</span>
                </button>
              ))}

              {overflow > 0 && (
                <span className="text-[9px] text-muted-foreground/50 pl-1">+{overflow} more</span>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
