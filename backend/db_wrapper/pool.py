"""Thread-safe connection pools — Aurora (psycopg2) or SQLite (pytest only)."""
from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path
from types import ModuleType
from typing import Any

from db_wrapper.dialect import use_sqlite

log = logging.getLogger("zet.db.pool")

_TOKEN_TTL_SECONDS = 14 * 60
_POOL_REFRESH_BUFFER_SECONDS = 120


class ConnectionPools:
    """Process-wide reader/writer pools with periodic IAM token refresh."""

    _instance: ConnectionPools | None = None
    _instance_lock = threading.Lock()

    def __init__(self, connector: ModuleType) -> None:
        self._connector = connector
        self._pool_lock = threading.RLock()
        self._read_pool: Any | None = None
        self._write_pool: Any | None = None
        self._pools_expire_at = 0.0
        self._tokens: dict[str, tuple[str, float]] = {}
        self._token_lock = threading.Lock()
        self._minconn = max(1, int(os.environ.get("DB_POOL_MIN", "2")))
        self._maxconn = max(self._minconn, int(os.environ.get("DB_POOL_MAX", "20")))

    @classmethod
    def instance(cls, connector: ModuleType | None = None) -> ConnectionPools:
        if use_sqlite():
            from db_wrapper.sqlite_pool import SqliteConnectionPools

            return SqliteConnectionPools.instance()  # type: ignore[return-value]
        assert connector is not None
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls(connector)
            return cls._instance

    @classmethod
    def dispose_all(cls) -> None:
        if use_sqlite():
            from db_wrapper.sqlite_pool import SqliteConnectionPools

            SqliteConnectionPools.dispose_all()
            return
        with cls._instance_lock:
            if cls._instance is not None:
                cls._instance._close_pools()
                cls._instance = None

    def _read_host(self) -> str:
        return self._connector.DB_READ_HOST

    def _write_host(self) -> str:
        return self._connector.DB_WRITE_HOST

    def _iam_token(self, hostname: str) -> str:
        now = time.time()
        with self._token_lock:
            cached = self._tokens.get(hostname)
            if cached and now < cached[1] - 60:
                return cached[0]
            pre = os.environ.get("DB_AUTH_TOKEN")
            if pre:
                token = pre
            else:
                token = self._connector._rds_client().generate_db_auth_token(
                    DBHostname=hostname,
                    Port=self._connector.DB_PORT,
                    DBUsername=self._connector.DB_USER,
                    Region=self._connector.AWS_REGION,
                )
            self._tokens[hostname] = (token, now + _TOKEN_TTL_SECONDS)
            return token

    def _ca_bundle(self) -> str:
        """Path to the RDS CA bundle used to verify the server certificate.

        Prefers the bundle vendored in the repo, so a deployed container never has
        to reach truststore.pki.rds.amazonaws.com at connect time — restricted
        egress would otherwise stop the app from booting.

        That bundle holds public Amazon roots AND the RDS private CAs, because the
        two are not interchangeable: this cluster presents a certificate issued by
        "Amazon RSA 2048 M01" (Amazon Trust Services, a PUBLIC CA), which the
        RDS-only bundle cannot verify. Carrying both means a CA rotation, or a new
        cluster using the RDS private CA, keeps working. Regenerate with
        scripts/refresh_ca_bundle.py.
        """
        vendored = Path(__file__).resolve().parent.parent / "certs" / "rds-and-public-roots.pem"
        override = os.environ.get("DB_SSL_ROOT_CERT", "").strip()
        if override:
            return override
        if vendored.is_file() and vendored.stat().st_size > 0:
            return str(vendored)
        return self._connector.ensure_ca_bundle(
            self._connector.CA_BUNDLE_PATH,
            self._connector.CA_BUNDLE_URL,
        )

    def _connect_kwargs(self, hostname: str) -> dict[str, Any]:
        # verify-full validates the certificate chain AND the hostname. Plain
        # "require" only encrypts: it accepts any certificate, so it cannot detect
        # an intercepted connection. DB_SSL_MODE is the escape hatch — verify-full
        # fails closed, so a CA problem should be downgradable without a redeploy.
        ssl_mode = os.environ.get("DB_SSL_MODE", "verify-full").strip() or "verify-full"
        kwargs: dict[str, Any] = {
            "host": hostname,
            "port": self._connector.DB_PORT,
            "user": self._connector.DB_USER,
            "password": self._iam_token(hostname),
            "database": self._connector.DB_NAME,
            "sslmode": ssl_mode,
            "connect_timeout": int(os.environ.get("DB_CONNECT_TIMEOUT", "10")),
        }
        if ssl_mode in ("verify-ca", "verify-full"):
            kwargs["sslrootcert"] = self._ca_bundle()
        return kwargs

    def _close_pools(self) -> None:
        with self._pool_lock:
            for p in (self._read_pool, self._write_pool):
                if p is not None:
                    try:
                        p.closeall()
                    except Exception:
                        log.exception("Error closing connection pool")
            self._read_pool = None
            self._write_pool = None
            self._pools_expire_at = 0.0

    def _rebuild_pools_if_needed(self) -> None:  # pragma: no cover — Aurora only
        from psycopg2 import pool
        if time.time() < self._pools_expire_at - _POOL_REFRESH_BUFFER_SECONDS:
            return
        with self._pool_lock:
            if time.time() < self._pools_expire_at - _POOL_REFRESH_BUFFER_SECONDS:
                return
            self._close_pools()
            read_kw = self._connect_kwargs(self._read_host())
            write_kw = self._connect_kwargs(self._write_host())
            self._read_pool = pool.ThreadedConnectionPool(
                self._minconn, self._maxconn, **read_kw
            )
            self._write_pool = pool.ThreadedConnectionPool(
                self._minconn, self._maxconn, **write_kw
            )
            self._pools_expire_at = time.time() + _TOKEN_TTL_SECONDS
            log.info(
                "DB pools rebuilt (read=%s write=%s min=%s max=%s)",
                self._read_host(),
                self._write_host(),
                self._minconn,
                self._maxconn,
            )

    def checkout(self, *, write: bool) -> Any:
        self._rebuild_pools_if_needed()
        p = self._write_pool if write else self._read_pool
        assert p is not None
        conn = p.getconn()
        if conn.closed:
            p.putconn(conn, close=True)
            conn = p.getconn()
        return conn

    def release(self, conn: Any, *, write: bool, close: bool = False) -> None:
        p = self._write_pool if write else self._read_pool
        if p is None or conn is None:
            return
        try:
            if close or conn.closed:
                p.putconn(conn, close=True)
            else:
                # ponytail: reset open txn + autocommit before pool reuse
                if conn.get_transaction_status() != 0:
                    conn.rollback()
                conn.autocommit = True
                p.putconn(conn)
        except Exception:
            log.exception("Error returning connection to pool")
            try:
                p.putconn(conn, close=True)
            except Exception:
                pass
