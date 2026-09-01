import type { PrdDraft } from '@/types';

export type PrdPicks = {
  stories: Record<string, boolean>;
  tasks: Record<string, boolean | undefined>;
};

const picksKey = (importId: string) => `zet-prd-picks:${importId}`;

export function loadPrdPicks(importId: string | null | undefined): PrdPicks {
  if (!importId) return { stories: {}, tasks: {} };
  try {
    const raw = localStorage.getItem(picksKey(importId));
    if (!raw) return { stories: {}, tasks: {} };
    const v = JSON.parse(raw) as PrdPicks;
    return { stories: v.stories ?? {}, tasks: v.tasks ?? {} };
  } catch {
    return { stories: {}, tasks: {} };
  }
}

export function savePrdPicks(importId: string | null | undefined, picks: PrdPicks) {
  if (!importId) return;
  localStorage.setItem(picksKey(importId), JSON.stringify(picks));
}

export function clearPrdPicks(importId: string | null | undefined) {
  if (!importId) return;
  localStorage.removeItem(picksKey(importId));
}

const PRD_FILE_RE = /\.(pdf|docx|txt|md|csv)$/i;
export const PRD_FILE_ACCEPT = '.pdf,.docx,.txt,.md,.csv';
export const PRD_FILE_CAP = 8;

export function mergePrdFiles(prev: File[], incoming: FileList | File[] | null | undefined): File[] {
  const next = [...prev];
  for (const f of Array.from(incoming ?? [])) {
    if (!PRD_FILE_RE.test(f.name)) continue;
    if (next.some(x => x.name === f.name && x.size === f.size)) continue;
    if (next.length >= PRD_FILE_CAP) break;
    next.push(f);
  }
  return next;
}

/** Survives leaving /prd so Analyze keeps running and the UI can reattach. */
export const prdRun = {
  analyzing: false,
  percent: 0,
  label: '',
  counts: { done: 0, total: 0 },
  ac: null as AbortController | null,
  draft: null as PrdDraft | null,
};

export function resetPrdRun() {
  prdRun.analyzing = false;
  prdRun.percent = 0;
  prdRun.label = '';
  prdRun.counts = { done: 0, total: 0 };
  prdRun.ac = null;
}
