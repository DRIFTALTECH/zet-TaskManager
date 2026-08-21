/**
 * OrgTree.tsx — Organization hierarchy visualizer for ZET.
 * Click a person to select them for AI insights.
 */

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, Users, Clock, Briefcase, TrendingUp, Sparkles } from 'lucide-react';
import type { OrgNode } from '@/lib/analyticsApi';
import { cn } from '@/lib/utils';

interface OrgNodeCardProps {
  node: OrgNode;
  depth?: number;
  selectedId?: string | null;
  onSelect?: (node: OrgNode) => void;
}

function OrgNodeCard({ node, depth = 0, selectedId, onSelect }: OrgNodeCardProps) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const selected = selectedId === node.id;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.15 }}
        className={cn(
          'group flex items-start gap-3 rounded-2xl border bg-card p-4 hover:border-border/60 hover:shadow-sm transition-all',
          selected ? 'border-violet-500/40 ring-1 ring-violet-500/20' : 'border-border/30',
        )}
        style={{ marginLeft: depth * 24 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && setExpanded(!expanded)}
          className="mt-0.5 h-5 w-5 shrink-0 rounded-md flex items-center justify-center text-muted-foreground/40 hover:bg-muted/40"
          aria-label={hasChildren ? (expanded ? 'Collapse' : 'Expand') : undefined}
        >
          {hasChildren
            ? expanded
              ? <ChevronDown className="h-3.5 w-3.5" />
              : <ChevronRight className="h-3.5 w-3.5" />
            : <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20" />
          }
        </button>

        <button
          type="button"
          onClick={() => onSelect?.(node)}
          className="flex flex-1 items-start gap-3 min-w-0 text-left"
        >
          <div className="h-9 w-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <span className="text-sm font-bold text-primary/70">
              {node.name.charAt(0).toUpperCase()}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-sm text-foreground group-hover:text-violet-600 dark:text-violet-400 transition-colors">
                {node.name}
              </span>
              {onSelect && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-violet-400/60 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Sparkles className="h-3 w-3" /> Insights
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground/50 mt-0.5 truncate">
              {node.jobTitle || node.orgRole.toLowerCase()}
              {node.managerName && ` · Reports to ${node.managerName}`}
            </p>
          </div>

          <div className="hidden sm:flex items-center gap-4 text-xs text-muted-foreground/50 shrink-0">
            {node.children.length > 0 && (
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />{node.metrics.teamSize}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />{node.metrics.assignedHours.toFixed(1)}h
            </span>
            <span className="flex items-center gap-1">
              <Briefcase className="h-3 w-3" />{node.metrics.activeProjects}
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />{node.metrics.activeTasks}
            </span>
          </div>
        </button>
      </motion.div>

      <AnimatePresence>
        {expanded && hasChildren && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 space-y-2 overflow-hidden"
          >
            {node.children.map((child) => (
              <OrgNodeCard
                key={child.id}
                node={child}
                depth={depth + 1}
                selectedId={selectedId}
                onSelect={onSelect}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface OrgTreeProps {
  nodes: OrgNode[];
  loading?: boolean;
  selectedId?: string | null;
  onSelectNode?: (node: OrgNode) => void;
}

export function OrgTree({ nodes, loading, selectedId, onSelectNode }: OrgTreeProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-2xl border border-border/20 bg-card animate-pulse"
            style={{ marginLeft: i === 0 ? 0 : (i % 2) * 24 }}
          />
        ))}
      </div>
    );
  }

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Users className="h-10 w-10 text-muted-foreground/20 mb-3" />
        <p className="text-sm text-muted-foreground/50">No organization data found for this period.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {onSelectNode && (
        <p className="text-xs text-muted-foreground/60 mb-1">
          Click a name for AI insights about that person and their team.
        </p>
      )}
      {nodes.map((node) => (
        <OrgNodeCard
          key={node.id}
          node={node}
          selectedId={selectedId}
          onSelect={onSelectNode}
        />
      ))}
    </div>
  );
}
