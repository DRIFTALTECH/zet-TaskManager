"""Load the external database connector package without duplicating its logic."""
from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path
from types import ModuleType

from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]


def connector_dir() -> Path:
    """Directory containing connect_rds_iam.py and connector .env."""
    raw = os.environ.get("DB_CONNECTOR_PATH", "test-db-connection").strip()
    p = Path(raw).expanduser()
    if p.is_absolute():
        return p.resolve()
    return (_REPO_ROOT / p).resolve()


def load_connector() -> ModuleType:
    """Import connect_rds_iam from the connector package after loading .env files.

    backend/.env is the app source of truth and is loaded first. A connector
    .env (if present) cannot override those values. Required identity vars
    have no silent defaults — missing DB_USER must not become postgres.
    """
    backend_env = Path(__file__).resolve().parents[1] / ".env"
    if backend_env.is_file():
        # Instance/task AWS_REGION must not win over backend/.env (token region).
        load_dotenv(backend_env, override=True)
    cdir = connector_dir()
    env_file = cdir / ".env"
    if env_file.is_file():
        load_dotenv(env_file)

    module_path = cdir / "connect_rds_iam.py"
    if not module_path.is_file():
        raise FileNotFoundError(f"Connector module not found: {module_path}")

    module_name = "zet_db_connector"
    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load connector from {module_path}")

    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod
