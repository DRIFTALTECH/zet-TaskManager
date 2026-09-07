import { useEffect, useState } from 'react';

/**
 * The four characters, waiting with you.
 *
 * Every pause before the app is usable showed a 24px spinner — a shape that
 * says "something is happening" and nothing else. This is the cast from the
 * sign-in panel, at the same proportions and colours, so the wait is spent with
 * something the product already owns.
 *
 * The difference from the sign-in panel is what drives them. There, the bodies
 * lean and the eyes track because someone is moving a pointer and typing a
 * password. Here nobody is doing anything — that is the whole point of the
 * screen — so the motion runs on its own: the bodies sway on slow offset
 * cycles, and the four of them glance around together every couple of seconds.
 *
 * Geometry is lifted from AuthAnimatedCharactersPanel and must stay in step
 * with it; the stage is its 450×400 and is scaled down as one piece, so the
 * proportions cannot drift apart.
 */

const STAGE_W = 450;
const STAGE_H = 400;
const SCALE = 0.78;

/**
 * Where all four are looking, and how quickly they get there.
 *
 * A fixed interval read as a metronome — the whole point of eyes is that they
 * do not move on a schedule. So each glance picks its own wait and its own
 * speed: mostly quick darts a few hundred milliseconds apart, occasionally a
 * long slow drift while they settle on something.
 */
function useWanderingGaze() {
  const [look, setLook] = useState({ x: 0.2, y: 0.3, ms: 700 });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    const schedule = () => {
      // Roughly half the glances come in quick bursts; the rest are unhurried.
      const quick = Math.random() < 0.55;
      const wait = quick ? 220 + Math.random() * 520 : 1700 + Math.random() * 2800;

      timer = setTimeout(() => {
        const angle = Math.random() * Math.PI * 2;
        // Biased downward: they are looking out at the room, not up at nothing.
        const reach = 0.4 + Math.random() * 0.6;
        setLook({
          x: Math.cos(angle) * reach,
          y: Math.abs(Math.sin(angle)) * reach * 0.8,
          ms: quick ? 120 + Math.random() * 140 : 650 + Math.random() * 800,
        });
        schedule();
      }, wait);
    };

    schedule();
    return () => clearTimeout(timer);
  }, []);

  return look;
}

/** Sway timings drawn once per mount, so no two waits look quite the same. */
function useSwayDurations() {
  const [d] = useState(() => Array.from({ length: 4 }, () => 4.5 + Math.random() * 5));
  return d;
}

