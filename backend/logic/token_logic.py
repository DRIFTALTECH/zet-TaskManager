"""Personal access token business logic — create / list / revoke / resolve.

Tokens are random strings prefixed `zet_pat_`; only their SHA-256 hash is stored.
The raw token is returned exactly once (at creation). Resolution maps a presented
token back to its owning user id, so the rest of the app's auth is unchanged."""

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

import crud.access_tokens as tokens_crud
from database.init_db import new_id
from database.models import PersonalAccessToken
from logic.schemas import PersonalAccessTokenCreated, PersonalAccessTokenOut

TOKEN_PREFIX = "zet_pat_"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _to_out(t: PersonalAccessToken) -> PersonalAccessTokenOut:
    return PersonalAccessTokenOut(
        id=t.id, name=t.name, prefix=t.prefix, createdAt=t.created_at, lastUsedAt=t.last_used_at,
    )


def create_token(db: Session, user_id: str, name: str) -> PersonalAccessTokenCreated:
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc).isoformat()
    row = PersonalAccessToken(
        id=new_id("pat"),
        user_id=user_id,
        name=(name or "MCP token").strip() or "MCP token",
        token_hash=_hash(raw),
        prefix=raw[: len(TOKEN_PREFIX) + 6],
        created_at=now,
        last_used_at=None,
        revoked=False,
    )
    tokens_crud.create(db, row)
    out = _to_out(row)
    return PersonalAccessTokenCreated(**out.model_dump(), token=raw)


def list_tokens(db: Session, user_id: str) -> list[PersonalAccessTokenOut]:
    return [_to_out(t) for t in tokens_crud.list_for_user(db, user_id)]


def revoke_token(db: Session, user_id: str, token_id: str) -> None:
    t = tokens_crud.get_for_user(db, token_id, user_id)
    if not t:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Token not found")
    t.revoked = True
    tokens_crud.update(db, t)


def revoke_raw(db: Session, raw_token: str) -> None:
    """Revoke a token by its raw value (used by OAuth token revocation)."""
    if not raw_token or not raw_token.startswith(TOKEN_PREFIX):
        return
    row = tokens_crud.get_by_hash(db, _hash(raw_token))
    if row:
        row.revoked = True
        tokens_crud.update(db, row)


def resolve_user_id(db: Session, raw_token: str) -> str | None:
    """Return the owning user id for a presented PAT, or None if invalid/revoked.
    Also stamps last_used_at."""
    if not raw_token or not raw_token.startswith(TOKEN_PREFIX):
        return None
    row = tokens_crud.get_by_hash(db, _hash(raw_token))
    if not row:
        return None
    tokens_crud.touch_last_used(db, row, datetime.now(timezone.utc).isoformat())
    return row.user_id
