"""A cut-off answer keeps the stories that finished.

The model's output is capped. On a long BRD it is stopped mid-token, and what
comes back is valid JSON with the end missing. Every story it had already
written is intact in there; refusing to parse threw all of them away with the
half-written one and showed the reader "AI story extraction failed".
"""
import pytest

from ai.schemas import PrdExtractResponse
from ai.structured import parse_structured


def titles(payload: str) -> list[str]:
    return [s.title for s in parse_structured(payload, PrdExtractResponse).stories]


def test_an_answer_cut_off_mid_string_keeps_the_finished_stories():
    cut = '{"stories": [{"title": "A", "description": "d"}, {"title": "B", "descrip'
    assert titles(cut) == ["A"]


def test_an_answer_cut_off_right_after_a_comma_keeps_them_all():
    cut = '{"stories": [{"title": "A"}, {"title": "B"}, '
    assert titles(cut) == ["A", "B"]


def test_an_answer_cut_off_mid_number_keeps_the_finished_stories():
    cut = '{"stories": [{"title": "A"}, {"title": "B", "story_points": 3'
    assert titles(cut) == ["A"]


def test_a_quote_inside_a_title_is_not_mistaken_for_the_end_of_one():
    cut = '{"stories": [{"title": "A \\"quoted\\" thing"}, {"title": "B'
    assert titles(cut) == ['A "quoted" thing']


def test_deep_nesting_closes_every_level_that_was_left_open():
    cut = '{"stories": [{"title": "A", "tasks": [{"title": "t1"}, {"title": "t2"'
    assert titles(cut) == ["A"]


def test_a_complete_answer_is_untouched():
    whole = ('{"stories": [{"title": "A", "description": "d", '
             '"acceptance_criteria": "x", "priority": "High"}]}')
    assert titles(whole) == ["A"]


def test_json_after_a_preamble_still_reads():
    assert titles('Here you go:\n{"stories": [{"title": "A"}]}') == ["A"]


@pytest.mark.parametrize("payload", [
    '{"stories": [{"title": "A',        # stopped before one story finished
    "I could not read that document.",  # prose, no JSON at all
    "",
])
def test_a_genuinely_unusable_answer_still_fails(payload):
    """Salvage must not invent a result out of nothing."""
    with pytest.raises(ValueError):
        parse_structured(payload, PrdExtractResponse)
