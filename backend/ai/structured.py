"""Turn an LLM payload into a validated Pydantic model.

DeepSeek Chat Completions rejects response_format=json_schema (and often
json_object on V4 Flash) with HTTP 400 "This response_format type is
unavailable now". Call the model as plain text, then parse here.
"""

from __future__ import annotations

import json
import re
from typing import Any, Type, TypeVar

from pydantic import BaseModel

from ai.response_parser import extract_final_answer

T = TypeVar("T", bound=BaseModel)

_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```", re.IGNORECASE)


def extract_json_value(text: str) -> Any:
    """Pull the first JSON object/array out of model text (fences, reasoning, chatter)."""
    src = extract_final_answer(text) or text or ""
    blobs: list[str] = []
    fence = _FENCE_RE.search(src)
    if fence:
        blobs.append(fence.group(1).strip())
    blobs.append(src.strip())

    seen: set[str] = set()
    for blob in blobs:
        if not blob or blob in seen:
            continue
        seen.add(blob)
        for opener, closer in (("{", "}"), ("[", "]")):
            start = blob.find(opener)
            end = blob.rfind(closer)
            if start == -1 or end <= start:
                continue
            candidate = blob[start : end + 1]
            try:
                return json.loads(candidate)
            except json.JSONDecodeError:
                continue
        try:
            return json.loads(blob)
        except json.JSONDecodeError:
            pass
        # Last resort: the answer may simply have been cut off at the output cap.
        mended = _repair_truncated(blob)
        if mended:
            try:
                return json.loads(mended)
            except json.JSONDecodeError:
                continue
    raise ValueError("Model did not return valid JSON")


def _repair_truncated(blob: str) -> str | None:
    """Close a JSON value the model stopped writing part-way through.

    The output cap is a hard stop: on a long document the model is cut off
    mid-token, and what comes back is valid JSON with the end missing. Every
    story it had already finished is sitting there intact, and refusing to parse
    threw all of them away along with the half-written one.

    So rewind to the last container that actually closed — the last completed
    story — drop everything after it, and close what is still open. The result
    is the whole answer minus the one entry that never finished.

    Returns None when nothing completed, which is a real failure rather than a
    truncation worth rescuing.
    """
    stack: list[str] = []
    in_string = False
    escaped = False
    cut: int | None = None
    cut_stack: list[str] = []

    for i, ch in enumerate(blob):
        if escaped:
            escaped = False
            continue
        if ch == "\\" and in_string:
            escaped = True
            continue
        if ch == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch in "{[":
            stack.append(ch)
        elif ch in "}]":
            if not stack:
                break
            stack.pop()
            # A container just closed. Everything up to here is whole, and the
            # brackets still open are what we would have to close to end here.
            if stack:
                cut, cut_stack = i + 1, list(stack)

    if cut is None:
        return None
    closers = "".join("}" if b == "{" else "]" for b in reversed(cut_stack))
    return blob[:cut] + closers


def _wrap_list_if_needed(data: Any, schema: Type[BaseModel]) -> Any:
    """If the model returned a bare list and the schema has one list field, wrap it."""
    if not isinstance(data, list):
        return data
    list_fields = [
        name
        for name, field in schema.model_fields.items()
        if "list" in str(field.annotation).lower()
    ]
    if len(list_fields) == 1:
        return {list_fields[0]: data}
    return data


def parse_structured(payload: str | dict | list | BaseModel, schema: Type[T]) -> T:
    """Validate any LLM payload (text, dict, list, or model) as `schema`."""
    if isinstance(payload, schema):
        return payload
    if isinstance(payload, BaseModel):
        data: Any = payload.model_dump()
    elif isinstance(payload, str):
        data = extract_json_value(payload)
    elif isinstance(payload, (dict, list)):
        data = payload
    else:
        raise TypeError(f"Cannot parse {type(payload).__name__} as {schema.__name__}")
    data = _wrap_list_if_needed(data, schema)
    # Do not run chat-reasoning sanitizers on extract fields — they wipe
    # legitimate titles like "I need to reset password" and the UI shows empty.
    return schema.model_validate(data)
