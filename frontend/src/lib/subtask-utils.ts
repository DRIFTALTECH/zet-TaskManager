/** Shared helpers for draft subtask rows in create/edit forms. */

export type SubtaskDraftRow = { id: string; title: string };

export function newSubtaskDraftRow(): SubtaskDraftRow {
  return { id: crypto.randomUUID(), title: '' };
}

/** Trim, drop blanks, and reject duplicate names (case-insensitive). */
export function collectSubtaskTitles(rows: SubtaskDraftRow[]): { ok: true; titles: string[] } | { ok: false; error: string } {
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const row of rows) {
    const t = row.title.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: 'Each subtask must have a unique name.' };
    }
    seen.add(key);
    titles.push(t);
  }
  return { ok: true, titles };
}
