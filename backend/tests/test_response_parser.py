"""Tests for global LLM response parsing."""

from ai.response_parser import extract_final_answer, message_to_text, sanitize_model_strings
from pydantic import BaseModel


def test_strip_redacted_thinking_block():
    raw = (
        "<think>First, I need to analyze the metrics.</think>"
        "The team has overdue work."
    )
    assert extract_final_answer(raw) == "The team has overdue work."


def test_strip_reasoning_preamble_lines():
    raw = (
        "First, I need to check the metrics.\n"
        "Let's think about what matters.\n"
        "The team has overdue work that needs attention."
    )
    assert extract_final_answer(raw) == "The team has overdue work that needs attention."


def test_conclusion_marker_keeps_tail():
    raw = (
        "The user wants a summary.\n"
        "Putting it all together, finish overdue tasks first."
    )
    assert extract_final_answer(raw) == "finish overdue tasks first."


def test_message_to_text_from_string():
    assert message_to_text("hello") == "hello"


class _Sample(BaseModel):
    title: str
    items: list[str]


def test_sanitize_model_strings():
    model = _Sample(
        title="<think>plan</think>Ship feature",
        items=["First, I need to list tasks", "Two overdue tasks"],
    )
    cleaned = sanitize_model_strings(model)
    assert cleaned.title == "Ship feature"
    assert cleaned.items[1] == "Two overdue tasks"
    assert cleaned.items[0] == ""
