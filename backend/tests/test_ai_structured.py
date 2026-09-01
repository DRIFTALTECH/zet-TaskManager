"""parse_structured: payload → schema. Never depends on response_format."""

from pydantic import BaseModel, Field

from ai.schemas import PrdExtractResponse
from ai.service import _with_json_instruction, parse_structured
from ai.structured import extract_json_value
from langchain_core.prompts import ChatPromptTemplate


class _Ping(BaseModel):
    ok: bool


class _Stories(BaseModel):
    stories: list[str] = Field(default_factory=list)


def test_extract_json_from_fence_and_reasoning():
    raw = (
        "<think>I should output json</think>\n"
        "Here you go:\n"
        '```json\n{"ok": true}\n```\n'
    )
    assert extract_json_value(raw) == {"ok": True}


def test_parse_structured_from_text_dict_and_model():
    assert parse_structured('{"ok": true}', _Ping).ok is True
    assert parse_structured({"ok": True}, _Ping).ok is True
    assert parse_structured(_Ping(ok=True), _Ping).ok is True


def test_parse_structured_wraps_bare_list():
    out = parse_structured(["Login", "Alerts"], _Stories)
    assert out.stories == ["Login", "Alerts"]


def test_parse_structured_prd_payload_with_list_criteria():
    payload = {
        "stories": [
            {
                "title": "Overdue alerts",
                "acceptance_criteria": ["Count is returned", "Digest is emailed"],
                "tasks": [{"title": "API"}],
            }
        ]
    }
    out = parse_structured(payload, PrdExtractResponse)
    assert out.stories[0].title == "Overdue alerts"
    assert out.stories[0].acceptance_criteria == "Count is returned\nDigest is emailed"
    assert out.stories[0].tasks[0].title == "API"


def test_parse_structured_prd_from_fenced_model_text():
    text = """
```json
{"stories":[{"title":"Login","tasks":[{"title":"Auth API"}]}]}
```
"""
    out = parse_structured(text, PrdExtractResponse)
    assert out.stories[0].title == "Login"
    assert out.stories[0].tasks[0].title == "Auth API"


def test_json_instruction_escapes_schema_braces():
    prompt = ChatPromptTemplate.from_messages([("human", "Doc:\n{text}")])
    guided = _with_json_instruction(prompt, _Ping)
    msgs = guided.format_messages(text="hello")
    assert "hello" in msgs[0].content
    assert '"ok"' in msgs[-1].content
