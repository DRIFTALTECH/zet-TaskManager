"""Shared helpers for crud modules using db_wrapper read()/write()."""
from __future__ import annotations

from typing import Any, TypeVar

from db_wrapper.wrapper import DatabaseWrapper

T = TypeVar("T")

Db = DatabaseWrapper


def row_to_model(model_cls: type[T], row: dict[str, Any] | None) -> T | None:
    if not row:
        return None
    cols = {c.name for c in model_cls.__table__.columns}
    return model_cls(**{k: row[k] for k in cols if k in row})


def rows_to_models(model_cls: type[T], rows: list[dict[str, Any]]) -> list[T]:
    return [row_to_model(model_cls, r) for r in rows]  # type: ignore[misc]


def fetch_one(db: Db, sql: str, params: tuple | dict | None = None, *, primary: bool = False) -> dict[str, Any] | None:
    rows = db.read(sql, params, primary=primary)
    return rows[0] if rows else None


def fetch_all(db: Db, sql: str, params: tuple | dict | None = None, *, primary: bool = False) -> list[dict[str, Any]]:
    return db.read(sql, params, primary=primary)
