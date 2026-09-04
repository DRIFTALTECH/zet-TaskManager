import type { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * Names an icon-only control on hover, immediately.
 *
 * The native `title` attribute took about a second to appear and is painted by
 * the browser, which is no use on a row of unlabelled glyphs — by the time it
 * showed, you had already guessed and clicked. Wrap the control instead; the
 * app's tooltip opens with no delay and matches the rest of the UI.
 */
export function Hint({
  label,
  side = 'top',
  children,
}: {
  label: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactNode;
}) {
  if (!label) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side} className="px-2 py-1 text-xs font-medium">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

export default Hint;
