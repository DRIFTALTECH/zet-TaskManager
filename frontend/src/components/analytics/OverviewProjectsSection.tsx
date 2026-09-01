/**
 * Projects breakdown table for Task / User / Sprint overview.
 */

import { FolderOpen } from 'lucide-react';
import { AnalyticsSection } from '@/components/analytics/analyticsUi';

export type OverviewProjectRow = {
  projectId: string;
  projectName: string;
  taskCount: number;
  hours: number;
};

export function OverviewProjectsSection({
  projects,
  title = 'All projects',
}: {
  projects: OverviewProjectRow[];
  title?: string;
}) {
  if (projects.length === 0) return null;

  return (
    <AnalyticsSection title={title} icon={FolderOpen} iconClassName="text-muted-foreground" tone="muted">
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[28rem]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
              <th className="text-left font-semibold py-2 pr-3">Project</th>
              <th className="text-right font-semibold py-2 px-3 tabular-nums">Tasks</th>
              <th className="text-right font-semibold py-2 pl-3 tabular-nums">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/15">
            {projects.map(p => (
              <tr key={p.projectId} className="hover:bg-muted/20">
                <td className="py-2.5 pr-3 font-medium">{p.projectName}</td>
                <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{p.taskCount}</td>
                <td className="py-2.5 pl-3 text-right tabular-nums text-muted-foreground">{p.hours}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AnalyticsSection>
  );
}
