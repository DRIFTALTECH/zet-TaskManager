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
            continue
    raise ValueError("Model did not return valid JSON")


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
