// Shared avatar component used across the whole app.
// If the user has uploaded a profile picture (stored as a base64 data-URL in `avatar`)
// it renders as an <img>. Otherwise it falls back to coloured initials.

const PALETTES = [
  'bg-blue-500/20 text-blue-600 dark:text-blue-400 ring-blue-500/25',
  'bg-violet-500/20 text-violet-600 dark:text-violet-400 ring-violet-500/25',
  'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 ring-emerald-500/25',
  'bg-orange-500/20 text-orange-600 dark:text-orange-400 ring-orange-500/25',
  'bg-pink-500/20 text-pink-600 dark:text-pink-400 ring-pink-500/25',
  'bg-teal-500/20 text-teal-600 dark:text-teal-400 ring-teal-500/25',
  'bg-amber-500/20 text-amber-600 dark:text-amber-400 ring-amber-500/25',
  'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 ring-cyan-500/25',
];

/** Hex accents aligned with PALETTES — for charts / color dots. */
const ACCENT_HEX = [
  '#60a5fa', '#a78bfa', '#34d399', '#fb923c',
  '#f472b6', '#2dd4bf', '#fbbf24', '#22d3ee',
];

function seedHash(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return h;
}

export function palette(name: string) {
  return PALETTES[seedHash(name) % PALETTES.length];
}

/** Stable accent color for a user (charts, dots). Prefer id when available. */
export function accentColor(seed: string) {
  return ACCENT_HEX[seedHash(seed) % ACCENT_HEX.length]!;
}

export function initials(name: string) {
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
}

const SIZE = {
  xs:  'w-6 h-6 text-[9px]',
  sm:  'w-8 h-8 text-[10px]',
  md:  'w-10 h-10 text-xs',
  lg:  'w-14 h-14 text-sm',
  xl:  'w-20 h-20 text-lg',
  '2xl': 'w-28 h-28 text-2xl',
};

interface Props {
  name: string;
  avatar?: string;
  size?: keyof typeof SIZE;
  className?: string;
}

export default function UserAvatar({ name, avatar, size = 'md', className = '' }: Props) {
  const isImg = !!avatar && (avatar.startsWith('data:') || avatar.startsWith('http'));
  const base = `${SIZE[size]} rounded-full shrink-0 flex items-center justify-center font-bold overflow-hidden ring-1 ${className}`;

  if (isImg) {
    return <img src={avatar} alt={name} className={`${base} ring-border/40 object-cover`} />;
  }
  return (
    <div className={`${base} ${palette(name)}`}>
      {initials(name)}
    </div>
  );
}
