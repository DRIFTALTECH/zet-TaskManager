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
    """Convert %s placeholders and = ANY(%s) to SQLite ? / IN (?,...) form.

    Placeholders are consumed strictly left to right in one pass. An earlier version
    rewrote every `= ANY(%s)` first and appended those parameters ahead of the rest,
    so any statement where `ANY` was not the FIRST placeholder bound its parameters
    in the wrong order — silently for same-typed values, and as a hard
    "type 'list' is not supported" error otherwise.
    """
    if params is None:
        params = ()
    elif not isinstance(params, (tuple, list)):
        params = (params,)
    else:
        params = tuple(params)

    out_sql: list[str] = []
    out_params: list[Any] = []
    idx = 0          # position in sql
    param_i = 0      # next parameter to consume

    while idx < len(sql):
        any_match = _ANY_RE.search(sql, idx)
        next_pct = sql.find("%s", idx)
        if next_pct == -1 and any_match is None:
            break

        # Whichever construct comes first wins; an ANY match starts at or before
        # the %s it contains.
        if any_match is not None and (next_pct == -1 or any_match.start() <= next_pct):
            out_sql.append(sql[idx:any_match.start()])
            if param_i >= len(params):
                raise ValueError("SQL placeholder count mismatch: more placeholders than params")
            val = params[param_i]
            param_i += 1
            if not val:
                out_sql.append("IN (NULL)")
            else:
                seq = list(val)
                out_sql.append(f"IN ({', '.join('?' * len(seq))})")
                out_params.extend(seq)
            idx = any_match.end()
            continue

        out_sql.append(sql[idx:next_pct])
        if param_i >= len(params):
            raise ValueError("SQL placeholder count mismatch: more placeholders than params")
        out_sql.append("?")
        out_params.append(params[param_i])
        param_i += 1
        idx = next_pct + 2

    out_sql.append(sql[idx:])

    if param_i != len(params):
        raise ValueError(
            f"SQL placeholder count mismatch: consumed {param_i} of {len(params)} params"
        )
    return "".join(out_sql), tuple(out_params)
