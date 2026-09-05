import type { LucideIcon } from 'lucide-react';

import { PAGE_SUBTITLE, PAGE_TITLE } from '@/lib/page-styles';
import { cn } from '@/lib/utils';

/**
 * The one page header.
 *
 * Ten pages had each written the same block by hand — an uppercase eyebrow, a
 * `text-3xl` gradient-clipped title, a muted description, and an actions row,
 * all inside a tinted band with a bottom border. It ate about 140px before any
 * content and made every screen announce itself louder than the work on it.
 *
 * This is that block at the dashboard's density: icon and title on one line at
 * `text-lg`, the old eyebrow folded into the title as breadcrumb context, and
 * actions on the same row so a page opens with content near the top. Passing
 * `subtitle` is optional and usually unnecessary — a table that says what it
 * holds does not need a sentence above it saying the same.
 */
export interface PageHeaderProps {
  /** Small leading icon. Rendered at 14px to match segmented-control icons. */
  icon?: LucideIcon;
  /** Quiet prefix shown before the title, e.g. "Team". */
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Controls that act on the whole page — tabs, filters, export, create. */
  actions?: React.ReactNode;
  /** A second row under the title, e.g. a tab bar or a filter strip. */
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  actions,
  children,
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('mb-3 shrink-0 flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-primary/60" />}
          <div className="min-w-0">
            <h1 className={PAGE_TITLE}>
              {eyebrow && (
                <span className="font-medium text-muted-foreground">{eyebrow} / </span>
              )}
              {title}
            </h1>
            {subtitle && <p className={cn(PAGE_SUBTITLE, 'mt-0.5 truncate')}>{subtitle}</p>}
          </div>
        </div>
        {actions && (
          <div className="flex flex-wrap items-center gap-2 min-w-0">{actions}</div>
        )}
      </div>
      {children}
    </div>
  );
}

export default PageHeader;
