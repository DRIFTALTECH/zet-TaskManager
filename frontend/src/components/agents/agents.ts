/**
 * The ZET agent mascots. Each maps to a domain and a set of routes where it
 * "lives". Shapes/colors mirror the brand characters:
 *   - Tasker  (black)  → task extraction / creation / assignment
 *   - Pilot   (yellow) → project management, overdue/over-estimate flags
 *   - Zani    (purple) → personal assistant, explanations (the default everywhere)
 *
 * (Tracky / timesheet mascot was removed — no time-tracking agent.)
 */
export type AgentId = 'tasker' | 'pilot' | 'zani';
export type AgentMood = 'idle' | 'happy' | 'busy' | 'alert' | 'talking' | 'thinking' | 'sad' | 'angry' | 'ouch';
export type AgentShape = 'tallRect' | 'dome' | 'tallDome';

export interface AgentDef {
  id: AgentId;
  name: string;
  shape: AgentShape;
  /** Body fill (light, dark) so it reads in both themes. */
  body: { light: string; dark: string };
  /** Accent used for the alert/red-flag state glow etc. */
  accent: string;
  /** Vertical centre of the eyes within the 0..140 viewBox. */
  eyeY: number;
  domain: string;
}

export const AGENTS: Record<AgentId, AgentDef> = {
  tasker: {
    id: 'tasker', name: 'Tasker', shape: 'tallRect',
    body: { light: '#2b2b30', dark: '#3a3a42' }, accent: '#f97316',
    eyeY: 44, domain: 'Tasks',
  },
  pilot: {
    id: 'pilot', name: 'Pilot', shape: 'tallDome',
    body: { light: '#e3d864', dark: '#d9cd4f' }, accent: '#ef4444',
    eyeY: 72, domain: 'Projects',
  },
  zani: {
    id: 'zani', name: 'Zani', shape: 'tallRect',
    body: { light: '#6d4dff', dark: '#7c5cff' }, accent: '#a78bfa',
    eyeY: 40, domain: 'Assistant',
  },
};

/** Resolve which mascot owns a given route path. Falls back to Zani everywhere. */
export function agentForPath(pathname: string): AgentId {
  if (pathname === '/tasks' || pathname === '/ai') return 'tasker';
  if (pathname.startsWith('/manage') || pathname.startsWith('/users') || pathname === '/meeting-notes') return 'pilot';
  return 'zani';
}

/** Idle one-liners shown occasionally in the speech bubble, per agent. */
export const AGENT_TIPS: Record<AgentId, string[]> = {
  tasker: ['Drop notes in the AI box — I’ll turn them into tasks.', 'Drag a card to Done and I’ll file it.', 'Need tasks fast? Paste a meeting summary.'],
  pilot: ['I keep an eye on deadlines for you.', 'Add members and sections from the project page.', 'I’ll wave a red flag when a task runs late.'],
  zani: ['Press ⌘K to search anything.', 'Ask me to explain any page.', 'I’m here if you get stuck.'],
};
