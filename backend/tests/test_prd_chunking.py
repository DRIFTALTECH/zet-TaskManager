"""A long BRD is read a piece at a time, so no answer gets cut off.

The model's reply is capped. Asking it to list every story in a whole document
produces an answer that cannot finish, and the stories past the cut are never
written at all — salvage cannot rescue what was never said. Splitting the input
removes the cliff.
"""
import pytest

from logic.prd_chunks import MAX_CHUNK_CHARS, dedupe_by_title, split_for_outline


class Story:
    def __init__(self, title):
        self.title = title


def _doc(sections: int, per_section: int = 120) -> str:
    return "\n\n".join(
        f"## Section {i}\n\n" + ("Requirement text for this section. " * per_section)
        for i in range(1, sections + 1)
    )


def test_a_short_document_is_left_alone():
    """The common case must not gain a cost it did not have."""
    assert split_for_outline("One short requirement.") == ["One short requirement."]


def test_an_empty_document_yields_nothing():
    assert split_for_outline("") == []
    assert split_for_outline("   \n  ") == []


def test_a_long_document_is_split():
    pieces = split_for_outline(_doc(20))
    assert len(pieces) > 1


def test_every_piece_fits_under_the_cap():
    for piece in split_for_outline(_doc(30)):
        assert len(piece) <= MAX_CHUNK_CHARS


def test_pieces_start_on_a_section_boundary_not_mid_sentence():
    pieces = split_for_outline(_doc(20))
    assert all(p.lstrip().startswith("## Section") for p in pieces)


def test_no_requirement_is_dropped_between_pieces():
    doc = _doc(20)
    joined = "".join(split_for_outline(doc))
    for i in range(1, 21):
        assert f"## Section {i}" in joined, f"section {i} was lost"


def test_one_paragraph_larger_than_a_whole_piece_is_still_split():
    """A wall of text with no blank lines must not defeat the splitter."""
    giant = "x" * (MAX_CHUNK_CHARS * 3)
    pieces = split_for_outline(giant)
    assert len(pieces) >= 3
    assert all(len(p) <= MAX_CHUNK_CHARS for p in pieces)
    assert sum(len(p) for p in pieces) == len(giant)


def test_the_same_story_found_in_two_pieces_appears_once():
    merged = dedupe_by_title([
        Story("Sync confirmed issues"),
        Story("sync  Confirmed   Issues."),   # same thing, worded loosely
        Story("Client portal"),
    ])
    assert [s.title for s in merged] == ["Sync confirmed issues", "Client portal"]


def test_dedupe_drops_untitled_stories():
    merged = dedupe_by_title([Story(""), Story(None), Story("Real")])
    assert [s.title for s in merged] == ["Real"]


# ── The whole path, with the model stubbed ──────────────────────────────────

def test_a_long_brd_asks_the_model_once_per_piece_and_merges(client, manager, monkeypatch):
    """The point of splitting: every piece gets its own answer, all of them kept.

    Before this, one call carried the whole document and its answer was cut off
    at the output cap — the stories past the cut were never generated at all.
    """
    from ai import chains
    from ai.schemas import PrdOutlineResponse, PrdOutlineStory
    from logic import prd_import_logic

    user, headers = manager
    seen: list[str] = []

    def fake_outline(text, projects=None):
        seen.append(text)
        n = len(seen)
        return PrdOutlineResponse(stories=[
            PrdOutlineStory(
                title=f"Story from piece {n}",
                description="d",
                acceptance_criteria="a",
                priority="Medium",
            )
        ])

    monkeypatch.setattr(chains, "outline_prd", fake_outline)

    events = list(prd_import_logic.analyze_stream(
        _db_for(client), user["id"], text=_doc(20),
    ))

    assert len(seen) > 1, "the document was still sent as one call"
    assert all(len(piece) <= MAX_CHUNK_CHARS for piece in seen)
    titles = _staged_titles(events)
    assert len(titles) == len(seen), f"expected one story per piece, got {titles}"


def test_one_failing_piece_does_not_lose_the_others(client, manager, monkeypatch):
    """A blip on piece two should cost piece two, not the whole import."""
    from ai import chains
    from ai.schemas import PrdOutlineResponse, PrdOutlineStory
    from logic import prd_import_logic

    user, headers = manager
    calls = {"n": 0}

    def flaky_outline(text, projects=None):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("transient model failure")
        return PrdOutlineResponse(stories=[
            PrdOutlineStory(
                title=f"Story {calls['n']}", description="d",
                acceptance_criteria="a", priority="Medium",
            )
        ])

    monkeypatch.setattr(chains, "outline_prd", flaky_outline)

    events = list(prd_import_logic.analyze_stream(
        _db_for(client), user["id"], text=_doc(20),
    ))
    titles = _staged_titles(events)
    assert calls["n"] > 2, "gave up instead of carrying on to the later pieces"
    assert titles, "one bad piece threw the whole import away"
    assert "Story 2" not in titles


def _db_for(_client):
    from database.database import SessionLocal
    return SessionLocal()


def _staged_titles(events) -> list[str]:
    for ev in reversed(events):
        draft = ev.get("draft") if isinstance(ev, dict) else None
        if draft:
            return [s["title"] for s in draft.get("stories", [])]
    return []