/** White eye with a pupil that leans where the group is looking. */
function EyeBall({
  size, pupilSize, reach, look, blinkDelay,
}: {
  size: number; pupilSize: number; reach: number;
  look: { x: number; y: number; ms: number }; blinkDelay: string;
}) {
  return (
    <span
      className="mascot-eye flex shrink-0 items-center justify-center rounded-full bg-white"
      style={{ width: size, height: size, animationDelay: blinkDelay }}
    >
      <span
        className="rounded-full bg-[#2D2D2D]"
        style={{
          width: pupilSize,
          height: pupilSize,
          transform: `translate(${look.x * reach}px, ${look.y * reach}px)`,
          transition: `transform ${look.ms}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        }}
      />
    </span>
  );
}

/** Bare pupil, for the two characters drawn without whites. */
function Pupil({
  size, reach, look, blinkDelay,
}: {
  size: number; reach: number; look: { x: number; y: number; ms: number }; blinkDelay: string;
}) {
  return (
    <span
      className="mascot-eye shrink-0 rounded-full bg-[#2D2D2D]"
      style={{
        width: size,
        height: size,
        animationDelay: blinkDelay,
        transform: `translate(${look.x * reach}px, ${look.y * reach}px)`,
        transition: `transform ${look.ms}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    />
  );
}

export function MascotWait({ label }: { label?: string }) {
  const look = useWanderingGaze();
  const sway = useSwayDurations();

  return (
    <div className="flex flex-col items-center gap-7">
      <style>{`
        .mascot-eye { animation: mascot-blink 5.4s ease-in-out infinite; }
        @keyframes mascot-blink {
          0%, 93%, 100% { transform: scaleY(1); }
          96%           { transform: scaleY(0.1); }
        }
        /* Each body leans on its own cycle, so the group breathes rather than
           tilting as one block. */
        @keyframes mascot-sway-a { 0%,100% { transform: skewX(-2.5deg); } 50% { transform: skewX(2deg); } }
        @keyframes mascot-sway-b { 0%,100% { transform: skewX(1.8deg); }  50% { transform: skewX(-2.2deg); } }
        @keyframes mascot-sway-c { 0%,100% { transform: skewX(-1.2deg); } 50% { transform: skewX(1.2deg); } }
        .mascot-body { transform-origin: bottom center; }
        @media (prefers-reduced-motion: reduce) {
          .mascot-wait *, .mascot-wait { animation: none !important; transition: none !important; }
        }
      `}</style>

      {/* The wait is the one moment the product has the screen to itself, so it
          leads with its name and the characters play under it. */}
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          ZET <span className="font-normal text-muted-foreground/40">—</span> Zero Effort Tasks
        </h1>
        <p className="text-base text-muted-foreground">Your work, organized.</p>
      </div>

      <div
        className="mascot-wait relative"
        style={{ width: STAGE_W * SCALE, height: STAGE_H * SCALE }}
        role="img"
        aria-label={label ?? 'Loading'}
      >
        <div
          className="absolute left-0 top-0"
          style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${SCALE})`, transformOrigin: 'top left' }}
        >
          {/* Purple — the tall one at the back. */}
          <div
            className="mascot-body absolute bottom-0"
            style={{
              left: 70, width: 180, height: 400,
              backgroundColor: '#6C3FF5', borderRadius: '10px 10px 0 0', zIndex: 1,
              animation: `mascot-sway-a ${sway[0]}s ease-in-out infinite`,
            }}
          >
            <div className="absolute flex gap-8" style={{ left: 45, top: 40 }}>
              <EyeBall size={18} pupilSize={7} reach={5} look={look} blinkDelay="0s" />
              <EyeBall size={18} pupilSize={7} reach={5} look={look} blinkDelay="0s" />
            </div>
          </div>

          {/* Dark — behind and to the right. */}
          <div
            className="mascot-body absolute bottom-0"
            style={{
              left: 240, width: 120, height: 310,
              backgroundColor: '#2D2D2D', borderRadius: '8px 8px 0 0', zIndex: 2,
              animation: `mascot-sway-b ${sway[1]}s ease-in-out infinite`,
            }}
          >
            <div className="absolute flex gap-6" style={{ left: 26, top: 32 }}>
              <EyeBall size={16} pupilSize={6} reach={4} look={look} blinkDelay="1.7s" />
              <EyeBall size={16} pupilSize={6} reach={4} look={look} blinkDelay="1.7s" />
            </div>
          </div>

          {/* Orange — the dome in front. */}
          <div
            className="mascot-body absolute bottom-0"
            style={{
              left: 0, width: 240, height: 200,
              backgroundColor: '#FF9B6B', borderRadius: '120px 120px 0 0', zIndex: 3,
              animation: `mascot-sway-c ${sway[2]}s ease-in-out infinite`,
            }}
          >
            <div className="absolute flex gap-8" style={{ left: 82, top: 90 }}>
              <Pupil size={12} reach={5} look={look} blinkDelay="3.1s" />
              <Pupil size={12} reach={5} look={look} blinkDelay="3.1s" />
            </div>
          </div>

          {/* Yellow — the one with an opinion about how long this is taking. */}
          <div
            className="mascot-body absolute bottom-0"
            style={{
              left: 310, width: 140, height: 230,
              backgroundColor: '#E8D754', borderRadius: '70px 70px 0 0', zIndex: 4,
              animation: `mascot-sway-a ${sway[3]}s ease-in-out infinite`,
            }}
          >
            <div className="absolute flex gap-6" style={{ left: 52, top: 40 }}>
              <Pupil size={12} reach={5} look={look} blinkDelay="4.3s" />
              <Pupil size={12} reach={5} look={look} blinkDelay="4.3s" />
            </div>
            <div
              className="absolute h-[4px] w-20 rounded-full bg-[#2D2D2D]"
              style={{ left: 40, top: 88 }}
            />
          </div>
        </div>
      </div>

      {label && <p className="text-xs text-muted-foreground/60">{label}</p>}
    </div>
  );
}

export default MascotWait;
