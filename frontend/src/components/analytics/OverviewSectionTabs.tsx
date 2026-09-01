/**
 * Overview section tabs — Project / Task / User / Sprint.
 */

import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

export type OverviewTab = 'project' | 'task' | 'user' | 'sprint';

export function OverviewSectionTabs({ active }: { active: OverviewTab }) {
  const items = [
    { id: 'project' as const, label: 'Project Overview', to: '/overview' },
    { id: 'task' as const, label: 'Task Overview', to: '/overview?tab=task' },
    { id: 'user' as const, label: 'User Overview', to: '/overview?tab=user' },
    { id: 'sprint' as const, label: 'Sprint Overview', to: '/overview?tab=sprint' },
  ];
  return (
    <div className="inline-flex h-9 shrink-0 rounded-lg border border-border/70 bg-card/70 p-0.5">
      {items.map(item => (
        <Link
          key={item.id}
          to={item.to}
          className={cn(
            'inline-flex items-center rounded-md px-3 text-xs font-medium transition-colors',
            active === item.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
