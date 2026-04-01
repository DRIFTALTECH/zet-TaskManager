import { cn } from '@/lib/utils';

const Mark = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 32 32"
    fill="none"
    className={cn('shrink-0', className)}
    aria-hidden
  >
    <rect width="32" height="32" rx="8" className="fill-primary" />
    <path
      d="M8 16.5l4 4 8-10"
      stroke="hsl(var(--primary-foreground))"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M22 22H14"
      stroke="hsl(var(--primary-foreground))"
      strokeWidth="2"
      strokeLinecap="round"
      opacity={0.85}
    />
  </svg>
);

export type TaskFlowLogoProps = {
  /** Use on primary / gradient backgrounds (light mark + wordmark). */
  variant?: 'default' | 'onPrimary';
  /** Icon only (sidebar collapsed, small slots). */
  iconOnly?: boolean;
  className?: string;
  wordmarkClassName?: string;
};

export function TaskFlowLogo({
  variant = 'default',
  iconOnly = false,
  className,
  wordmarkClassName,
}: TaskFlowLogoProps) {
  const onPrimary = variant === 'onPrimary';

  return (
    <div className={cn('flex items-center gap-2', className)}>
      {onPrimary ? (
        <div className="size-8 rounded-lg bg-primary-foreground/15 backdrop-blur-sm flex items-center justify-center ring-1 ring-primary-foreground/10">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 32 32"
            fill="none"
            className="size-[22px] shrink-0"
            aria-hidden
          >
            <rect width="32" height="32" rx="8" className="fill-primary-foreground/20" />
            <path
              d="M8 16.5l4 4 8-10"
              stroke="currentColor"
              className="text-primary-foreground"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M22 22H14"
              stroke="currentColor"
              className="text-primary-foreground"
              strokeWidth="2"
              strokeLinecap="round"
              opacity={0.9}
            />
          </svg>
        </div>
      ) : (
        <Mark className="size-8" />
      )}
      {!iconOnly && (
        <span
          className={cn(
            'font-bold text-lg tracking-tight',
            onPrimary ? 'text-primary-foreground' : 'text-foreground',
            wordmarkClassName,
          )}
        >
          TaskFlow
        </span>
      )}
    </div>
  );
}

/** Static paths for emails, PDFs, or `<img src={...} />`. */
export const TASKFLOW_BRAND = {
  icon: '/brand/taskflow-icon.svg',
  logo: '/brand/taskflow-logo.svg',
} as const;
