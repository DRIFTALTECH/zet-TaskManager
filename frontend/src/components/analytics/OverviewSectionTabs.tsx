/**
 * Overview section tabs — Project / Task / User / Sprint.
 */

import { Link } from 'react-router-dom';
import { SEGMENT_BAR, SEGMENT_BTN } from '@/lib/page-styles';

export type OverviewTab = 'project' | 'task' | 'user' | 'sprint';

export function OverviewSectionTabs({ active }: { active: OverviewTab }) {
  const items = [
    { id: 'project' as const, label: 'Project Overview', to: '/overview' },
    { id: 'task' as const, label: 'Task Overview', to: '/overview?tab=task' },
    { id: 'user' as const, label: 'User Overview', to: '/overview?tab=user' },
    { id: 'sprint' as const, label: 'Sprint Overview', to: '/overview?tab=sprint' },
  ];
  return (
    <div className={SEGMENT_BAR}>
      {items.map(item => (
        <Link
          key={item.id}
          to={item.to}
          className={SEGMENT_BTN(active === item.id)}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
