"""Reading and editing the instructions sent to the model.

The wording lives in `ai/prompts.py`; this layer lets a superadmin replace any
of it without a deploy. Only edited prompts are stored, so the table starts
empty and an untouched install behaves exactly as the file reads.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import HTTPException, status

from ai import prompts
from crud import ai_prompts as prompts_crud
from database.database import Db
from crud import users as users_crud
from logic import project_logic
from logic.schemas import PromptOut

log = logging.getLogger("zet.prompts")


def _ensure_superadmin(db: Db, user_id: str) -> None:
    """Prompts steer every AI feature for everyone, so only the operator edits them."""
    if not project_logic.is_admin(db, user_id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Superadmin only")


def _known(key: str) -> None:
    if key not in prompts.DEFAULTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No prompt named {key!r}")


def load_into_memory(db: Db) -> int:
    """Point the prompt module at what is stored. Called at startup and after edits.

    A failure here must not take the app down: the defaults are compiled in, so
    the worst case is that a saved edit is not applied until the next attempt.
    """
    try:
        rows = prompts_crud.list_all(db)
    except Exception as exc:
        log.warning("Could not read stored prompts, using defaults: %s", exc)
        return 0
    prompts.set_overrides({r["key"]: r["body"] or "" for r in rows})
    return len(rows)


def _to_out(key: str, row: dict | None) -> PromptOut:
    editor = None
    return PromptOut(
        key=key,
        body=prompts.current(key),
        defaultBody=prompts.DEFAULTS[key],
        placeholders=sorted(prompts.PLACEHOLDERS.get(key, set())),
        isCustom=prompts.is_overridden(key),
        updatedAt=(row or {}).get("updated_at"),
        updatedBy=editor,
    )


def list_prompts(db: Db, user_id: str) -> list[PromptOut]:
    _ensure_superadmin(db, user_id)
    load_into_memory(db)
    stored = {r["key"]: r for r in prompts_crud.list_all(db)}
    by_key = {}
    for key in sorted(prompts.DEFAULTS):
        row = stored.get(key)
        out = _to_out(key, row)
        if row and row.get("updated_by"):
            editor_row = users_crud.get_by_id(db, row["updated_by"])
            out.updatedBy = getattr(editor_row, "name", None)
        by_key[key] = out
    return list(by_key.values())


def update_prompt(db: Db, user_id: str, key: str, body: str) -> PromptOut:
    _ensure_superadmin(db, user_id)
    _known(key)
    text = (body or "").strip()
    if not text:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A prompt cannot be empty")
    # Anything in single braces is read as a value to be filled in. A JSON
    # example pasted into a prompt therefore asks for a value nothing supplies,
    # and every call using that prompt fails — so refuse it here, where the
    # person can still see what they typed, rather than at the point of use.
    try:
        unknown = prompts.unknown_placeholders(key, text)
    except Exception as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Could not read the placeholders in that prompt: {exc}",
        ) from exc
    if unknown:
        named = ", ".join(sorted("{" + u + "}" for u in unknown))
        allowed = ", ".join(sorted("{" + a + "}" for a in prompts.PLACEHOLDERS.get(key, set()))) or "none"
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Nothing fills in {named}. This prompt can use {allowed}. "
            "To show braces as text — a JSON example, say — double them: {{like this}}.",
        )
    # Saving the default back is a reset, not an edit — keeping it as a row would
    # freeze today's wording against every future change to the shipped default.
    if text == prompts.DEFAULTS[key].strip():
        return reset_prompt(db, user_id, key)
    prompts_crud.upsert(
        db, key, text, datetime.now(timezone.utc).isoformat(), user_id
    )
    db.commit()
    load_into_memory(db)
    return _to_out(key, prompts_crud.get(db, key))


def reset_prompt(db: Db, user_id: str, key: str) -> PromptOut:
    """Drop the edit so the wording shipped with the app takes over again."""
    _ensure_superadmin(db, user_id)
    _known(key)
    prompts_crud.delete(db, key)
    db.commit()
    load_into_memory(db)
    return _to_out(key, None)
