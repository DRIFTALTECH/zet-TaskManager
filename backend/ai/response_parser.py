"""
Extract user-facing text from LLM responses.

Strips provider reasoning blocks, chain-of-thought preambles, and prompt leakage
so callers only return the final answer.
"""

from __future__ import annotations

import re
from typing import Any, TypeVar

from pydantic import BaseModel

# Full thinking/reasoning blocks (content between tags).
_THINKING_BLOCK_RE = re.compile(
    r"<\s*(?:redacted_thinking|think|reasoning|internal)[^>]*>"
    r"[\s\S]*?"
    r"<\s*/\s*(?:redacted_thinking|think|reasoning|internal)\s*>",
    re.IGNORECASE,
)
_THINKING_TAG_RE = re.compile(
    r"<\s*/?\s*(?:redacted_thinking|think|reasoning|internal)[^>]*>",
    re.IGNORECASE,
)

# Line starts that indicate internal reasoning, not user-facing copy.
_REASONING_LINE_RE = re.compile(
    r"^\s*(?:"
    r"first,?\s+i\s+need"
    r"|let(?:'s| us)\s+think"
    r"|let\s+me\s+(?:think|structure|analyze|review|start|break)"
    r"|the\s+user\s+wants"
    r"|i\s+need\s+to"
    r"|okay,?\s+so"
    r"|to\s+answer(?:\s+this)?"
    r"|analyzing\b"
    r"|looking\s+at\s+the"
    r"|based\s+on\s+the\s+prompt"
    r"|the\s+prompt\s+(?:asks|says|wants)"
    r"|step\s+\d+"
    r"|chain[- ]of[- ]thought"
    r"|reasoning:"
    r"|internal\s+planning"
    r"|output\s+only"
    r"|json\s+fields"
    r"|strict\s+rules"
    r"|never\s+invent"
    r"|metrics\s+below"
    r"|write\s+your\s+answer"
    r"|use\s+these\s+labels\s+only"
    r"|recommendation\s+should"
    r"|avoid\s+using"
    r")\b",
    re.IGNORECASE,
)

# Transition phrases — keep text after the last occurrence.
_CONCLUSION_MARKERS = (
    "putting it all together",
    "in summary",
    "to summarize",
    "final answer:",
    "answer:",
)


def _strip_thinking_markup(text: str) -> str:
    cleaned = text or ""
    prev = ""
    while cleaned != prev:
        prev = cleaned
        cleaned = _THINKING_BLOCK_RE.sub("", cleaned)
        cleaned = _THINKING_TAG_RE.sub("", cleaned)
    return cleaned.strip()


def _text_after_conclusion_marker(text: str) -> str:
    lower = text.lower()
    last_idx = -1
    last_len = 0
    for marker in _CONCLUSION_MARKERS:
        idx = lower.rfind(marker)
        if idx > last_idx:
            last_idx = idx
            last_len = len(marker)
    if last_idx >= 0:
        tail = text[last_idx + last_len :].lstrip(" \t\n:,-—")
        if tail:
            return tail
    return text


def _drop_reasoning_lines(text: str) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    kept = [ln for ln in lines if not _REASONING_LINE_RE.match(ln)]
    if kept:
        return "\n".join(kept).strip()
    # Single blob with no newlines — drop if the whole thing is reasoning.
    single = text.strip()
    return "" if _REASONING_LINE_RE.match(single) else single


def extract_final_answer(text: str | None) -> str:
    """Return only the user-facing answer from raw LLM text."""
    if not text:
        return ""
    cleaned = _strip_thinking_markup(text)
    cleaned = _text_after_conclusion_marker(cleaned)
    cleaned = _drop_reasoning_lines(cleaned)
    return cleaned.strip()


def message_to_text(message: Any) -> str:
    """Normalize LangChain message / invoke result to plain text."""
    if message is None:
        return ""
    if isinstance(message, str):
        return message
    content = getattr(message, "content", message)
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
                elif "text" in block:
                    parts.append(str(block["text"]))
        return "".join(parts)
    return str(content or "")


T = TypeVar("T", bound=BaseModel)


def sanitize_model_strings(model: T) -> T:
    """Recursively strip reasoning from every string field in a Pydantic model."""
    data = model.model_dump()
    cleaned = _sanitize_value(data)
    return model.__class__.model_validate(cleaned)


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, str):
        return extract_final_answer(value)
    if isinstance(value, list):
        return [_sanitize_value(v) for v in value]
    if isinstance(value, dict):
        return {k: _sanitize_value(v) for k, v in value.items()}
    return value
