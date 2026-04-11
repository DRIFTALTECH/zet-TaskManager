import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface ZetLogoProps {
  variant?: 'default' | 'onPrimary';
  iconOnly?: boolean;
  className?: string;
}

function ZMark({ onPrimary, className }: { onPrimary: boolean; className?: string }) {
  const id = useId().replace(/:/g, '');
  const gradId = `zet-grad-${id}`;

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('size-8 shrink-0', className)}
      aria-hidden
    >
      <path
        d="M7 9h18M7 23h18M23.5 9L8.5 23"
        stroke={`url(#${gradId})`}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <defs>
        <linearGradient id={gradId} x1="7" y1="9" x2="25" y2="23" gradientUnits="userSpaceOnUse">
          {onPrimary ? (
            <>
              <stop stopColor="#e0e7ff" />
              <stop offset="1" stopColor="#a5b4fc" />
            </>
          ) : (
            <>
              <stop stopColor="#6366f1" />
              <stop offset="1" stopColor="#7c3aed" />
            </>
          )}
        </linearGradient>
      </defs>
    </svg>
  );
}

export function ZetLogo({ variant = 'default', iconOnly = false, className }: ZetLogoProps) {
  const onPrimary = variant === 'onPrimary';

  return (
    <div
      className={cn(
        'flex items-center gap-2 min-w-0',
        onPrimary ? 'text-white' : 'text-foreground',
        className,
      )}
    >
      <ZMark onPrimary={onPrimary} />
      {!iconOnly && <span className="font-extrabold text-lg tracking-tight truncate">ZET</span>}
    </div>
  );
}
