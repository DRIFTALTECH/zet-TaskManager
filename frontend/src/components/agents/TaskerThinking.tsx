import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import AgentAvatar from './AgentAvatar';

const PHASES = ['reading', 'understanding', 'drafting tasks', 'almost done'];

/**
 * Tasker "thinking" state — replaces the generic loader while the AI extracts
 * tasks. Tasker glances up with an animated thought bubble; the phase label
 * cycles. Used inside the Create-tasks modal.
 */
export default function TaskerThinking({ className = '' }: { className?: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setPhase(p => (p + 1) % PHASES.length), 1600);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-6 ${className}`}>
      <div className="relative">
        <motion.div
          animate={{ y: [0, -4, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
        >
          <AgentAvatar agent="tasker" mood="thinking" size={78} />
        </motion.div>

        {/* Thought bubble with pulsing dots */}
        <div className="absolute -right-6 -top-3 flex items-center gap-1 rounded-2xl rounded-bl-sm border border-border/50 bg-card px-2.5 py-1.5 shadow-md">
          {[0, 1, 2].map(i => (
            <motion.span
              key={i}
              className="h-1.5 w-1.5 rounded-full bg-violet-500"
              animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
              transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.18 }}
            />
          ))}
        </div>
      </div>

      <div className="h-5 overflow-hidden text-center">
        <motion.p
          key={phase}
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -12, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="text-sm font-semibold text-muted-foreground"
        >
          Tasker is {PHASES[phase]}…
        </motion.p>
      </div>
    </div>
  );
}
