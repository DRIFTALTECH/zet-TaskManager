"""SQL dialect helpers — SQLite test mode adapts Postgres-style queries."""
from __future__ import annotations

import os
import re
from typing import Any

_ANY_RE = re.compile(r"=\s*ANY\s*\(\s*%s\s*\)", re.IGNORECASE)


def use_sqlite() -> bool:
    return os.environ.get("ZET_TEST_SQLITE", "").strip().lower() in ("1", "true", "yes")


def sqlite_path() -> str:
    raw = os.environ.get("ZET_SQLITE_PATH", "").strip()
    if not raw:
        raise RuntimeError("ZET_SQLITE_PATH must be set when ZET_TEST_SQLITE=1")
    return raw


def adapt_sqlite(sql: str, params: Any) -> tuple[str, tuple[Any, ...]]:
    """Convert %s placeholders and = ANY(%s) to SQLite ? / IN (?,...) form."""
    if params is None:
        params = ()
    elif not isinstance(params, (tuple, list)):
        params = (params,)
    else:
        params = tuple(params)

    pending = list(params)
    out_params: list[Any] = []

    def _any_repl(_match: re.Match[str]) -> str:
        if not pending:
            return "IN (NULL)"
        val = pending.pop(0)
        if not val:
            return "IN (NULL)"
        placeholders = ", ".join("?" * len(val))
        out_params.extend(val)
        return f"IN ({placeholders})"

    sql = _ANY_RE.sub(_any_repl, sql)

    parts = sql.split("%s")
    if len(parts) - 1 != len(pending):
        raise ValueError(
            f"SQL placeholder count mismatch: {len(parts) - 1} %s vs {len(pending)} params"
        )

    out_sql = parts[0]
    for i, p in enumerate(pending):
        out_sql += "?" + parts[i + 1]
        out_params.append(p)

    return out_sql, tuple(out_params)
