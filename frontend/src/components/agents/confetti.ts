/**
 * Tiny dependency-free confetti burst. Spawns a transient full-screen canvas,
 * fires a spread of paper bits from an origin point, animates with gravity, then
 * removes itself. Used for the Tasker "all my tasks are done" celebration.
 */

interface BurstOptions {
  /** Origin in viewport px. Defaults to bottom-right (near the mascot). */
  origin?: { x: number; y: number };
  count?: number;
  /** Spread cone direction in radians (0 = right, -PI/2 = up). Default up-left. */
  angle?: number;
  colors?: string[];
}

interface Bit {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; w: number; h: number; color: string; life: number;
}

const DEFAULT_COLORS = ['#f97316', '#6d4dff', '#10b981', '#f43f5e', '#eab308', '#38bdf8'];

export function burstConfetti(opts: BurstOptions = {}): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth;
  const H = window.innerHeight;

  const canvas = document.createElement('canvas');
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  Object.assign(canvas.style, {
    position: 'fixed', inset: '0', width: `${W}px`, height: `${H}px`,
    pointerEvents: 'none', zIndex: '60',
  } as CSSStyleDeclaration);
  document.body.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);

  const origin = opts.origin ?? { x: W - 80, y: H - 90 };
  const count = opts.count ?? 110;
  const baseAngle = opts.angle ?? -Math.PI * 0.62; // up and slightly left
  const colors = opts.colors ?? DEFAULT_COLORS;

  const bits: Bit[] = Array.from({ length: count }, () => {
    const spread = (Math.random() - 0.5) * Math.PI * 0.7;
    const a = baseAngle + spread;
    const speed = 7 + Math.random() * 9;
    return {
      x: origin.x, y: origin.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.4,
      w: 6 + Math.random() * 6,
      h: 9 + Math.random() * 8,
      color: colors[(Math.random() * colors.length) | 0],
      life: 1,
    };
  });

  const GRAVITY = 0.32;
  const DRAG = 0.992;
  let frame = 0;

  const tick = () => {
    frame++;
    ctx.clearRect(0, 0, W, H);
    let alive = false;
    for (const b of bits) {
      b.vx *= DRAG;
      b.vy = b.vy * DRAG + GRAVITY;
      b.x += b.vx;
      b.y += b.vy;
      b.rot += b.vr;
      if (frame > 60) b.life -= 0.015;
      if (b.life > 0 && b.y < H + 40) {
        alive = true;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.globalAlpha = Math.max(0, b.life);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
        ctx.restore();
      }
    }
    if (alive && frame < 240) {
      requestAnimationFrame(tick);
    } else {
      canvas.remove();
    }
  };
  requestAnimationFrame(tick);
}
