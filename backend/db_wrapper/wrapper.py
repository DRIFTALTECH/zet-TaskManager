"""Generic database wrapper — application code calls read()/write() only."""
from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterator
from uuid import UUID

from db_wrapper.loader import load_connector
from db_wrapper.pool import ConnectionPools
from db_wrapper.dialect import adapt_sqlite, use_sqlite

log = logging.getLogger("zet.db_wrapper")

_SLOW_MS = float(__import__("os").environ.get("DB_SLOW_QUERY_MS", "200"))
_MAX_CONN_RETRIES = 2  # retry only failed connection checkout, not executed SQL


def _json_safe(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    return value


def _transient_errors() -> tuple[type[BaseException], ...]:
    """Errors worth retrying with a fresh pool.

    PoolError belongs here even though it is NOT an OperationalError: it inherits
    straight from psycopg2.Error. When one request hits a connection failure it
    disposes the pools, and any request already holding the old pool object then
    raises "connection pool is closed". That is recoverable — rebuild and retry —
    but while PoolError was missing from this tuple it escaped as a 500.
    """
    try:
        import psycopg2
        import psycopg2.pool

        return (psycopg2.OperationalError, psycopg2.InterfaceError, psycopg2.pool.PoolError)
    except ImportError:
        return (ConnectionError, OSError)


@dataclass
class _RequestScope:
    """Per-request pooled connections (FastAPI Depends lifecycle)."""

    read_conn: Any | None = None
    write_conn: Any | None = None
    txn_depth: int = 0
    _depth: int = 1
    # ponytail: one write conn per request; autocommit unless transaction() active
    _write_autocommit: bool = True
    # ponytail: after any write, route reads to writer (Aurora read-your-writes)
    _wrote_in_scope: bool = False


_scope_var: ContextVar[_RequestScope | None] = ContextVar("zet_db_scope", default=None)


class DatabaseWrapper:
    """Pooled read()/write() facade with request-scoped connection reuse."""

    def __init__(self, connector_module: Any | None = None) -> None:
        if use_sqlite():
            self._connector = None
        else:
            self._connector = connector_module or load_connector()
        self._pools = ConnectionPools.instance(self._connector)

    def enter_request_scope(self) -> None:
        """Bind one reader + writer connection for the current request context."""
        scope = _scope_var.get()
        if scope is None:
            _scope_var.set(_RequestScope())
        else:
            scope._depth += 1

    def exit_request_scope(self) -> None:
        scope = _scope_var.get()
        if scope is None:
            return
        if scope._depth > 1:
            scope._depth -= 1
            return
        try:
            if scope.write_conn is not None and scope.txn_depth > 0:
                scope.write_conn.rollback()
            elif scope.write_conn is not None and not scope._write_autocommit:
                scope.write_conn.commit()
        except Exception:
            log.exception("Error closing request-scope write connection")
        finally:
            if scope.read_conn is not None:
                self._pools.release(scope.read_conn, write=False)
            if scope.write_conn is not None:
                self._pools.release(scope.write_conn, write=True)
            _scope_var.set(None)

    def commit(self) -> None:
        """Commit pending work on the request-scoped write connection."""
        scope = _scope_var.get()
        if scope and scope.write_conn is not None and scope.txn_depth == 0:
            if not scope.write_conn.autocommit:
                scope.write_conn.commit()

    def close(self) -> None:
        """Release request-scoped connections (get_db finally)."""
        self.exit_request_scope()

    def rollback(self) -> None:
        scope = _scope_var.get()
        if scope and scope.write_conn is not None:
            scope.write_conn.rollback()

    @contextmanager
    def transaction(self) -> Iterator[DatabaseWrapper]:
        """Group multiple write() calls in one DB transaction."""
        scope = _scope_var.get()
        ephemeral = scope is None
        if ephemeral:
            conn = self._checkout(write=True)
        else:
            conn = self._acquire_write(scope)
        if scope is not None:
            scope.txn_depth += 1
        prev_autocommit = conn.autocommit
        t0 = time.perf_counter()
        try:
            conn.autocommit = False
            if scope is not None:
                scope._write_autocommit = False
            yield self
            conn.commit()
            elapsed_ms = (time.perf_counter() - t0) * 1000
            log.info("TRANSACTION committed in %.1f ms", elapsed_ms)
            if elapsed_ms > _SLOW_MS:
                log.warning("SLOW TRANSACTION %.1f ms", elapsed_ms)
        except Exception:
            conn.rollback()
            log.info("TRANSACTION rolled back after %.1f ms", (time.perf_counter() - t0) * 1000)
            raise
        finally:
            conn.autocommit = prev_autocommit
            if scope is not None:
                scope.txn_depth = max(0, scope.txn_depth - 1)
                if scope.txn_depth == 0:
                    scope._write_autocommit = prev_autocommit
            elif ephemeral:
                self._pools.release(conn, write=True)

    def read(self, sql: str, params: tuple | dict | list | None = None) -> list[dict[str, Any]]:
        rows = self._run(sql, params, write=False)
        return [_json_safe(row) for row in rows]

    def write(self, sql: str, params: tuple | dict | list | None = None) -> dict[str, Any]:
        rowcount = self._run(sql, params, write=True)
        return {"ok": True, "rowcount": rowcount}

    @contextmanager
    def _cursor(self, conn: Any) -> Iterator[Any]:
        """Yield a DB cursor (sqlite3 cursors lack context-manager support on some Python builds)."""
        if use_sqlite():
            cur = conn.cursor()
            try:
                yield cur
            finally:
                cur.close()
        else:
            with conn.cursor() as cur:
                yield cur

    def _acquire_read(self, scope: _RequestScope | None) -> tuple[Any, bool]:
        """Return (connection, ephemeral). ephemeral=True → return to pool after use."""
        if scope is not None:
            # ponytail: same-request reads after a write must use writer (replica lag)
            if scope._wrote_in_scope and scope.write_conn is not None:
                return scope.write_conn, False
            if scope.read_conn is None:
                scope.read_conn = self._checkout(write=False)
            return scope.read_conn, False
        return self._checkout(write=False), True

    def _acquire_write(self, scope: _RequestScope | None) -> Any:
        if scope is not None:
            if scope.write_conn is None:
                scope.write_conn = self._checkout(write=True)
                scope.write_conn.autocommit = scope._write_autocommit
            return scope.write_conn
        conn = self._checkout(write=True)
        conn.autocommit = True
        return conn

    def _checkout(self, *, write: bool) -> Any:
        transient = _transient_errors()
        last_err: BaseException | None = None
        for attempt in range(_MAX_CONN_RETRIES + 1):
            try:
                return self._pools.checkout(write=write)
            except transient as exc:
                last_err = exc
                if attempt < _MAX_CONN_RETRIES:
                    log.warning("Pool checkout failed (attempt %s): %s", attempt + 1, exc)
                    ConnectionPools.dispose_all()
                    self._pools = ConnectionPools.instance(self._connector)
                    continue
                raise
        assert last_err is not None
        raise last_err

    def _run(
        self,
        sql: str,
        params: tuple | dict | list | None,
        *,
        write: bool,
    ) -> list[dict[str, Any]] | int:
        kind = "WRITE" if write else "READ"
        transient = _transient_errors()
        scope = _scope_var.get()
        t_total = time.perf_counter()

        if write:
            conn = self._acquire_write(scope)
            ephemeral = scope is None
        else:
            conn, ephemeral = self._acquire_read(scope)

        t_conn = time.perf_counter()
        conn_ms = (t_conn - t_total) * 1000
        executed = False
        sql_preview = " ".join(sql.split())[:120]
        exec_sql = sql
        exec_params = params
        if use_sqlite():
            exec_sql, exec_params = adapt_sqlite(sql, params)

        try:
            with self._cursor(conn) as cur:
                cur.execute(exec_sql, exec_params)
                executed = True
                t_exec = time.perf_counter()
                exec_ms = (t_exec - t_conn) * 1000
                commit_ms = 0.0
                if write:
                    if scope is not None:
                        scope._wrote_in_scope = True
                    if scope is None or (scope._write_autocommit and scope.txn_depth == 0):
                        if not conn.autocommit:
                            t_commit = time.perf_counter()
                            conn.commit()
                            commit_ms = (time.perf_counter() - t_commit) * 1000
                    result: list[dict[str, Any]] | int = cur.rowcount
                else:
                    if not cur.description:
                        result = []
                    else:
                        columns = [desc[0] for desc in cur.description]
                        result = [dict(zip(columns, row)) for row in cur.fetchall()]

                total_ms = (time.perf_counter() - t_total) * 1000
                endpoint = "writer" if write or (scope and scope._wrote_in_scope) else "reader"
                log.debug(
                    "%s [%s] %.1f ms (conn=%.1f exec=%.1f commit=%.1f) %s",
                    kind,
                    endpoint,
                    total_ms,
                    conn_ms,
                    exec_ms,
                    commit_ms,
                    sql_preview,
                )
                if total_ms > _SLOW_MS:
                    log.warning(
                        "SLOW %s [%s] %.1f ms (conn=%.1f exec=%.1f commit=%.1f) %s",
                        kind,
                        endpoint,
                        total_ms,
                        conn_ms,
                        exec_ms,
                        commit_ms,
                        sql_preview,
                    )
                return result
        except transient as exc:
            # ponytail: never retry after SQL executed — prevents duplicate INSERTs
            if executed:
                log.error("%s failed after execute (no retry): %s", kind, exc)
                raise
            log.warning("%s connection error before execute: %s", kind, exc)
            if ephemeral:
                self._pools.release(conn, write=write, close=True)
            raise
        except Exception:
            if write and executed and scope and scope.txn_depth > 0:
                try:
                    conn.rollback()
                except Exception:
                    pass
            raise
        finally:
            if ephemeral:
                self._pools.release(conn, write=write)
