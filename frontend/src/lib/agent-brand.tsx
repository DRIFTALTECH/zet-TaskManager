import type { ReactNode } from 'react';

/**
 * Detects AI-assistant authors by name (Claude / Cursor / Copilot / GPT) so their
 * comments show the real brand mark instead of an initials avatar.
 */
export interface AgentBrand {
  id: 'claude' | 'cursor' | 'copilot' | 'gpt';
  label: string;
  bg: string;
  icon: ReactNode;
}

const CLAUDE_ICON = (
  // Anthropic "spark" — radiating burst.
  <svg viewBox="0 0 24 24" width="60%" height="60%" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="12" y1="3" x2="12" y2="21" /><line x1="3" y1="12" x2="21" y2="12" />
    <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /><line x1="18.4" y1="5.6" x2="5.6" y2="18.4" />
  </svg>
);
const CURSOR_ICON = (
  // Cursor — pointer arrow.
  <svg viewBox="0 0 24 24" width="58%" height="58%" fill="#fff" aria-hidden>
    <path d="M5 3 L19 12 L12 13 L9 20 Z" />
  </svg>
);
const COPILOT_ICON = (
  // Copilot — goggles.
  <svg viewBox="0 0 28 28" width="64%" height="64%" fill="none" stroke="#fff" strokeWidth="2.2" aria-hidden>
    <circle cx="9.5" cy="14" r="4" /><circle cx="18.5" cy="14" r="4" /><line x1="13.5" y1="14" x2="14.5" y2="14" />
  </svg>
);
const GPT_ICON = (
  <svg viewBox="0 0 24 24" width="58%" height="58%" fill="none" stroke="#fff" strokeWidth="2" aria-hidden>
    <circle cx="12" cy="12" r="8" /><path d="M12 7 v10 M7 12 h10" strokeLinecap="round" />
  </svg>
);

export function matchAgentBrand(name?: string): AgentBrand | null {
  const n = (name || '').toLowerCase();
  if (n.includes('claude')) return { id: 'claude', label: 'Claude', bg: '#D97757', icon: CLAUDE_ICON };
  if (n.includes('cursor')) return { id: 'cursor', label: 'Cursor', bg: '#0A0A0A', icon: CURSOR_ICON };
  if (n.includes('copilot')) return { id: 'copilot', label: 'Copilot', bg: '#1f6feb', icon: COPILOT_ICON };
  if (n.includes('gpt') || n.includes('openai') || n.includes('chatgpt')) return { id: 'gpt', label: 'GPT', bg: '#10A37F', icon: GPT_ICON };
  return null;
}

/** Branded square badge for an AI author. */
export function AgentBrandBadge({ brand, size = 32 }: { brand: AgentBrand; size?: number }) {
  return (
    <span
      title={brand.label}
      className="inline-flex shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-black/10"
      style={{ width: size, height: size, background: brand.bg }}
    >
      {brand.icon}
    </span>
  );
}
