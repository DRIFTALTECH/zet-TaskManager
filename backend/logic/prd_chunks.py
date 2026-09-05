"""Cut a long document into pieces the model can finish answering about.

The model's reply is capped. Feeding it a whole BRD asks for one answer listing
every story in the document, and past a certain length that answer cannot fit —
it is cut off mid-story and the tail is lost. Salvage rescues what completed,
but the stories past the cut were never written at all.

Splitting the input is what removes the cliff: each piece is small enough that
its answer finishes, and the pieces are joined afterwards. A document that fits
comfortably is left alone, so the common case still costs exactly one call.
"""

from __future__ import annotations

import re

# Roughly 5k tokens of input per piece. The reply lists a story per requirement
# found, so this is set by how many stories a piece can produce and still finish
# inside the output cap, not by the input limit — which is far higher.
MAX_CHUNK_CHARS = 20_000

# A markdown heading, or a numbered/lettered section opener. Splitting here
# keeps a requirement with the heading it belongs to instead of orphaning it.
_HEADING_RE = re.compile(r"^(#{1,6}\s|\d+(\.\d+)*\.?\s+\S|[A-Z][A-Z \-]{3,}$)")


def _blocks(text: str) -> list[str]:
    """Paragraphs, with a heading kept attached to what follows it."""
    paras = [p for p in re.split(r"\n\s*\n", text) if p.strip()]
    out: list[str] = []
    for p in paras:
        first = p.strip().splitlines()[0] if p.strip() else ""
        # A heading alone is not a unit of meaning; join it to the next block.
        if out and _HEADING_RE.match(out[-1].strip().splitlines()[-1] or ""):
            out[-1] = f"{out[-1]}\n\n{p}"
        elif _HEADING_RE.match(first) and len(p.strip().splitlines()) == 1:
            out.append(p)
        else:
            out.append(p)
    return out


def _hard_split(block: str, max_chars: int) -> list[str]:
    """A single block bigger than a whole piece — cut it on line boundaries."""
    pieces: list[str] = []
    current = ""
    for line in block.splitlines(keepends=True):
        if current and len(current) + len(line) > max_chars:
            pieces.append(current)
            current = ""
        # A single line longer than the limit is cut where it falls; nothing
        # smarter is available and dropping it would lose requirements.
        while len(line) > max_chars:
            pieces.append(line[:max_chars])
            line = line[max_chars:]
        current += line
    if current:
        pieces.append(current)
    return pieces


def split_for_outline(text: str, *, max_chars: int = MAX_CHUNK_CHARS) -> list[str]:
    """Split a document into pieces of at most `max_chars`, on real boundaries.

    Returns a single piece for anything that already fits, so a short PRD is
    unaffected — same one call, same cost, same result.
    """
    text = (text or "").strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]

    chunks: list[str] = []
    current = ""
    for block in _blocks(text):
        if len(block) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(_hard_split(block, max_chars))
            continue
        candidate = f"{current}\n\n{block}" if current else block
        if len(candidate) > max_chars:
            chunks.append(current)
            current = block
        else:
            current = candidate
    if current:
        chunks.append(current)
    return [c.strip() for c in chunks if c.strip()]


def dedupe_by_title(stories: list, *, key=lambda s: s.title) -> list:
    """Drop repeats produced by the same requirement appearing in two pieces.

    Split points are chosen on structure, not meaning, so a requirement restated
    either side of one can be outlined twice. Compared loosely — case, spacing
    and trailing punctuation differ between two answers describing one thing.
    """
    seen: set[str] = set()
    out = []
    for s in stories:
        norm = re.sub(r"[^a-z0-9]+", " ", (key(s) or "").lower()).strip()
        if not norm or norm in seen:
            continue
        seen.add(norm)
        out.append(s)
    return out
