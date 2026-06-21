import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '@/stores/appStore';
import { AGENTS, type AgentId, type AgentMood } from './agents';

interface Props {
  agent: AgentId;
  mood?: AgentMood;
  size?: number;
  /** Disable eye-tracking + blink (reduced motion). Body still renders. */
  still?: boolean;
  className?: string;
}

/** Body outline path for each shape, within a 120×140 viewBox. */
function bodyPath(shape: string): string {
  switch (shape) {
    case 'dome': // short rounded-top, flat bottom (Tracky)
      return 'M14 132 V72 a46 46 0 0 1 92 0 V132 Z';
    case 'tallDome': // taller capsule, rounded top (Pilot)
      return 'M30 134 V54 a30 30 0 0 1 60 0 V134 Z';
    case 'tallRect': // tall rounded rectangle (Tasker / Zani)
    default:
      return 'M24 134 V26 a18 18 0 0 1 18 -18 h36 a18 18 0 0 1 18 18 V134 Z';
  }
}

/** Mouth path per mood (null = no mouth drawn). */
function mouthPath(mood: AgentMood, cy: number): string | null {
  const y = cy + 26;
  switch (mood) {
    case 'happy': return `M${60 - 12} ${y} q12 12 24 0`;
    case 'alert': return `M${60 - 10} ${y + 2} q10 -9 20 0`; // worried (frown)
    case 'sad': return `M${60 - 12} ${y + 5} q12 -11 24 0`; // big frown
    case 'angry': return `M${60 - 11} ${y + 4} q11 -8 22 0`; // tight frown
    case 'busy': return `M60 ${y} m-5 0 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0`; // small "o"
    case 'thinking': return `M${60 - 7} ${y + 1} q7 3 14 0`; // subtle pensive curve
    case 'talking': return `M${60 - 9} ${y} h18`; // flat (animated via scaleY)
    default: return null; // 'ouch' draws an open ellipse instead (below)
  }
}

/** Angled eyebrows convey anger/sadness. Returns two line coords or null. */
function brows(mood: AgentMood, lx: number, rx: number, ey: number): [number, number, number, number][] | null {
  const top = ey - 13;
  if (mood === 'angry') return [
    [lx - 7, top, lx + 6, top + 5],   // \  toward centre, slanting down-in
    [rx + 7, top, rx - 6, top + 5],   //  /
  ];
  if (mood === 'sad') return [
    [lx - 6, top + 5, lx + 6, top],   // /  slanting up-in
    [rx + 6, top + 5, rx - 6, top],   //  \
  ];
  return null;
}

export default function AgentAvatar({ agent, mood = 'idle', size = 64, still = false, className }: Props) {
  const def = AGENTS[agent];
  const theme = useAppStore(s => s.theme);
  const fill = theme === 'dark' ? def.body.dark : def.body.light;

  const svgRef = useRef<SVGSVGElement>(null);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);

  // Eye-tracking: pupils lean toward the cursor, relative to this avatar's centre.
  // Some moods fix the gaze: thinking glances up, sad looks down.
  useEffect(() => {
    if (mood === 'thinking') { setPupil({ x: -1.4, y: -3 }); return; }
    if (mood === 'sad') { setPupil({ x: 0, y: 3 }); return; }
    if (still) { setPupil({ x: 0, y: 0 }); return; }
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const el = svgRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const d = Math.hypot(dx, dy) || 1;
        const max = 3.2; // px of travel in viewBox units
        setPupil({ x: (dx / d) * max, y: (dy / d) * max });
      });
    };
    window.addEventListener('mousemove', onMove);
    return () => { window.removeEventListener('mousemove', onMove); cancelAnimationFrame(raf); };
  }, [still, mood]);

  // Blink: brief eyelid close at random intervals.
  useEffect(() => {
    if (still) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 130);
        loop();
      }, 2200 + Math.random() * 2600);
    };
    loop();
    return () => clearTimeout(t);
  }, [still]);

  const eyeY = def.eyeY;
  const leftX = 48;
  const rightX = 72;
  const eyeRx = 8;
  const mouth = mouthPath(mood, eyeY);
  const eyebrows = brows(mood, leftX, rightX, eyeY);

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      className={className}
      role="img"
      aria-label={`${def.name} mascot`}
    >
      {/* Body */}
      <path d={bodyPath(def.shape)} fill={fill} />

      {/* Eyes (white) — scaleY collapses on blink */}
      <g style={{ transform: `scaleY(${blink ? 0.12 : 1})`, transformBox: 'fill-box', transformOrigin: 'center' }}>
        <ellipse cx={leftX} cy={eyeY} rx={eyeRx} ry={eyeRx} fill="#fff" />
        <ellipse cx={rightX} cy={eyeY} rx={eyeRx} ry={eyeRx} fill="#fff" />
      </g>
      {/* Pupils */}
      {!blink && (
        <>
          <circle cx={leftX + pupil.x} cy={eyeY + pupil.y} r={3.6} fill="#16161a" />
          <circle cx={rightX + pupil.x} cy={eyeY + pupil.y} r={3.6} fill="#16161a" />
        </>
      )}

      {/* Eyebrows (anger / sadness) */}
      {eyebrows && (
        <g stroke="#16161a" strokeWidth={2.6} strokeLinecap="round">
          {eyebrows.map((b, i) => <line key={i} x1={b[0]} y1={b[1]} x2={b[2]} y2={b[3]} />)}
        </g>
      )}

      {/* Mouth */}
      {mood === 'ouch' ? (
        <ellipse cx={60} cy={eyeY + 27} rx={6} ry={8} fill="#16161a" />
      ) : mouth && (
        <path
          d={mouth}
          fill={mood === 'busy' ? '#16161a' : 'none'}
          stroke="#16161a"
          strokeWidth={mood === 'busy' ? 0 : 3}
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
