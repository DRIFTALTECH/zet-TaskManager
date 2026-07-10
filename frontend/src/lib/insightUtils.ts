import type { InsightsResponse } from '@/lib/analyticsApi';

export const AI_INSIGHT_UNAVAILABLE_MSG = 'AI insight unavailable. Click Retry.';

export const AI_INSIGHTS_TITLE = 'AI Insights';

export interface StructuredInsightFields {
  decision?: string;
  why?: string;
  evidence?: string[];
  recommendation?: string;
}

const AI_LEAK_MARKERS = [
  'recommendation should',
  'avoid using',
  'let me structure',
  'let me think',
  'let me ',
  'redacted_thinking',
  'strict rules',
  'write your answer',
  'use these labels only',
  'metrics below',
  'never invent',
  'chain-of-thought',
  'chain of thought',
  'prompt instruction',
  'prompt instructions',
  'internal planning',
  'reasoning:',
  'no reasoning',
  'output only',
  'json fields',
];

const THINKING_BLOCK_RE =
  /<\s*(?:redacted_thinking|think|reasoning|internal)[^>]*>[\s\S]*?<\s*\/\s*(?:redacted_thinking|think|reasoning|internal)\s*>/gi;
const THINKING_TAG_RE = /<\/?\s*(?:redacted_thinking|think|reasoning|internal)[^>]*>/gi;

function stripThinkingMarkup(text: string): string {
  let prev = '';
  let s = text;
  while (s !== prev) {
    prev = s;
    s = s.replace(THINKING_BLOCK_RE, '').replace(THINKING_TAG_RE, '');
  }
  return s;
}

function lineLooksLikeLeak(line: string): boolean {
  const lower = stripThinkingMarkup(line).trim().toLowerCase();
  if (!lower) return true;
  return AI_LEAK_MARKERS.some((m) => lower.includes(m));
}

/** Strip leaked prompt, reasoning, and chain-of-thought from any AI-generated text. */
export function sanitizeAiText(text: string | undefined | null): string {
  if (!text) return '';
  const withoutTags = stripThinkingMarkup(text);
  const lines = withoutTags
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !lineLooksLikeLeak(l));
  if (lines.length > 0) return lines.join(' ').trim();
  const single = withoutTags.trim();
  return lineLooksLikeLeak(single) ? '' : single;
}

/** @deprecated alias — use sanitizeAiText */
export const sanitizeInsightText = sanitizeAiText;

export function sanitizeStructuredInsight(insight: StructuredInsightFields): StructuredInsightFields {
  return {
    decision: sanitizeAiText(insight.decision),
    why: sanitizeAiText(insight.why),
    recommendation: sanitizeAiText(insight.recommendation),
    evidence: (insight.evidence ?? []).map((e) => sanitizeAiText(e)).filter((e) => e.length > 0),
  };
}

/** Sanitize all structured insight fields from the backend. */
export function sanitizeInsightResponse(data: InsightsResponse): InsightsResponse {
  const clean = sanitizeStructuredInsight(data);
  return { ...data, ...clean };
}

export function isInsightUnavailable(data: InsightsResponse): boolean {
  if (data.available === false || data.fallbackUsed) return true;
  return !data.decision?.trim();
}

/** Stable cache key for insight context objects. */
export function insightContextKey(context: Record<string, unknown>): string {
  const sortValue = (value: unknown): unknown => {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortValue);
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue(obj[key]);
        return acc;
      }, {});
  };
  return JSON.stringify(sortValue(context));
}

/** Flatten org tree nodes for LLM context (max depth preserved in nested children). */
export function orgNodeToInsightContext(
  node: import('@/lib/analyticsApi').OrgNode,
): Record<string, unknown> {
  return {
    name: node.name,
    role: node.orgRole,
    jobTitle: node.jobTitle,
    managerName: node.managerName,
    teamSize: node.metrics.teamSize,
    loggedHours: node.metrics.assignedHours,
    activeTasks: node.metrics.activeTasks,
    activeProjects: node.metrics.activeProjects,
    directReports: node.children.map(orgNodeToInsightContext),
  };
}
