"""Stored overrides for the instructions sent to the model.

Only edited prompts have a row. Anything absent falls back to the default
written in `ai/prompts.py`, so the table starts empty and the app behaves
exactly as it did before anyone touched it.
"""

from crud._base import Db, fetch_all, fetch_one


def get(db: Db, key: str) -> dict | None:
    return fetch_one(
        db,
        "SELECT key, body, updated_at, updated_by FROM ai_prompts WHERE key = %s",
        (key,),
    )


def list_all(db: Db) -> list[dict]:
    return fetch_all(
        db,
        "SELECT key, body, updated_at, updated_by FROM ai_prompts ORDER BY key",
    )


def upsert(db: Db, key: str, body: str, updated_at: str, updated_by: str) -> None:
    if fetch_one(db, "SELECT key FROM ai_prompts WHERE key = %s", (key,)):
        db.write(
            "UPDATE ai_prompts SET body = %s, updated_at = %s, updated_by = %s WHERE key = %s",
            (body, updated_at, updated_by, key),
        )
    else:
        db.write(
            "INSERT INTO ai_prompts (key, body, updated_at, updated_by) VALUES (%s, %s, %s, %s)",
            (key, body, updated_at, updated_by),
        )


def delete(db: Db, key: str) -> None:
    """Drop an override so the built-in default takes over again."""
    db.write("DELETE FROM ai_prompts WHERE key = %s", (key,))
